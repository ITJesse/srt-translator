#!/usr/bin/env node

import cliProgress from 'cli-progress'
import { Command } from 'commander'
import fs from 'fs'
import path from 'path'

import { dumpSrt, Srt, SubtitleItem } from './lib/srt'
import { Translator } from './lib/translate'

/**
 * 翻译配置接口
 */
export interface TranslationConfig {
  inputFile: string
  outputFile: string
  sourceLanguage: string
  targetLanguage: string
  model: string
  maxLength: number
  concurrency: number
  apiKey: string
  apiBaseUrl?: string
}

const DEFAULT_MAX_LENGTH = 2000
const DEFAULT_CONCURRENCY = 10
const DEFAULT_MODEL = 'gpt-4o'
const DEFAULT_SOURCE_LANGUAGE = 'english'
const DEFAULT_TARGET_LANGUAGE = 'chinese'

/**
 * 获取程序版本
 */
const getVersion = (): string => {
  try {
    const packageJsonPath = path.resolve(__dirname, '../package.json')
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    return packageJson.version
  } catch (error) {
    return 'Unknown version'
  }
}

/**
 * 主程序入口
 * @param config 翻译配置对象
 */
const processSubtitles = async (config: TranslationConfig): Promise<void> => {
  const { inputFile, outputFile, sourceLanguage, targetLanguage, model, maxLength, concurrency, apiKey, apiBaseUrl } =
    config

  try {
    if (!fs.existsSync(inputFile)) {
      console.error(`Error: Input file "${inputFile}" does not exist`)
      process.exit(1)
    }

    const srtContent = fs.readFileSync(inputFile, 'utf8')
    const srt = new Srt(srtContent)
    const subtitles = srt.subtitles

    const batches: SubtitleItem[][] = []
    let currentBatchLength = 0
    let currentBatch: SubtitleItem[] = []

    console.log(`Total ${subtitles.length} subtitles to process`)
    for (const subtitle of subtitles) {
      if (currentBatchLength + subtitle.text.join('\n').length > maxLength) {
        batches.push(currentBatch)
        currentBatch = []
        currentBatchLength = 0
      }

      currentBatch.push(subtitle)
      currentBatchLength += subtitle.text.join('\n').length
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch)
    }
    console.log(`Total ${batches.length} batches to process`)

    console.log('Extracting glossary...')

    let progress = new cliProgress.SingleBar({
      format: 'Extracting glossary: {bar} | {percentage}% | {value}/{total} | ETA: {eta}s',
    })
    progress.start(batches.length, 0)

    // 创建翻译器实例
    const translator = new Translator(model, apiKey, apiBaseUrl)

    let glossary: Record<string, string> = {}
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchPromises = batches.slice(i, i + concurrency).map(async (batch) => {
        const result = await translator.extractGlossary({
          subtitles: batch,
          sourceLanguage,
          targetLanguage,
        })
        glossary = { ...glossary, ...result }
        progress.increment()
      })
      await Promise.all(batchPromises)
    }
    progress.stop()
    console.log('Glossary extraction completed')

    progress = new cliProgress.SingleBar({
      format: 'Translation: {bar} | {percentage}% | {value}/{total} | ETA: {eta}s',
    })
    progress.start(batches.length, 0)
    let results: Record<string, string> = {}
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchPromises = batches.slice(i, i + concurrency).map(async (batch, index) => {
        try {
          const batchResult = await translator.translateText({
            subtitles: batch,
            glossary,
            sourceLanguage,
            targetLanguage,
          })
          progress.increment()
          results = { ...results, ...batchResult }
        } catch (error) {
          console.error(`Batch ${i + index + 1} processing failed:`, error)
          return {}
        }
      })
      await Promise.all(batchPromises)
    }
    progress.stop()

    const translatedSrtContent = dumpSrt(
      subtitles.map((subtitle) => ({
        ...subtitle,
        text: results[subtitle.hash]?.split('\n') || subtitle.text,
      })),
    )
    fs.writeFileSync(outputFile, translatedSrtContent)
    console.log(`Translation completed, saved to ${outputFile}`)
  } catch (error) {
    console.error('Error occurred during processing:', error)
    process.exit(1)
  }
}

