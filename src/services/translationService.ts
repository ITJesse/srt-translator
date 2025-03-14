import OpenAI from 'openai'

import { TerminologyEntry, TranslationOptions } from '../types'
import { CacheService } from './cacheService'

/**
 * Service for handling translations using OpenAI API
 */
export class TranslationService {
  private openai: OpenAI;
  private model: string;
  private cacheService: CacheService;
  private lastCacheHits: number = 0;
  private lastTotalTexts: number = 0;
  private lastBatchesCount: number = 0;
  private terminology: TerminologyEntry[] = []; // 术语表

  /**
   * Initialize the translation service
   * @param apiKey OpenAI API key
   * @param baseUrl OpenAI API base URL
   * @param model OpenAI model to use
   * @param enableCache Whether to enable caching (default: true)
   * @param cacheDir Cache directory (default: ~/.srt-translator/cache)
   */
  constructor(
    apiKey: string,
    baseUrl: string,
    model: string,
    enableCache: boolean = true,
    cacheDir?: string
  ) {
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
    this.cacheService = new CacheService(enableCache, cacheDir);
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
      enableCache,
      cacheDir,
      extractTerms,
      useTerminology,
    } = options;

    // 使用传入的模型
    const modelToUse = model || this.model;

    // 设置缓存状态
    if (enableCache !== undefined) {
      this.cacheService.setEnabled(enableCache);
    }

    // 设置缓存目录
    if (cacheDir) {
      this.cacheService.setCacheDir(cacheDir);
    }

    // Reinitialize OpenAI client if custom API key or baseUrl is provided
    if (apiKey || baseUrl) {
      this.openai = new OpenAI({
        apiKey: apiKey,
        baseURL: baseUrl,
      });
    }

    // 检查缓存并过滤需要翻译的文本
    const translationResults: string[] = new Array(texts.length);
    const textsToTranslate: string[] = [];
    const indexMap: number[] = [];
    let cacheHits = 0;

    // 首先检查缓存
    if (this.cacheService.isEnabled()) {
      for (let i = 0; i < texts.length; i++) {
        const cachedTranslation = this.cacheService.get(
          texts[i],
          targetLanguage,
          sourceLanguage,
          modelToUse
        );

        if (cachedTranslation) {
          translationResults[i] = cachedTranslation;
          cacheHits++;
          // 移除详细的缓存命中日志，避免干扰进度条
          // console.log(`Cache hit for text: "${texts[i].substring(0, 30)}${texts[i].length > 30 ? "..." : ""}"`);
        } else {
          textsToTranslate.push(texts[i]);
          indexMap.push(i);
        }
      }

      // 将缓存命中信息存储为属性，而不是直接输出
      this.lastCacheHits = cacheHits;
      this.lastTotalTexts = texts.length;
    } else {
      textsToTranslate.push(...texts);
      indexMap.push(...Array.from({ length: texts.length }, (_, i) => i));
    }

    // 如果所有文本都已缓存，直接返回结果
    if (textsToTranslate.length === 0) {
      // 不直接输出到控制台，而是设置属性
      this.lastBatchesCount = 0;
      return translationResults;
    }

    // Process texts in batches based on text length to avoid token limits
    const batches = this.createBatches(
      textsToTranslate,
      maxBatchLength as number
    );
    // 存储批次信息而不是直接输出
    this.lastBatchesCount = batches.length;

    // 如果启用了术语提取，先提取并翻译术语
    if (extractTerms) {
      await this.extractAndTranslateTerms(
        batches,
        sourceLanguage,
        targetLanguage,
        modelToUse,
        preserveFormatting === undefined ? true : preserveFormatting
      );
    }

    // Prepare the system prompt
    const systemPrompt = this.createSystemPrompt(
      targetLanguage,
      preserveFormatting === undefined ? true : preserveFormatting,
      sourceLanguage,
      useTerminology ? this.terminology : undefined
    );

