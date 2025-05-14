#!/usr/bin/env node

import cliProgress from 'cli-progress'
import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import { globSync } from 'glob'

import { dumpSrt, Srt, SubtitleItem } from './lib/srt'
import { Translator } from './lib/translate'

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

const program = new Command()

program.name('srt-translator').description('CLI tool for translating SRT subtitle files using AI').version(getVersion())

program
  .argument('<inputFiles...>', 'Path(s) or glob pattern(s) for input SRT file(s)')
  .option('-o, --output <path>', 'Path to the output file or directory (defaults to input filename with prefix or input directory)')
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
  .option('--glossary-in <file>', 'Path to input glossary JSON file')
  .option('--glossary-out <file>', 'Path to output glossary JSON file')
  .option('--no-extract-glossary', 'Skip glossary extraction, use glossary-in directly if provided')
  .option('--no-progress', 'Disable progress bar display')
  .action(async (inputPatterns, options) => {
    const sourceLanguage = options.source || DEFAULT_SOURCE_LANGUAGE
    const targetLanguage = options.target || DEFAULT_TARGET_LANGUAGE
    const model = options.model || DEFAULT_MODEL
    const maxLength = parseInt(options.maxLength, 10)
    const concurrency = parseInt(options.concurrency, 10)
    let apiKey = options.apiKey
    const apiBaseUrl = options.apiBaseUrl
    const glossaryInputFile = options.glossaryIn
    const glossaryOutputFile = options.glossaryOut
    const noProgress = options.noProgress === true // Commander options might be true or undefined

    // Resolve input files using glob
    let allInputFiles: string[] = []
    for (const pattern of inputPatterns) {
      try {
        const files = globSync(pattern, { nodir: true, absolute: true, windowsPathsNoEscape: true })
        allInputFiles.push(...files)
      } catch (e) {
        console.warn(`Warning: Error processing glob pattern "${pattern}": ${e}`)
      }
    }
    // Remove duplicates and ensure files exist before further processing
    allInputFiles = [...new Set(allInputFiles)].filter(file => {
      if (fs.existsSync(file)) {
        return true
      }
      console.warn(`Warning: Input file "${file}" resolved by glob does not exist. Skipping.`)
      return false
    })


    if (allInputFiles.length === 0) {
      console.error('Error: No input files found or all resolved files do not exist.')
      process.exit(1)
    }

    console.log(`Found ${allInputFiles.length} input file(s):`)
    allInputFiles.forEach(file => console.log(`  - ${file}`))


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

    const userOutputPath = options.output

    console.log(`Source language: ${sourceLanguage}`)
    console.log(`Target language: ${targetLanguage}`)
    console.log(`AI model: ${model}`)
    console.log(`Max characters per batch: ${maxLength}`)
    console.log(`Concurrent batches: ${concurrency}`)
    if (finalApiBaseUrl) console.log(`API base URL: ${finalApiBaseUrl}`)
    if (glossaryInputFile) console.log(`Glossary input file: ${glossaryInputFile}`)
    if (glossaryOutputFile) console.log(`Glossary output file: ${glossaryOutputFile}`)
    if (noProgress) console.log('Progress bar disabled.')
    console.log('----------------------------')

    const translator = new Translator(model, apiKey, finalApiBaseUrl)
    let masterGlossary: Record<string, string> = {}

    // --- Stage 1: Glossary Handling ---
    console.log(options)
    const extractGlossary = options.extractGlossary

    // 加载输入术语表（如果提供）
    if (glossaryInputFile) {
      try {
        console.log(`Loading glossary from ${glossaryInputFile}...`)
        const glossaryContent = fs.readFileSync(glossaryInputFile, 'utf8')
        masterGlossary = JSON.parse(glossaryContent)
        console.log(`Loaded ${Object.keys(masterGlossary).length} glossary terms.`)
      } catch (error) {
        console.error(`Error loading glossary file: ${error}`)
        process.exit(1)
      }
    }

    // 如果指定了跳过术语表提取，则直接进入翻译阶段
    if (extractGlossary) {
      // 提取术语表
      console.log('Extracting master glossary from all input files...')
      const allSubtitleItemsForGlossary: SubtitleItem[] = []
      for (const inputFile of allInputFiles) {
        // Existence already checked, but double check doesn't hurt if files change mid-run
        if (!fs.existsSync(inputFile)) {
          console.warn(`Warning: Input file "${inputFile}" vanished before glossary extraction. Skipping.`)
          continue
        }
        try {
          const srtContent = fs.readFileSync(inputFile, 'utf8')
          const srt = new Srt(srtContent)
          allSubtitleItemsForGlossary.push(...srt.subtitles)
        } catch (error) {
          console.error(`Error reading or parsing SRT file ${inputFile} for glossary: ${error}`)
        }
      }

      if (allSubtitleItemsForGlossary.length > 0) {
        const glossaryBatches: SubtitleItem[][] = []
        let currentBatchLength = 0
        let currentBatch: SubtitleItem[] = []
        for (const subtitle of allSubtitleItemsForGlossary) {
          const textLength = subtitle.text.join('\n').length
          if (currentBatchLength + textLength > maxLength && currentBatch.length > 0) {
            glossaryBatches.push(currentBatch)
            currentBatch = []
            currentBatchLength = 0
          }
          currentBatch.push(subtitle)
          currentBatchLength += textLength
        }
        if (currentBatch.length > 0) glossaryBatches.push(currentBatch)

        console.log(`Extracting glossary from ${allSubtitleItemsForGlossary.length} subtitles in ${glossaryBatches.length} batches.`)
        
        let glossaryProgress: cliProgress.SingleBar | undefined
        if (!noProgress) {
          glossaryProgress = new cliProgress.SingleBar({
            format: 'Extracting master glossary: {bar} | {percentage}% | {value}/{total} | ETA: {eta}s',
          })
          glossaryProgress.start(glossaryBatches.length, 0)
        }

        for (const batch of glossaryBatches) {
          try {
            const result = await translator.extractGlossary({
              subtitles: batch,
              sourceLanguage,
              targetLanguage,
              existingGlossary: masterGlossary,
            })
            masterGlossary = result
          } catch (error) {
             console.error(`Error during glossary extraction for a batch: ${error}`)
          }
          glossaryProgress?.increment()
        }
        glossaryProgress?.stop()
        console.log(`Master glossary extraction completed. Total ${Object.keys(masterGlossary).length} terms.`)
      } else {
        console.log('No subtitles found across all files to extract master glossary.')
      }

      // 如果提供了输出术语表文件，保存术语表并退出
      if (glossaryOutputFile) {
        try {
          console.log(`Saving master glossary to ${glossaryOutputFile}...`)
          fs.writeFileSync(glossaryOutputFile, JSON.stringify(masterGlossary, null, 2))
          console.log(`Master glossary saved with ${Object.keys(masterGlossary).length} terms.`)
          console.log('Glossary extraction and saving complete. Exiting as per --glossary-out option.')
          process.exit(0)
        } catch (error) {
          console.error(`Error saving master glossary file: ${error}`)
          process.exit(1) // Exit with error if saving failed
        }
      }
    } else {
      console.log('Skipping glossary extraction as --no-extract-glossary is specified.')
      if (glossaryOutputFile) {
        console.log('Warning: --glossary-out is ignored when --no-extract-glossary is specified.')
      }
    } 

    // --- Stage 2: Translation ---
    // This stage is skipped if glossaryOutputFile was set and glossaryInputFile was not (due to process.exit(0) above).
    
    if (allInputFiles.length > 1 && userOutputPath && fs.existsSync(userOutputPath) && fs.statSync(userOutputPath).isFile()) {
      console.error(`Error: Output path "${userOutputPath}" is an existing file, but multiple input files were provided. Please specify an output directory.`)
      process.exit(1)
    }
    
    console.log('\nStarting translation process for each file...')
    for (const inputFile of allInputFiles) {
      let outputFilePath = userOutputPath

      if (allInputFiles.length > 1) {
        const inputBase = path.basename(inputFile, path.extname(inputFile))
        const defaultOutputName = `${inputBase}-${targetLanguage}-${model}${path.extname(inputFile)}`
        if (userOutputPath) {
          if (!fs.existsSync(userOutputPath)) {
            try {
              fs.mkdirSync(userOutputPath, { recursive: true })
              console.log(`Created output directory: ${userOutputPath}`)
            } catch (e) {
              console.error(`Error creating output directory ${userOutputPath}: ${e}. Skipping file ${inputFile}.`)
              continue
            }
          } else if (!fs.statSync(userOutputPath).isDirectory()) {
            console.error(`Error: Output path "${userOutputPath}" exists but is not a directory. Skipping file ${inputFile}.`)
            continue
          }
          outputFilePath = path.join(userOutputPath, defaultOutputName)
        } else {
          outputFilePath = path.join(path.dirname(inputFile), defaultOutputName)
        }
      } else { // Single input file
        if (!outputFilePath) {
          const inputExt = path.extname(inputFile)
          const inputBase = path.basename(inputFile, inputExt)
          const inputDir = path.dirname(inputFile)
          outputFilePath = path.join(inputDir, `${inputBase}-${targetLanguage}-${model}${inputExt}`)
        }
      }

      console.log(`\nTranslating file: ${inputFile}`)
      console.log(`Outputting to: ${outputFilePath}`)

      if (!fs.existsSync(inputFile)) {
        console.error(`Error: Input file "${inputFile}" does not exist at translation stage. Skipping.`)
        continue
      }
      
      let srtContent, srt, subtitles;
      try {
        srtContent = fs.readFileSync(inputFile, 'utf8')
        srt = new Srt(srtContent)
        subtitles = srt.subtitles
      } catch (error) {
        console.error(`Error reading or parsing SRT file ${inputFile} for translation: ${error}. Skipping.`)
        continue
      }


      if (subtitles.length === 0) {
        console.log('No subtitles to translate in this file. Writing empty SRT.')
        try {
          fs.writeFileSync(outputFilePath, '')
        } catch (error) {
          console.error(`Error writing empty SRT to ${outputFilePath}: ${error}`)
        }
        continue
      }

      const translationBatches: SubtitleItem[][] = []
      let currentBatchLength = 0
      let currentBatch: SubtitleItem[] = []
      for (const subtitle of subtitles) {
        const textLength = subtitle.text.join('\n').length
        if (currentBatchLength + textLength > maxLength && currentBatch.length > 0) {
          translationBatches.push(currentBatch)
          currentBatch = []
          currentBatchLength = 0
        }
        currentBatch.push(subtitle)
        currentBatchLength += textLength
      }
      if (currentBatch.length > 0) translationBatches.push(currentBatch)

      console.log(`Translating ${subtitles.length} subtitles in ${translationBatches.length} batches for this file.`)
      
      let translationProgress: cliProgress.SingleBar | undefined
      if (!noProgress) {
        translationProgress = new cliProgress.SingleBar({
          format: `Translating ${path.basename(inputFile)}: {bar} | {percentage}% | {value}/{total} | ETA: {eta}s`,
        })
        translationProgress.start(translationBatches.length, 0)
      }

      let translatedResults: Record<string, string> = {}
      const batchProcessingPromises: Promise<void>[] = []

      for (let i = 0; i < translationBatches.length; i += concurrency) {
        const concurrentBatchGroup = translationBatches.slice(i, i + concurrency)
        const batchPromises = concurrentBatchGroup.map(async (batch) => {
          try {
            const batchResult = await translator.translateText({
              subtitles: batch,
              glossary: masterGlossary,
              sourceLanguage,
              targetLanguage,
            })
            // Ensure thread-safe update to translatedResults if this were truly parallel in Node.js
            // For async/await with Promise.all, direct assignment is fine here.
            Object.assign(translatedResults, batchResult)
          } catch (error) {
            console.error(`Error translating a batch for ${inputFile}:`, error)
          }
          translationProgress?.increment()
        })
        batchProcessingPromises.push(...batchPromises)
      }
      await Promise.all(batchProcessingPromises)
      translationProgress?.stop()

      const translatedSrtItems = subtitles.map((subtitle) => ({
        ...subtitle,
        text: translatedResults[subtitle.hash]?.split('\n') || subtitle.text,
      }))
      const translatedSrtContent = dumpSrt(translatedSrtItems)
      try {
        fs.writeFileSync(outputFilePath, translatedSrtContent)
        console.log(`Translation completed for ${inputFile}, saved to ${outputFilePath}`)
      } catch (error) {
        console.error(`Error writing translated SRT to ${outputFilePath}: ${error}`)
      }
    }
    console.log('\nAll files processed.')
  })

program.parse(process.argv)
