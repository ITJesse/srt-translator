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
      // 添加换行符，确保后续输出从新行开始
      process.stdout.write("\n");
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
        enableCache,
        cacheDir,
        terminology,
      } = options;

      // Initialize translationService (先初始化服务，再输出信息)
      this.translationService = new TranslationService(
        apiKey,
        baseUrl,
        model,
        enableCache,
        cacheDir
      );

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

      // 输出初始信息 (移到服务初始化之后)
      console.log(`Translating file: ${input}`);
      console.log(`Target language: ${targetLanguage}`);
      console.log(`Output file: ${outputPath}`);
      console.log(`Cache: ${enableCache ? "enabled (disk)" : "disabled"}`);
      if (enableCache) {
        console.log(`Cache directory: ${cacheDir}`);
      }

      // 创建解析进度条
      this.createProgressBar(1, "Parsing subtitles");

      // Parse SRT file
      const subtitles = await this.srtService.parseSrtFile(input);
      this.stopProgressBar();

      this.log(`Found ${subtitles.length} subtitle entries`);

      // Extract text for translation
      const textsToTranslate =
        this.srtService.extractTextForTranslation(subtitles);

      // 在创建进度条前输出翻译信息
      console.log("Starting translation...");
      console.log(
        `Using translation model: ${
          model || this.translationService.getModel()
        }`
      );
      console.log(`Concurrent requests: ${concurrentRequests}`);

      // 创建翻译进度条
      this.createProgressBar(textsToTranslate.length, "Translation progress");

      // 直接使用翻译服务进行翻译
      const translationOptions: TranslationOptions = {
        sourceLanguage,
        targetLanguage,
        model,
        preserveFormatting,
        apiKey,
        baseUrl,
        maxBatchLength,
        concurrentRequests,
        terminology,
      };

      const translatedTexts = await this.translationService.translateTexts(
        textsToTranslate,
        translationOptions
      );

      this.stopProgressBar();

      // 显示缓存命中信息
      const cacheInfo = this.translationService.getCacheHitInfo();
      if (cacheInfo.total > 0) {
        console.log(`Cache hits: ${cacheInfo.hits}/${cacheInfo.total}`);
        console.log(
          `Created ${this.translationService.getLastBatchesCount()} batches for translation`
        );
      }

      // 创建写入进度条
      this.createProgressBar(1, "Writing results");

      // Create translated subtitles
      const translatedSubtitles = this.srtService.createTranslatedSubtitles(
        subtitles,
        translatedTexts
      );

      // Write translated SRT file
      const savedPath = await this.srtService.writeSrtFile(
        translatedSubtitles,
        outputPath
      );

      // 先停止进度条，再输出保存信息
      this.stopProgressBar();

      // 如果启用了术语提取，显示术语表信息
      if (terminology) {
        const terminologyInfo = this.translationService.getTerminology();
        if (terminologyInfo.length > 0) {
          console.log(
            `\nExtracted and translated ${terminologyInfo.length} terms for consistent translation:`
          );
          console.log("Original | Translation");
          console.log("-------- | -----------");
          // 只显示前10个术语，避免输出过多
          const displayCount = Math.min(terminologyInfo.length, 10);
          for (let i = 0; i < displayCount; i++) {
            console.log(
              `${terminologyInfo[i].original} | ${terminologyInfo[i].translated}`
            );
          }
          if (terminologyInfo.length > 10) {
            console.log(`... and ${terminologyInfo.length - 10} more terms`);
          }
        } else {
          console.log(
            "\nNo significant terms were extracted for this content."
          );
        }
      }

      // 输出保存信息
      console.log(`\nTranslated subtitles saved to: ${savedPath}`);
      console.log("\nTranslation completed successfully!");
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
   * Process multiple files in batch
   * @param patterns Glob patterns for input files
   * @param options CLI options
   */
  public async batchProcess(
    patterns: string[],
    options: Omit<CliOptions, "input" | "output">
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

      // Process files in parallel
      console.log("Processing files in parallel...");
      await Promise.all(
        inputFiles.map((input) =>
          this.run({
            ...options,
            input,
            output: FileUtils.generateOutputPath(input, options.targetLanguage),
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

      this.stopProgressBar();
      console.log("Batch processing completed!");

      // 输出批处理完成信息
      console.log(
        `\nBatch processing completed: ${processedCount} files translated successfully.`
      );

      // 如果启用了术语提取，显示术语表信息
      if (options.terminology) {
        const terminologyInfo = this.translationService.getTerminology();
        if (terminologyInfo.length > 0) {
          console.log(
            `\nExtracted and translated ${terminologyInfo.length} terms for consistent translation:`
          );
          console.log("Original | Translation");
          console.log("-------- | -----------");
          // 只显示前10个术语，避免输出过多
          const displayCount = Math.min(terminologyInfo.length, 10);
          for (let i = 0; i < displayCount; i++) {
            console.log(
              `${terminologyInfo[i].original} | ${terminologyInfo[i].translated}`
            );
          }
          if (terminologyInfo.length > 10) {
            console.log(`... and ${terminologyInfo.length - 10} more terms`);
          }
        } else {
          console.log(
            "\nNo significant terms were extracted for this content."
          );
        }
      }
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
    .option("--no-cache", "Disable translation caching")
    .option("--cache-dir <path>", "Directory to store translation cache")
    .option(
      "--terminology",
      "Enable terminology extraction and usage for consistent translation"
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
    .option("--no-cache", "Disable translation caching")
    .option("--cache-dir <path>", "Directory to store translation cache")
    .option(
      "--terminology",
      "Enable terminology extraction and usage for consistent translation"
    )
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (patterns, rawOptions) => {
      const translator = new SrtTranslator(rawOptions.verbose);
      const processedOptions = processOptions(rawOptions);
      await translator.batchProcess(patterns, processedOptions);
    });

  // Add examples to help text
  program.addHelpText(
    "after",
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