    // 翻译未缓存的文本
    // 使用并行处理批次，默认并发数为1（相当于顺序处理）
    const parallelRequests = concurrentRequests || 1;
    const newTranslations = await this.translateBatchesParallel(
      batches,
      systemPrompt,
      modelToUse,
      parallelRequests
    );

    // 将新翻译结果添加到缓存并合并到最终结果
    if (this.cacheService.isEnabled()) {
      for (let i = 0; i < newTranslations.length; i++) {
        const originalIndex = indexMap[i];
        const originalText = textsToTranslate[i];
        const translation = newTranslations[i];

        // 添加到缓存
        this.cacheService.set(
          originalText,
          translation,
          targetLanguage,
          sourceLanguage,
          modelToUse
        );

        // 添加到结果
        translationResults[originalIndex] = translation;
      }
    } else {
      // 如果缓存未启用，直接返回翻译结果
      return newTranslations;
    }

    return translationResults;
  }

  /**
   * 提取并翻译术语和人名
   * @param batches 文本批次
   * @param sourceLanguage 源语言
   * @param targetLanguage 目标语言
   * @param model 使用的模型
   * @param preserveFormatting 是否保留格式
   */
  private async extractAndTranslateTerms(
    batches: string[][],
    sourceLanguage: string | undefined,
    targetLanguage: string,
    model: string,
    preserveFormatting: boolean
  ): Promise<void> {
    // 清空现有术语表
    this.terminology = [];

    // 合并所有批次文本用于术语提取
    const allTexts = batches.flat().join("\n");

    // 创建术语提取的系统提示
    const extractSystemPrompt = `You are a professional terminology extractor. 
Your task is to identify important terms, names, and recurring phrases from the provided text.
${sourceLanguage ? `The text is in ${sourceLanguage}.` : ""}
Extract only terms that should be consistently translated.
Respond with a JSON object containing an array of terms.
Example response format: { "terms": ["term1", "term2", "name1", "phrase1", ...] }`;

    try {
      // 提取术语
      const extractedTerms = await this.extractTerms(
        allTexts,
        extractSystemPrompt,
        model
      );

      if (extractedTerms.length === 0) {
        return; // 没有提取到术语，直接返回
      }

      // 创建术语翻译的系统提示
      const translateTermsSystemPrompt = `You are a professional terminology translator.
${
  sourceLanguage
    ? `Translate from ${sourceLanguage} to ${targetLanguage}.`
    : `Translate to ${targetLanguage}.`
}
Your task is to translate each term accurately while maintaining the original meaning.
Respond with a JSON object containing an array of translations in the same order as the input.
Example response format: { "translations": ["translated term 1", "translated term 2", ...] }`;

      // 翻译提取的术语
      const translatedTerms = await this.translateBatch(
        extractedTerms,
        translateTermsSystemPrompt,
        model
      );

      // 构建术语表
      for (let i = 0; i < extractedTerms.length; i++) {
        this.terminology.push({
          original: extractedTerms[i],
          translated: translatedTerms[i],
        });
      }
    } catch (error) {
      console.error(
        `Error extracting or translating terms: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // 出错时清空术语表，继续正常翻译流程
      this.terminology = [];
    }
  }

  /**
   * 提取术语和人名
   * @param text 文本内容
   * @param systemPrompt 系统提示
   * @param model 使用的模型
   * @returns 提取的术语数组
   */
  private async extractTerms(
    text: string,
    systemPrompt: string,
    model: string
  ): Promise<string[]> {
    try {
      // 创建请求选项
      const requestOptions: any = {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Extract important terms, names, and recurring phrases from the following text:\n${text}`,
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
        throw new Error("No content in term extraction response");
      }

      // 清理内容，移除可能的 Markdown 代码块标记
      let cleanedContent = content.trim();

      // 移除开头的 ```json 或其他代码块标记
      if (cleanedContent.startsWith("```")) {
        const firstLineEnd = cleanedContent.indexOf("\n");
        if (firstLineEnd !== -1) {
          cleanedContent = cleanedContent.substring(firstLineEnd + 1);
        }
      }

      // 移除结尾的 ``` 标记
      if (cleanedContent.endsWith("```")) {
        cleanedContent = cleanedContent
          .substring(0, cleanedContent.lastIndexOf("```"))
          .trim();
      }

      // 解析JSON响应
      let parsedContent;
      try {
        parsedContent = JSON.parse(cleanedContent);
      } catch (error) {
        console.error("Failed to parse JSON response:", cleanedContent);
        return []; // 解析失败时返回空数组
      }

      if (!parsedContent.terms || !Array.isArray(parsedContent.terms)) {
        return []; // 响应格式不正确时返回空数组
      }

      return parsedContent.terms;
    } catch (error) {
      console.error(
        `Term extraction error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return []; // 出错时返回空数组
    }
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
        response_format: { type: "json_object" },
      };

      const response = await this.openai.chat.completions.create(
        requestOptions
      );

      const content = response.choices[0]?.message.content;

      if (!content) {
        throw new Error("No content in translation response");
      }

      // 清理内容，移除可能的 Markdown 代码块标记
      let cleanedContent = content.trim();

      // 移除开头的 ```json 或其他代码块标记
      if (cleanedContent.startsWith("```")) {
        const firstLineEnd = cleanedContent.indexOf("\n");
        if (firstLineEnd !== -1) {
          cleanedContent = cleanedContent.substring(firstLineEnd + 1);
        }
      }

      // 移除结尾的 ``` 标记
      if (cleanedContent.endsWith("```")) {
        cleanedContent = cleanedContent
          .substring(0, cleanedContent.lastIndexOf("```"))
          .trim();
      }

      // Parse the JSON response
      let parsedContent;
      try {
        parsedContent = JSON.parse(cleanedContent);
      } catch (error) {
        console.error("Failed to parse JSON response:", cleanedContent);
        // 尝试从非JSON响应中提取翻译结果
        if (Array.isArray(batch) && cleanedContent.includes("\n")) {
          // 假设每行对应一个翻译
          const lines = cleanedContent
            .split("\n")
            .filter((line) => line.trim());
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
   * @param targetLanguage Target language
   * @param preserveFormatting Whether to preserve formatting
   * @param sourceLanguage Source language
   * @param terminology 术语表
   * @returns System prompt string
   */
  private createSystemPrompt(
    targetLanguage: string,
    preserveFormatting: boolean,
    sourceLanguage?: string,
    terminology?: TerminologyEntry[]
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

    // 如果有术语表，添加到提示中
    if (terminology && terminology.length > 0) {
      prompt += `\nPlease use the following terminology consistently in your translations:\n`;

      // 将术语表格式化为表格形式
      prompt += `Original | Translation\n`;
      prompt += `-------- | -----------\n`;

      // 添加术语表条目
      for (const entry of terminology) {
        prompt += `${entry.original} | ${entry.translated}\n`;
      }
    }

    return prompt;
  }

  /**
   * 获取缓存服务实例
   * @returns 缓存服务实例
   */
  public getCacheService(): CacheService {
    return this.cacheService;
  }

  /**
   * 获取当前使用的模型
   * @returns 当前使用的模型名称
   */
  public getModel(): string {
    return this.model;
  }

  /**
   * 获取最后一次翻译的缓存命中信息
   * @returns 缓存命中信息 {hits: number, total: number}
   */
  public getCacheHitInfo(): { hits: number; total: number } {
    return {
      hits: this.lastCacheHits,
      total: this.lastTotalTexts,
    };
  }

  /**
   * 获取最后一次翻译的批次数量
   * @returns 批次数量
   */
  public getLastBatchesCount(): number {
    return this.lastBatchesCount;
  }

  /**
   * 获取当前术语表
   * @returns 术语表
   */
  public getTerminology(): TerminologyEntry[] {
    return [...this.terminology];
  }

  /**
   * 设置术语表
   * @param terminology 术语表
   */
  public setTerminology(terminology: TerminologyEntry[]): void {
    this.terminology = [...terminology];
  }

  /**
   * 清空术语表
   */
  public clearTerminology(): void {
    this.terminology = [];
  }
}
