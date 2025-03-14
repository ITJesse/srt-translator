import OpenAI from 'openai'

import { TranslationOptions } from '../types'

/**
 * Service for handling translations using OpenAI API
 */
export class TranslationService {
  private openai: OpenAI;
  private model: string;

  /**
   * Initialize the translation service
   * @param apiKey OpenAI API key
   * @param baseUrl OpenAI API base URL
   * @param model OpenAI model to use
   */
  constructor(apiKey: string, baseUrl: string, model: string) {
    if (!apiKey) {
      throw new Error("API key is required");
    }

    if (!model) {
      throw new Error("Model is required");
    }

    this.openai = new OpenAI({
      apiKey: apiKey,
      baseURL: baseUrl,
    });

    this.model = model;
    console.log(`Initialized TranslationService with model: ${this.model}`);
  }

  /**
   * Translate an array of text strings
   * @param texts Array of text strings to translate
   * @param options Translation options
   * @returns Array of translated text strings
   */
  public async translateTexts(
    texts: string[],
    options: TranslationOptions
  ): Promise<string[]> {
    const {
      sourceLanguage,
      targetLanguage,
      model,
      preserveFormatting,
      apiKey,
      baseUrl,
      maxBatchLength,
      concurrentRequests,
    } = options;

    // 使用传入的模型
    const modelToUse = model || this.model;

    // 输出使用的模型信息
    console.log(`Using translation model: ${modelToUse}`);
    console.log(`Concurrent requests: ${concurrentRequests}`);

    // Reinitialize OpenAI client if custom API key or baseUrl is provided
    if (apiKey || baseUrl) {
      this.openai = new OpenAI({
        apiKey: apiKey,
        baseURL: baseUrl,
      });
    }

    // Prepare the system prompt
    const systemPrompt = this.createSystemPrompt(
      targetLanguage,
      preserveFormatting === undefined ? true : preserveFormatting,
      sourceLanguage
    );

    // Process texts in batches based on text length to avoid token limits
    const batches = this.createBatches(texts, maxBatchLength as number);
    console.log(`Created ${batches.length} batches for translation`);

    // 使用并行处理批次
    if (concurrentRequests && concurrentRequests > 1) {
      return await this.translateBatchesParallel(
        batches,
        systemPrompt,
        modelToUse,
        concurrentRequests
      );
    } else {
      // 使用原有的顺序处理方式
      return await this.translateBatchesSequential(
        batches,
        systemPrompt,
        modelToUse
      );
    }
  }

  /**
   * 顺序处理批次
   * @param batches 批次数组
   * @param systemPrompt 系统提示
   * @param model 使用的模型
   * @returns 翻译结果数组
   */
  private async translateBatchesSequential(
    batches: string[][],
    systemPrompt: string,
    model: string
  ): Promise<string[]> {
    const translatedBatches: string[][] = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchItemCount = batch.length;
      const batchTotalLength = batch.reduce(
        (sum, text) => sum + text.length,
        0
      );
      console.log(
        `Translating batch ${i + 1}/${
          batches.length
        } (${batchItemCount} items, ${batchTotalLength} characters)...`
      );

      const translatedBatch = await this.translateBatch(
        batch,
        systemPrompt,
        model
      );
      translatedBatches.push(translatedBatch);
    }

