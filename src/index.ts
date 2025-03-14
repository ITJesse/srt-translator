#!/usr/bin/env node

import { Command } from 'commander'
import * as dotenv from 'dotenv'
import { glob } from 'glob'
import * as path from 'path'

import { SrtService } from './services/srtService'
import { TranslationService } from './services/translationService'
import { CliOptions, TranslationOptions } from './types'
import { FileUtils } from './utils/fileUtils'
import { processOptions } from './utils/optionsUtils'

// Load environment variables from .env file
dotenv.config()

/**
 * Main application class
 */
class SrtTranslator {
  private srtService: SrtService
  private translationService!: TranslationService
  private verbose: boolean = false

  constructor(verbose: boolean = false) {
    this.srtService = new SrtService()
    this.verbose = verbose
  }

  /**
   * Log message if verbose mode is enabled
   * @param message Message to log
   */
  private log(message: string): void {
    if (this.verbose) {
      console.log(message)
    }
  }

  /**
   * Run the translation process
   * @param options CLI options
   */
  public async run(options: CliOptions): Promise<void> {
    try {
      const {
        input,
        output,
        sourceLanguage,
        targetLanguage,
        model,
        apiKey,
        baseUrl,
        maxBatchLength,
        concurrentRequests,
        enableCache,
        cacheDir,
        terminology,
      } = options

      // Initialize translationService (先初始化服务，再输出信息)
      this.translationService = new TranslationService(apiKey, baseUrl, model, enableCache, cacheDir)

      // Validate input file
      if (!(await FileUtils.fileExists(input))) {
        throw new Error(`Input file not found: ${input}`)
      }

      if (!FileUtils.isSrtFile(input)) {
        throw new Error(`Input file must be an SRT file: ${input}`)
      }

      // Determine output path
      const outputPath = output || FileUtils.generateOutputPath(input, targetLanguage)

      // Ensure output directory exists
      await FileUtils.ensureDirectoryExists(path.dirname(outputPath))

      // 输出初始信息 (移到服务初始化之后)
      console.log(`Translating file: ${input}`)
      console.log(`Target language: ${targetLanguage}`)
      console.log(`Output file: ${outputPath}`)
      console.log(`Cache: ${enableCache ? 'enabled (disk)' : 'disabled'}`)
      if (enableCache) {
        console.log(`Cache directory: ${cacheDir}`)
      }
      if (terminology) {
        console.log(`Terminology extraction: enabled (将先提取术语，再进行翻译)`)
      }

      // Parse SRT file
      console.log('Parsing subtitles...')
      const subtitles = await this.srtService.parseSrtFile(input)
      console.log('Subtitle parsing completed')

      this.log(`Found ${subtitles.length} subtitle entries`)

      // Extract text for translation
      const textsToTranslate = this.srtService.extractTextForTranslation(subtitles)

      // 在创建进度条前输出翻译信息
      console.log('Starting translation process...')
      console.log(`Using translation model: ${model || this.translationService.getModel()}`)
      console.log(`Concurrent requests: ${concurrentRequests}`)

      // 直接使用翻译服务进行翻译
      const translationOptions: TranslationOptions = {
        sourceLanguage,
        targetLanguage,
        model,
        apiKey,
        baseUrl,
        maxBatchLength,
        concurrentRequests,
        terminology,
      }

      console.log(`Translating ${textsToTranslate.length} subtitle entries...`)
      const translatedTexts = await this.translationService.translateTexts(textsToTranslate, translationOptions)
      console.log('Translation completed')

      // 显示缓存命中信息
      const cacheInfo = this.translationService.getCacheHitInfo()
      if (cacheInfo.total > 0) {
        console.log(`Cache hits: ${cacheInfo.hits}/${cacheInfo.total}`)
        console.log(`Created ${this.translationService.getLastBatchesCount()} batches for translation`)
      }

      console.log('Writing translated subtitles...')
      // Create translated subtitles
      const translatedSubtitles = this.srtService.createTranslatedSubtitles(subtitles, translatedTexts)

      // Write translated SRT file
      const savedPath = await this.srtService.writeSrtFile(translatedSubtitles, outputPath)

      // 如果启用了术语提取，显示术语表信息
      if (terminology) {
        const terminologyInfo = this.translationService.getTerminology()
        if (terminologyInfo.length > 0) {
          console.log(`\n术语提取与翻译总结：已提取并翻译 ${terminologyInfo.length} 个术语，并在翻译过程中保持一致性`)
          console.log('原文术语 | 翻译')
          console.log('-------- | -----------')
          // 只显示前10个术语，避免输出过多
          const displayCount = Math.min(terminologyInfo.length, 10)
          for (let i = 0; i < displayCount; i++) {
            console.log(`${terminologyInfo[i].original} | ${terminologyInfo[i].translated}`)
          }
          if (terminologyInfo.length > 10) {
            console.log(`... 以及其他 ${terminologyInfo.length - 10} 个术语`)
          }
        } else {
          console.log('\n术语提取结果：未从内容中提取到重要术语。')
        }
      }

      // 输出保存信息
      console.log(`\nTranslated subtitles saved to: ${savedPath}`)
      console.log('\nTranslation completed successfully!')
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  }

  /**
   * Process multiple files in batch
   * @param patterns Glob patterns for input files
   * @param options CLI options
   */
  public async batchProcess(patterns: string[], options: Omit<CliOptions, 'input' | 'output'>): Promise<void> {
    try {
      // Find all matching files
      console.log('Searching for matching subtitle files...')

      const inputFiles: string[] = []
      for (const pattern of patterns) {
        // Use the modern async glob API
        const matches = await glob(pattern)
        inputFiles.push(...matches.filter((file) => FileUtils.isSrtFile(file)))
      }

      if (inputFiles.length === 0) {
        throw new Error('No SRT files found matching the provided patterns')
      }

      console.log(`Found ${inputFiles.length} SRT files to process`)

      // 初始化翻译服务
      this.translationService = new TranslationService(
        options.apiKey,
        options.baseUrl,
        options.model,
        options.enableCache,
        options.cacheDir,
      )

      // 如果启用了术语功能，显示相关信息
      if (options.terminology) {
        console.log(`Terminology extraction: enabled (将先提取术语，再进行翻译)`)
      }

      console.log('Processing files in parallel...')
      let processedCount = 0

      // Process files in parallel
      await Promise.all(
        inputFiles.map((input) =>
          this.run({
            ...options,
            input,
            output: FileUtils.generateOutputPath(input, options.targetLanguage),
          })
            .then(() => {
              processedCount++
              console.log(`Processed ${processedCount}/${inputFiles.length} files`)
            })
            .catch((error: unknown) => {
              console.error(`Error processing ${input}: ${error instanceof Error ? error.message : String(error)}`)
              processedCount++
              console.log(`Processed ${processedCount}/${inputFiles.length} files`)
            }),
        ),
      )

      // 输出批处理完成信息
      console.log(`\n批处理已完成: ${processedCount} 个文件翻译成功。`)

      // 如果启用了术语提取，显示术语表信息
      if (options.terminology) {
        const terminologyInfo = this.translationService.getTerminology()
        if (terminologyInfo.length > 0) {
          console.log(`\n术语提取与翻译总结：已提取并翻译 ${terminologyInfo.length} 个术语，并在翻译过程中保持一致性`)
          console.log('原文术语 | 翻译')
          console.log('-------- | -----------')
          // 只显示前10个术语，避免输出过多
          const displayCount = Math.min(terminologyInfo.length, 10)
          for (let i = 0; i < displayCount; i++) {
            console.log(`${terminologyInfo[i].original} | ${terminologyInfo[i].translated}`)
          }
          if (terminologyInfo.length > 10) {
            console.log(`... 以及其他 ${terminologyInfo.length - 10} 个术语`)
          }
        } else {
          console.log('\n术语提取结果：未从内容中提取到重要术语。')
        }
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  }
}

/**
 * Setup CLI commands and options
 */
function setupCli(): Command {
  const program = new Command()

  program.name('srt-translator').description('Translate SRT subtitle files using AI').version('1.0.0')

  // Single file command (default)
  program
    .command('translate <input>')
    .description('Translate a single SRT file')
    .option('-o, --output <path>', 'Output SRT file path')
    .option('-s, --source-language <language>', 'Source language (auto-detect if not specified)')
    .option('-t, --target-language <language>', 'Target language')
    .option('-m, --model <model>', 'OpenAI model to use')
    .option('-k, --api-key <key>', 'OpenAI API key (overrides OPENAI_API_KEY environment variable)')
    .option('-b, --base-url <url>', 'OpenAI API base URL (overrides OPENAI_API_BASE_URL environment variable)')
    .option('-l, --max-batch-length <length>', 'Maximum character length per batch')
    .option('-c, --concurrent-requests <number>', 'Number of concurrent translation requests')
    .option('--no-cache', 'Disable translation caching')
    .option('--cache-dir <path>', 'Directory to store translation cache')
    .option('--terminology', 'Enable terminology extraction and usage for consistent translation')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (input, rawOptions) => {
      const translator = new SrtTranslator(rawOptions.verbose)
      const processedOptions = processOptions(rawOptions)
      await translator.run({
        ...processedOptions,
        input,
        output: rawOptions.output,
      })
    })

  // Batch processing command
  program
    .command('batch <patterns...>')
    .description('Translate multiple SRT files using glob patterns')
    .option('-s, --source-language <language>', 'Source language (auto-detect if not specified)')
    .option('-t, --target-language <language>', 'Target language')
    .option('-m, --model <model>', 'OpenAI model to use')
    .option('-k, --api-key <key>', 'OpenAI API key (overrides OPENAI_API_KEY environment variable)')
    .option('-b, --base-url <url>', 'OpenAI API base URL (overrides OPENAI_API_BASE_URL environment variable)')
    .option('-l, --max-batch-length <length>', 'Maximum character length per batch')
    .option('-c, --concurrent-requests <number>', 'Number of concurrent translation requests')
    .option('--no-cache', 'Disable translation caching')
    .option('--cache-dir <path>', 'Directory to store translation cache')
    .option('--terminology', 'Enable terminology extraction and usage for consistent translation')
    .option('-v, --verbose', 'Enable verbose logging')
    .action(async (patterns, rawOptions) => {
      const translator = new SrtTranslator(rawOptions.verbose)
      const processedOptions = processOptions(rawOptions)
      await translator.batchProcess(patterns, processedOptions)
    })

  // Add examples to help text
  program.addHelpText(
    'after',
    `
Examples:
  $ srt-translator translate movie.srt -t Chinese          # Translate movie.srt to Chinese
  $ srt-translator translate movie.srt -t Chinese -c 3     # Translate with 3 concurrent requests
  $ srt-translator translate movie.srt -t Chinese --no-cache # Translate without using cache
  $ srt-translator translate movie.srt -t Chinese --cache-dir ./my-cache # Use custom cache directory
  $ srt-translator translate movie.srt -t Chinese --terminology # Use terminology for consistency
  $ srt-translator batch "**/*.srt" -t French              # Translate all SRT files to French
  $ srt-translator batch "movies/*.srt" -t German -c 5     # Translate with 5 concurrent requests
  $ srt-translator batch "movies/*.srt" -t German --terminology # Use terminology for consistency
`,
  )

  return program
}

// Run the CLI if this file is executed directly
if (require.main === module) {
  const program = setupCli()
  program.parse(process.argv)
}

// Export for programmatic usage
export { SrtTranslator }
