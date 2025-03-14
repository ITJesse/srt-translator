#!/usr/bin/env node

import { Command } from 'commander'
import * as dotenv from 'dotenv'
import * as fs from 'fs'
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
      } = options;

      // 确保必要参数不为 undefined
      if (!apiKey) {
        throw new Error("API key is required");
      }

      if (!baseUrl) {
        throw new Error("Base URL is required");
      }

      if (!model) {
        throw new Error("Model is required");
      }

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

      console.log(`Translating: ${input}`);
      console.log(`Target language: ${targetLanguage}`);
      console.log(`Output: ${outputPath}`);

      // Parse SRT file
      const subtitles = await this.srtService.parseSrtFile(input);
      this.log(`Found ${subtitles.length} subtitle entries`);

      // Extract text for translation
      const textsToTranslate =
        this.srtService.extractTextForTranslation(subtitles);

      // Use initialized translationService
      const translationService = this.translationService;

      // Translate texts
      console.log("Starting translation...");
      const translatedTexts = await translationService.translateTexts(
        textsToTranslate,
        {
          sourceLanguage,
          targetLanguage,
          model,
          preserveFormatting,
          apiKey,
          baseUrl,
          maxBatchLength,
        }
      );

      // Create translated subtitles
      const translatedSubtitles = this.srtService.createTranslatedSubtitles(
        subtitles,
        translatedTexts
      );

      // Write translated SRT file
      await this.srtService.writeSrtFile(translatedSubtitles, outputPath);

      console.log("Translation completed successfully!");
    } catch (error) {
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
   * @param parallel Whether to process files in parallel
   */
  public async batchProcess(
    patterns: string[],
    options: Omit<CliOptions, "input" | "output">,
    parallel: boolean = false
  ): Promise<void> {
    try {
      // Find all matching files
      const inputFiles: string[] = [];
      for (const pattern of patterns) {
        // Use the modern async glob API
        const matches = await glob(pattern);
        inputFiles.push(...matches.filter((file) => FileUtils.isSrtFile(file)));
      }

      if (inputFiles.length === 0) {
        throw new Error("No SRT files found matching the provided patterns");
      }

      console.log(`Found ${inputFiles.length} SRT files to process`);

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
            }).catch((error: unknown) => {
              console.error(
                `Error processing ${input}: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
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
        }
      }

      console.log("Batch processing completed!");
    } catch (error) {
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
    .option("-v, --verbose", "Enable verbose logging")
    .action(async (input, rawOptions) => {
      const translator = new SrtTranslator(rawOptions.verbose);
      const processedOptions = processOptions(rawOptions);
      await translator.run({
        input,
        output: rawOptions.output,
        ...processedOptions,
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
  $ srt-translator batch "**/*.srt" -t French              # Translate all SRT files to French
  $ srt-translator batch "movies/*.srt" -t German --parallel # Translate all SRTs in parallel
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
