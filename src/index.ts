#!/usr/bin/env node

import * as cliProgress from 'cli-progress'
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
dotenv.config();

/**
 * Main application class
 */
class SrtTranslator {
  private srtService: SrtService;
  private translationService!: TranslationService;
  private verbose: boolean = false;
  private progressBar: cliProgress.SingleBar | null = null;

  constructor(verbose: boolean = false) {
    this.srtService = new SrtService();
    this.verbose = verbose;
  }

  /**
   * Log message if verbose mode is enabled
   * @param message Message to log
   */
  private log(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }

  /**
   * 创建进度条
   * @param total 总数
   * @param title 进度条标题
   */
  private createProgressBar(total: number, title: string): void {
    this.progressBar = new cliProgress.SingleBar({
      format: `${title} [{bar}] {percentage}% | {value}/{total} | Time: {duration_formatted}`,
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    });
    this.progressBar.start(total, 0);
  }

  /**
   * 更新进度条
   * @param value 当前进度值
   */
  private updateProgressBar(value: number): void {
    if (this.progressBar) {
      this.progressBar.update(value);
    }
  }

  /**
   * 停止进度条
   */
  private stopProgressBar(): void {
    if (this.progressBar) {
      this.progressBar.stop();
      this.progressBar = null;
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
        preserveFormatting,
        apiKey,
        baseUrl,
        maxBatchLength,
        concurrentRequests,
      } = options;

      // Initialize translationService
      this.translationService = new TranslationService(apiKey, baseUrl, model);

      // Validate input file
      if (!(await FileUtils.fileExists(input))) {
        throw new Error(`Input file not found: ${input}`);
      }

      if (!FileUtils.isSrtFile(input)) {
        throw new Error(`Input file must be an SRT file: ${input}`);
      }

      // Determine output path
      const outputPath =
        output || FileUtils.generateOutputPath(input, targetLanguage);

      // Ensure output directory exists
      await FileUtils.ensureDirectoryExists(path.dirname(outputPath));

      console.log(`Translating file: ${input}`);
      console.log(`Target language: ${targetLanguage}`);
      console.log(`Output file: ${outputPath}`);

      // 创建解析进度条
      this.createProgressBar(1, "Parsing subtitles");

      // Parse SRT file
      const subtitles = await this.srtService.parseSrtFile(input);
      this.stopProgressBar();

      this.log(`Found ${subtitles.length} subtitle entries`);

      // Extract text for translation
      const textsToTranslate =
        this.srtService.extractTextForTranslation(subtitles);

      // Use initialized translationService
      const translationService = this.translationService;

      // 创建翻译进度条
      console.log("Starting translation...");
      this.createProgressBar(textsToTranslate.length, "Translation progress");

      // 创建一个包装的翻译服务，用于更新进度条
      const translatedTexts = await this.translateWithProgress(
        translationService,
        textsToTranslate,
        {
          sourceLanguage,
          targetLanguage,
          model,
          preserveFormatting,
          apiKey,
          baseUrl,
          maxBatchLength,
          concurrentRequests,
        }
      );

      this.stopProgressBar();

      // 创建写入进度条
      this.createProgressBar(1, "Writing results");

      // Create translated subtitles
      const translatedSubtitles = this.srtService.createTranslatedSubtitles(
        subtitles,
        translatedTexts
      );

      // Write translated SRT file
      await this.srtService.writeSrtFile(translatedSubtitles, outputPath);

      this.stopProgressBar();

      console.log("Translation completed successfully!");
    } catch (error) {
      // 确保进度条被停止
      this.stopProgressBar();

      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  }

  /**
   * 带进度条的翻译方法
   * @param translationService 翻译服务
   * @param texts 要翻译的文本数组
   * @param options 翻译选项
   * @returns 翻译后的文本数组
   */
  private async translateWithProgress(
    translationService: TranslationService,
    texts: string[],
    options: TranslationOptions
  ): Promise<string[]> {
    // 创建一个计数器来跟踪已完成的翻译
    let completedCount = 0;

    // 创建一个代理方法来拦截翻译批次的完成
    const originalTranslateTexts =
      translationService.translateTexts.bind(translationService);

    // 重写翻译方法以添加进度更新
    translationService.translateTexts = async (
      textsToTranslate: string[],
      translationOptions: TranslationOptions
    ): Promise<string[]> => {
      // 调用原始方法
      const result = await originalTranslateTexts(
        textsToTranslate,
        translationOptions
      );

      // 更新进度
      completedCount += textsToTranslate.length;
      this.updateProgressBar(completedCount);

      return result;
    };

    // 执行翻译
    return await translationService.translateTexts(texts, options);
  }

