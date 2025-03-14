#!/usr/bin/env node

import cliProgress from 'cli-progress'
import { Command } from 'commander'
import fs from 'fs'
import path from 'path'

import { dumpSrt, Srt, SubtitleItem } from './lib/srt'
import {
    extractGlossary, ExtractGlossaryConfig, translateText, TranslateTextConfig
} from './lib/translate'

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

// 设置默认值
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
    return '未知版本'
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
    // 检查输入文件是否存在
    if (!fs.existsSync(inputFile)) {
      console.error(`错误: 输入文件 "${inputFile}" 不存在`)
      process.exit(1)
    }

    const srtContent = fs.readFileSync(inputFile, 'utf8')
    const srt = new Srt(srtContent)
    const subtitles = srt.subtitles

    const batches: SubtitleItem[][] = []
    let currentBatchLength = 0
    let currentBatch: SubtitleItem[] = []

    console.log(`总共有 ${subtitles.length} 个字幕需要处理`)
    for (const subtitle of subtitles) {
      if (currentBatchLength + subtitle.text.join('\n').length > maxLength) {
        batches.push(currentBatch)
        currentBatch = []
        currentBatchLength = 0
      }

      currentBatch.push(subtitle)
      currentBatchLength += subtitle.text.join('\n').length
    }

    // 添加最后一个batch（如果有内容）
    if (currentBatch.length > 0) {
      batches.push(currentBatch)
    }
    console.log(`总共有 ${batches.length} 个批次需要处理`)

    // 提取术语表
    console.log('正在提取术语表...')

    let progress = new cliProgress.SingleBar({
      format: '提取术语表: {bar} | {percentage}% | {value}/{total} | ETA: {eta}s',
    })
    progress.start(batches.length, 0)

    let glossary: Record<string, string> = {}
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchPromises = batches.slice(i, i + concurrency).map(async (batch) => {
        const glossaryConfig: ExtractGlossaryConfig = {
          model,
          sourceLanguage,
          targetLanguage,
          subtitles: batch,
          apiKey,
          baseUrl: apiBaseUrl,
        }
        const result = await extractGlossary(glossaryConfig)
        glossary = { ...glossary, ...result }
        progress.increment()
      })
      await Promise.all(batchPromises)
    }
    progress.stop()
    console.log('术语表提取完成')

    // 并行处理批次
    progress = new cliProgress.SingleBar({
      format: '翻译: {bar} | {percentage}% | {value}/{total} | ETA: {eta}s',
    })
    progress.start(batches.length, 0)
    let results: Record<string, string> = {}
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchPromises = batches.slice(i, i + concurrency).map(async (batch, index) => {
        try {
          const translateConfig: TranslateTextConfig = {
            model,
            sourceLanguage,
            targetLanguage,
            subtitles: batch,
            glossary,
            apiKey,
            baseUrl: apiBaseUrl,
          }
          const batchResult = await translateText(translateConfig)
          progress.increment()
          results = { ...results, ...batchResult }
        } catch (error) {
          console.error(`批次 ${i + index + 1} 处理失败:`, error)
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
    console.log(`翻译完成，已保存到 ${outputFile}`)
  } catch (error) {
    console.error('处理过程中发生错误:', error)
    process.exit(1)
  }
}

// 创建命令行程序
const program = new Command()

program.name('srt-translator').description('使用AI翻译SRT字幕文件的命令行工具').version(getVersion())

program
  .argument('<inputFile>', '输入的SRT文件路径')
  .option('-o, --output <file>', '输出的SRT文件路径（默认为输入文件名加前缀）')
  .option('-s, --source <language>', `源语言 (默认: "${DEFAULT_SOURCE_LANGUAGE}")`)
  .option('-t, --target <language>', `目标语言 (默认: "${DEFAULT_TARGET_LANGUAGE}")`)
  .option('-m, --model <name>', `AI模型名称 (默认: "${DEFAULT_MODEL}")`)
  .option('-l, --max-length <number>', `每批次的最大字符数 (默认: ${DEFAULT_MAX_LENGTH})`, `${DEFAULT_MAX_LENGTH}`)
  .option('-c, --concurrency <number>', `并发处理的批次数 (默认: ${DEFAULT_CONCURRENCY})`, `${DEFAULT_CONCURRENCY}`)
  .option('-k, --api-key <key>', 'OpenAI API密钥（必需）')
  .option('-b, --api-base-url <url>', 'OpenAI API基础URL（可选）')
  .option('--no-progress', '禁用进度条显示')
  .action(async (inputFile, options) => {
    const sourceLanguage = options.source || DEFAULT_SOURCE_LANGUAGE
    const targetLanguage = options.target || DEFAULT_TARGET_LANGUAGE
    const model = options.model || DEFAULT_MODEL
    const maxLength = parseInt(options.maxLength, 10)
    const concurrency = parseInt(options.concurrency, 10)
    const apiKey = options.apiKey
    const apiBaseUrl = options.apiBaseUrl

    if (!apiKey) {
      console.error('错误: 必须提供OpenAI API密钥。使用 --api-key 选项。')
      process.exit(1)
    }

    // 如果没有指定输出文件，则使用 {inputBase}-{targetLang}-{model} 格式
    let outputFile = options.output
    if (!outputFile) {
      const inputExt = path.extname(inputFile)
      const inputBase = path.basename(inputFile, inputExt)
      const inputDir = path.dirname(inputFile)
      outputFile = path.join(inputDir, `${inputBase}-${targetLanguage}-${model}${inputExt}`)
    }

    console.log(`输入文件: ${inputFile}`)
    console.log(`输出文件: ${outputFile}`)
    console.log(`源语言: ${sourceLanguage}`)
    console.log(`目标语言: ${targetLanguage}`)
    console.log(`AI模型: ${model}`)
    console.log(`每批次最大字符数: ${maxLength}`)
    console.log(`并发处理批次数: ${concurrency}`)
    if (apiBaseUrl) {
      console.log(`API基础URL: ${apiBaseUrl}`)
    }
    console.log('----------------------------')

    // 创建配置对象并传递给processSubtitles
    const config: TranslationConfig = {
      inputFile,
      outputFile,
      sourceLanguage,
      targetLanguage,
      model,
      maxLength,
      concurrency,
      apiKey,
      apiBaseUrl,
    }

    await processSubtitles(config)
  })

program.parse(process.argv)