const program = new Command()

program.name('srt-translator').description('CLI tool for translating SRT subtitle files using AI').version(getVersion())

program
  .argument('<inputFile>', 'Path to the input SRT file')
  .option('-o, --output <file>', 'Path to the output SRT file (defaults to input filename with prefix)')
  .option('-s, --source <language>', `Source language (default: "${DEFAULT_SOURCE_LANGUAGE}")`)
  .option('-t, --target <language>', `Target language (default: "${DEFAULT_TARGET_LANGUAGE}")`)
  .option('-m, --model <name>', `AI model name (default: "${DEFAULT_MODEL}")`)
  .option(
    '-l, --max-length <number>',
    `Maximum characters per batch (default: ${DEFAULT_MAX_LENGTH})`,
    `${DEFAULT_MAX_LENGTH}`,
  )
  .option(
    '-c, --concurrency <number>',
    `Number of concurrent batch processes (default: ${DEFAULT_CONCURRENCY})`,
    `${DEFAULT_CONCURRENCY}`,
  )
  .option('-k, --api-key <key>', 'OpenAI API key (can also be set via OPENAI_API_KEY environment variable)')
  .option(
    '-b, --api-base-url <url>',
    'OpenAI API base URL (can also be set via OPENAI_API_BASE_URL environment variable)',
  )
  .option('--no-progress', 'Disable progress bar display')
  .action(async (inputFile, options) => {
    const sourceLanguage = options.source || DEFAULT_SOURCE_LANGUAGE
    const targetLanguage = options.target || DEFAULT_TARGET_LANGUAGE
    const model = options.model || DEFAULT_MODEL
    const maxLength = parseInt(options.maxLength, 10)
    const concurrency = parseInt(options.concurrency, 10)
    let apiKey = options.apiKey
    const apiBaseUrl = options.apiBaseUrl

    if (!apiKey) {
      const envApiKey = process.env.OPENAI_API_KEY
      if (!envApiKey) {
        console.error(
          'Error: OpenAI API key is required. Use --api-key option or set OPENAI_API_KEY environment variable.',
        )
        process.exit(1)
      }
      apiKey = envApiKey
    }

    let finalApiBaseUrl = apiBaseUrl
    if (!finalApiBaseUrl) {
      const envApiBaseUrl = process.env.OPENAI_API_BASE_URL
      if (envApiBaseUrl) {
        finalApiBaseUrl = envApiBaseUrl
      }
    }

    let outputFile = options.output
    if (!outputFile) {
      const inputExt = path.extname(inputFile)
      const inputBase = path.basename(inputFile, inputExt)
      const inputDir = path.dirname(inputFile)
      outputFile = path.join(inputDir, `${inputBase}-${targetLanguage}-${model}${inputExt}`)
    }

    console.log(`Input file: ${inputFile}`)
    console.log(`Output file: ${outputFile}`)
    console.log(`Source language: ${sourceLanguage}`)
    console.log(`Target language: ${targetLanguage}`)
    console.log(`AI model: ${model}`)
    console.log(`Max characters per batch: ${maxLength}`)
    console.log(`Concurrent batches: ${concurrency}`)
    if (finalApiBaseUrl) {
      console.log(`API base URL: ${finalApiBaseUrl}`)
    }
    console.log('----------------------------')

    const config: TranslationConfig = {
      inputFile,
      outputFile,
      sourceLanguage,
      targetLanguage,
      model,
      maxLength,
      concurrency,
      apiKey,
      apiBaseUrl: finalApiBaseUrl,
    }

    await processSubtitles(config)
  })

program.parse(process.argv)