  /**
   * Process multiple files in batch
   * @param patterns Glob patterns for input files
   * @param options CLI options
   * @param parallel Whether to process files in parallel
   */
  public async batchProcess(
    patterns: string[],
    options: Omit<CliOptions, "input" | "output">,
    parallel: boolean = false
  ): Promise<void> {
    try {
      // Find all matching files
      console.log("Searching for matching subtitle files...");
      this.createProgressBar(1, "Finding files");

      const inputFiles: string[] = [];
      for (const pattern of patterns) {
        // Use the modern async glob API
        const matches = await glob(pattern);
        inputFiles.push(...matches.filter((file) => FileUtils.isSrtFile(file)));
      }

      this.stopProgressBar();

      if (inputFiles.length === 0) {
        throw new Error("No SRT files found matching the provided patterns");
      }

      console.log(`Found ${inputFiles.length} SRT files to process`);
      this.createProgressBar(inputFiles.length, "Batch processing progress");
      let processedCount = 0;

      if (parallel) {
        // Process files in parallel
        console.log("Processing files in parallel...");
        await Promise.all(
          inputFiles.map((input) =>
            this.run({
              ...options,
              input,
              output: FileUtils.generateOutputPath(
                input,
                options.targetLanguage
              ),
            })
              .then(() => {
                processedCount++;
                this.updateProgressBar(processedCount);
              })
              .catch((error: unknown) => {
                console.error(
                  `Error processing ${input}: ${
                    error instanceof Error ? error.message : String(error)
                  }`
                );
                processedCount++;
                this.updateProgressBar(processedCount);
              })
          )
        );
      } else {
        // Process files sequentially
        console.log("Processing files sequentially...");
        for (const input of inputFiles) {
          try {
            await this.run({
              ...options,
              input,
              output: FileUtils.generateOutputPath(
                input,
                options.targetLanguage
              ),
            });
          } catch (error: unknown) {
            console.error(
              `Error processing ${input}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
          processedCount++;
          this.updateProgressBar(processedCount);
        }
      }

      this.stopProgressBar();
      console.log("Batch processing completed!");
    } catch (error) {
      // 确保进度条被停止
      this.stopProgressBar();

      console.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    }
  }
}

/**
 * Setup CLI commands and options
 */
function setupCli(): Command {
  const program = new Command();

  program
    .name("srt-translator")
    .description("Translate SRT subtitle files using AI")
    .version("1.0.0");

  // Single file command (default)
  program
    .command("translate <input>")
    .description("Translate a single SRT file")
    .option("-o, --output <path>", "Output SRT file path")
    .option(
      "-s, --source-language <language>",
      "Source language (auto-detect if not specified)"
    )
    .option("-t, --target-language <language>", "Target language")
    .option("-m, --model <model>", "OpenAI model to use")
    .option("-p, --preserve-formatting", "Preserve original formatting")
    .option(
      "-k, --api-key <key>",
      "OpenAI API key (overrides OPENAI_API_KEY environment variable)"
    )
    .option(
      "-b, --base-url <url>",
      "OpenAI API base URL (overrides OPENAI_API_BASE_URL environment variable)"
    )
    .option(
      "-l, --max-batch-length <length>",
      "Maximum character length per batch"
    )
    .option(
      "-c, --concurrent-requests <number>",
      "Number of concurrent translation requests"
    )
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (input, rawOptions) => {
      const translator = new SrtTranslator(rawOptions.verbose);
      const processedOptions = processOptions(rawOptions);
      await translator.run({
        ...processedOptions,
        input,
        output: rawOptions.output,
      });
    });

  // Batch processing command
  program
    .command("batch <patterns...>")
    .description("Translate multiple SRT files using glob patterns")
    .option(
      "-s, --source-language <language>",
      "Source language (auto-detect if not specified)"
    )
    .option("-t, --target-language <language>", "Target language")
    .option("-m, --model <model>", "OpenAI model to use")
    .option("-p, --preserve-formatting", "Preserve original formatting")
    .option(
      "-k, --api-key <key>",
      "OpenAI API key (overrides OPENAI_API_KEY environment variable)"
    )
    .option(
      "-b, --base-url <url>",
      "OpenAI API base URL (overrides OPENAI_API_BASE_URL environment variable)"
    )
    .option(
      "-l, --max-batch-length <length>",
      "Maximum character length per batch"
    )
    .option(
      "-c, --concurrent-requests <number>",
      "Number of concurrent translation requests"
    )
    .option("--parallel", "Process files in parallel")
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (patterns, rawOptions) => {
      const translator = new SrtTranslator(rawOptions.verbose);
      const processedOptions = processOptions(rawOptions);
      await translator.batchProcess(
        patterns,
        processedOptions,
        rawOptions.parallel
      );
    });

  // Add examples to help text
  program.addHelpText(
    "after",
    `
Examples:
  $ srt-translator translate movie.srt -t Chinese          # Translate movie.srt to Chinese
  $ srt-translator translate movie.srt -t Chinese -c 3     # Translate with 3 concurrent requests
  $ srt-translator batch "**/*.srt" -t French              # Translate all SRT files to French
  $ srt-translator batch "movies/*.srt" -t German --parallel # Translate all SRTs in parallel
  $ srt-translator batch "movies/*.srt" -t German -c 5     # Translate with 5 concurrent requests
`
  );

  return program;
}

// Run the CLI if this file is executed directly
if (require.main === module) {
  const program = setupCli();
  program.parse(process.argv);
}

// Export for programmatic usage
export { SrtTranslator };