    // Flatten the batches back into a single array
    return translatedBatches.flat();
  }

  /**
   * 并行处理批次
   * @param batches 批次数组
   * @param systemPrompt 系统提示
   * @param model 使用的模型
   * @param concurrentRequests 并行请求数量
   * @returns 翻译结果数组
   */
  private async translateBatchesParallel(
    batches: string[][],
    systemPrompt: string,
    model: string,
    concurrentRequests: number
  ): Promise<string[]> {
    const results: string[][] = new Array(batches.length);
    let currentBatchIndex = 0;

    // 创建一个处理批次的函数
    const processBatch = async (): Promise<void> => {
      while (currentBatchIndex < batches.length) {
        const batchIndex = currentBatchIndex++;
        const batch = batches[batchIndex];

        const batchItemCount = batch.length;
        const batchTotalLength = batch.reduce(
          (sum, text) => sum + text.length,
          0
        );
        console.log(
          `Translating batch ${batchIndex + 1}/${
            batches.length
          } (${batchItemCount} items, ${batchTotalLength} characters)...`
        );

        try {
          const translatedBatch = await this.translateBatch(
            batch,
            systemPrompt,
            model
          );
          results[batchIndex] = translatedBatch;
        } catch (error) {
          console.error(
            `Error translating batch ${batchIndex + 1}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          // 重试失败的批次
          currentBatchIndex--;
        }
      }
    };

    // 创建并发处理器
    const processors: Promise<void>[] = [];
    const actualConcurrency = Math.min(concurrentRequests, batches.length);

    console.log(
      `Starting ${actualConcurrency} concurrent translation processors`
    );

    for (let i = 0; i < actualConcurrency; i++) {
      processors.push(processBatch());
    }

    // 等待所有处理器完成
    await Promise.all(processors);

    // 按原始顺序返回结果
    return results.flat();
  }

  /**
   * Create batches from an array of texts based on character length
   * @param texts Array of text strings
   * @param maxBatchLength Maximum character length for each batch
   * @returns Array of batches
   */
  private createBatches(texts: string[], maxBatchLength: number): string[][] {
    const batches: string[][] = [];
    let currentBatch: string[] = [];
    let currentBatchLength = 0;

    for (const text of texts) {
      // 如果当前批次为空或添加此文本后不超过最大长度，则添加到当前批次
      if (
        currentBatch.length === 0 ||
        currentBatchLength + text.length <= maxBatchLength
      ) {
        currentBatch.push(text);
        currentBatchLength += text.length;
      } else {
        // 否则，完成当前批次并开始新批次
        batches.push(currentBatch);
        currentBatch = [text];
        currentBatchLength = text.length;
      }
    }

    // 添加最后一个批次（如果有）
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  /**
   * Translate a batch of text strings
   * @param batch Array of text strings
   * @param systemPrompt System prompt for the AI
   * @param model OpenAI model to use
   * @returns Array of translated text strings
   */
  private async translateBatch(
    batch: string[],
    systemPrompt: string,
    model: string
  ): Promise<string[]> {
    try {
      // Format the batch as a JSON array string
      const batchJson = JSON.stringify(batch);

      // 创建请求选项
      const requestOptions: any = {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Translate the following subtitle texts (provided as JSON array):\n${batchJson}`,
          },
        ],
        temperature: 0.3,
      };

      // 只有OpenAI模型才添加response_format选项
      if (model.startsWith("gpt-")) {
        requestOptions.response_format = { type: "json_object" };
      }

      const response = await this.openai.chat.completions.create(
        requestOptions
      );

      const content = response.choices[0]?.message.content;

      if (!content) {
        throw new Error("No content in translation response");
      }

      // Parse the JSON response
      let parsedContent;
      try {
        parsedContent = JSON.parse(content);
      } catch (error) {
        console.error("Failed to parse JSON response:", content);
        // 尝试从非JSON响应中提取翻译结果
        if (Array.isArray(batch) && content.includes("\n")) {
          // 假设每行对应一个翻译
          const lines = content.split("\n").filter((line) => line.trim());
          if (lines.length === batch.length) {
            return lines;
          }
        }
        throw new Error("Invalid translation response format: not valid JSON");
      }

      if (
        !parsedContent.translations ||
        !Array.isArray(parsedContent.translations)
      ) {
        // 尝试其他可能的响应格式
        if (
          Array.isArray(parsedContent) &&
          parsedContent.length === batch.length
        ) {
          return parsedContent;
        }
        throw new Error(
          "Invalid translation response format: missing translations array"
        );
      }

      return parsedContent.translations;
    } catch (error) {
      console.error(
        `Translation error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Create a system prompt for the AI
   * @param sourceLanguage Source language
   * @param targetLanguage Target language
   * @param preserveFormatting Whether to preserve formatting
   * @returns System prompt string
   */
  private createSystemPrompt(
    targetLanguage: string,
    preserveFormatting: boolean,
    sourceLanguage?: string
  ): string {
    let prompt = `You are a professional subtitle translator. `;

    if (sourceLanguage) {
      prompt += `Translate from ${sourceLanguage} to ${targetLanguage}. `;
    } else {
      prompt += `Translate to ${targetLanguage}. `;
    }

    if (preserveFormatting) {
      prompt += `Preserve all formatting, line breaks, and special characters. `;
    }

    prompt += `
Your task is to translate each subtitle text accurately while maintaining the original meaning and tone.
Respond with a JSON object containing a "translations" array with the translated texts in the same order as the input.
Example response format: { "translations": ["translated text 1", "translated text 2", ...] }
`;

    return prompt;
  }
}
