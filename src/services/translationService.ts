import OpenAI from 'openai'

import { TerminologyEntry, TranslationOptions } from '../types'
import { CacheService } from './cacheService'

/**
 * Service for handling translations using OpenAI API
 */
export class TranslationService {
  private openai: OpenAI
  private model: string
  private cacheService: CacheService
  private lastCacheHits: number = 0
  private lastTotalTexts: number = 0
  private lastBatchesCount: number = 0
  private terminology: TerminologyEntry[] = [] // 术语表

  /**
   * Initialize the translation service
   * @param apiKey OpenAI API key
   * @param baseUrl OpenAI API base URL
   * @param model OpenAI model to use
   * @param enableCache Whether to enable caching (default: true)
   * @param cacheDir Cache directory (default: ~/.srt-translator/cache)
   */
  constructor(apiKey: string, baseUrl: string, model: string, enableCache: boolean = true, cacheDir?: string) {
    if (!apiKey) {
      throw new Error('API key is required')
    }

    if (!model) {
      throw new Error('Model is required')
    }

    this.openai = new OpenAI({
      apiKey: apiKey,
      baseURL: baseUrl,
    })

    this.model = model
    this.cacheService = new CacheService(enableCache, cacheDir)
  }

  /**
   * Translate an array of text strings
   * @param texts Array of text strings to translate
   * @param options Translation options
   * @returns Array of translated text strings
   */
  public async translateTexts(texts: string[], options: TranslationOptions): Promise<string[]> {
    const {
      sourceLanguage,
      targetLanguage,
      model,
      apiKey,
      baseUrl,
      maxBatchLength,
      concurrentRequests,
      enableCache,
      terminology,
    } = options

    // 使用传入的模型
    const modelToUse = model || this.model

    // 设置缓存状态（只控制启用/禁用，不重新设置目录）
    if (enableCache !== undefined) {
      this.cacheService.setEnabled(enableCache)
    }

    // Reinitialize OpenAI client if custom API key or baseUrl is provided
    if (apiKey || baseUrl) {
      this.openai = new OpenAI({
        apiKey: apiKey,
        baseURL: baseUrl,
      })
    }

    // 创建文本批次
    const batches = this.createBatches(texts, maxBatchLength as number)

    // 存储批次信息
    this.lastBatchesCount = batches.length
    this.lastTotalTexts = texts.length
    this.lastCacheHits = 0 // 将在处理API缓存时更新

    // 如果启用了术语功能，先提取并翻译术语
    if (terminology) {
      console.log('正在提取并翻译术语...')
      await this.extractAndTranslateTermsInOneStep(batches, sourceLanguage, targetLanguage, modelToUse)

      // 如果成功提取到术语，显示提取到的术语数量
      if (this.terminology.length > 0) {
        console.log(`已提取并翻译 ${this.terminology.length} 个术语，将在翻译中保持一致性`)
      } else {
        console.log('未从内容中提取到重要术语')
      }
    }

    // Prepare the system prompt
    const systemPrompt = this.createSystemPrompt(
      targetLanguage,
      sourceLanguage,
      terminology ? this.terminology : undefined,
    )

    // 翻译批次
    let cacheHits = 0

    // 使用并行处理批次
    const parallelRequests = concurrentRequests || 1

    // 如果启用了术语功能，在开始翻译前显示提示
    if (terminology && this.terminology.length > 0) {
      console.log('开始使用提取的术语表进行翻译...')
    }

    // 实现并发控制的批次处理
    const results: { index: number; translations: string[] }[] = []

    // 将批次分组，每组最多包含 parallelRequests 个批次
    for (let i = 0; i < batches.length; i += parallelRequests) {
      const currentBatchGroup = batches.slice(i, i + parallelRequests)

      // 并行处理当前组中的批次
      const groupPromises = currentBatchGroup.map(async (batch, groupIndex) => {
        const batchIndex = i + groupIndex

        // 创建请求选项用于缓存检查
        const requestOptions: any = {
          model: modelToUse,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `Translate the following subtitle texts (provided as JSON array):\n${JSON.stringify(batch)}`,
            },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }

        // 检查API请求缓存
        const cachedResponse = this.cacheService.getApiResponse(requestOptions)
        if (cachedResponse) {
          // 如果有缓存的API响应，直接使用
          cacheHits++
          const content = cachedResponse.choices[0]?.message.content
          if (content) {
            try {
              const translations = this.processResponseContent(content, batch)
              return { index: batchIndex, translations }
            } catch (error) {
              console.error(`Error processing cached response: ${error}`)
              // 如果处理缓存失败，继续正常翻译流程
            }
          }
        }

        // 如果没有缓存或缓存处理失败，翻译批次
        try {
          const translations = await this.translateBatch(batch, systemPrompt, modelToUse)
          return { index: batchIndex, translations }
        } catch (error) {
          console.error(`Error translating batch ${batchIndex}: ${error}`)
          // 返回空结果，避免整个过程失败
          return { index: batchIndex, translations: batch.map(() => '') }
        }
      })

      // 等待当前组中所有批次处理完成
      const groupResults = await Promise.all(groupPromises)
      results.push(...groupResults)
    }

    // 按原始批次顺序整理结果
    results.sort((a, b) => a.index - b.index)
    const allTranslations = results.flatMap((result) => result.translations)

    // 更新缓存命中信息
    this.lastCacheHits = cacheHits

    return allTranslations
  }

  /**
   * 在一步内提取并翻译术语和人名
   * @param batches 文本批次
   * @param sourceLanguage 源语言
   * @param targetLanguage 目标语言
   * @param model 使用的模型
   */
  private async extractAndTranslateTermsInOneStep(
    batches: string[][],
    sourceLanguage: string | undefined,
    targetLanguage: string,
    model: string,
  ): Promise<void> {
    // 清空现有术语表
    this.terminology = []

    // 合并所有批次文本用于术语提取
    const allTexts = batches.flat().join('\n')

    // 创建术语提取和翻译的系统提示
    const extractAndTranslatePrompt = `You are a professional terminology extractor and translator specialized in subtitle content. 
Your task is to identify important terms, names, and recurring phrases from the provided subtitle text, and translate them.
${
  sourceLanguage
    ? `The text is in ${sourceLanguage}. Translate the terms to ${targetLanguage}.`
    : `Translate the terms to ${targetLanguage}.`
}
Focus on extracting:
1. Character names and proper nouns
2. Technical terms and specialized vocabulary
3. Recurring phrases that need consistent translation
4. Cultural references that require careful translation

Extract only terms that appear multiple times and should be consistently translated.
For each term, provide a high-quality, contextually appropriate translation.

IMPORTANT: Your response MUST follow this exact JSON format:
{
  "terminology": [
    {"original": "term1", "translated": "translated term 1"},
    {"original": "term2", "translated": "translated term 2"}
  ]
}

Do not include any text outside of this JSON structure. The response must be valid parseable JSON.`

    try {
      // 创建请求选项
      const requestOptions: any = {
        model,
        messages: [
          { role: 'system', content: extractAndTranslatePrompt },
          {
            role: 'user',
            content: `Extract and translate important terms from the following subtitle text:\n\n${allTexts}\n\nRespond only with a valid JSON object containing the terminology array.`,
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }

      // 检查API请求缓存
      const cachedResponse = this.cacheService.getApiResponse(requestOptions)
      if (cachedResponse) {
        // 如果有缓存的API响应，直接使用
        const content = cachedResponse.choices[0]?.message.content
        if (content) {
          this.processTerminologyResponse(content)
          return
        }
      }

      // 如果没有缓存或缓存处理失败，发送API请求
      const response = await this.openai.chat.completions.create(requestOptions)

      // 缓存API响应
      if (this.cacheService.isEnabled()) {
        this.cacheService.setApiResponse(requestOptions, response)
      }

      const content = response.choices[0]?.message.content
      if (!content) {
        throw new Error('No content in terminology extraction and translation response')
      }

      this.processTerminologyResponse(content)
    } catch (error) {
      console.error(`Error extracting and translating terms: ${error instanceof Error ? error.message : String(error)}`)
      // 出错时清空术语表，继续正常翻译流程
      this.terminology = []
    }
  }

  /**
   * 处理术语提取和翻译API响应内容
   * @param content API响应内容
   */
  private processTerminologyResponse(content: string): void {
    try {
      // 清理内容，移除可能的 Markdown 代码块标记
      const cleanedContent = this.cleanJsonContent(content)

      // 解析JSON响应
      let parsedContent
      try {
        parsedContent = JSON.parse(cleanedContent)
      } catch (error) {
        console.error('Failed to parse JSON terminology response:', cleanedContent)
        return
      }

      // 检查是否有术语数组
      if (parsedContent.terminology && Array.isArray(parsedContent.terminology)) {
        this.terminology = parsedContent.terminology.filter(
          (entry: any) => entry && typeof entry === 'object' && entry.original && entry.translated,
        )
        console.log(`成功提取 ${this.terminology.length} 个术语`)
        return
      }

      // 尝试寻找替代键名
      const alternativeKeys = ['terms', 'entries', 'glossary', 'dictionary', 'translations']
      for (const key of alternativeKeys) {
        if (parsedContent[key] && Array.isArray(parsedContent[key])) {
          // 检查数组元素的格式
          const formattedTerms = parsedContent[key]
            .filter((entry: any) => entry && typeof entry === 'object')
            .map((entry: any) => {
              // 尝试不同的属性名组合
              if (entry.original && entry.translated) {
                return { original: entry.original, translated: entry.translated }
              } else if (entry.source && entry.target) {
                return { original: entry.source, translated: entry.target }
              } else if (entry.term && entry.translation) {
                return { original: entry.term, translated: entry.translation }
              } else if (entry.key && entry.value) {
                return { original: entry.key, translated: entry.value }
              }

              // 尝试获取第一个和第二个属性（无论名称如何）
              const keys = Object.keys(entry)
              if (keys.length >= 2) {
                return { original: entry[keys[0]], translated: entry[keys[1]] }
              }

              return null
            })
            .filter((entry: any): entry is TerminologyEntry => entry !== null)

          if (formattedTerms.length > 0) {
            this.terminology = formattedTerms
            console.log(`成功从替代键 "${key}" 提取 ${this.terminology.length} 个术语`)
            return
          }
        }
      }

      // 检查是否为数组本身
      if (Array.isArray(parsedContent)) {
        const formattedTerms = parsedContent
          .filter((entry: any) => entry && typeof entry === 'object')
          .map((entry: any) => {
            if (entry.original && entry.translated) {
              return { original: entry.original, translated: entry.translated }
            } else if (entry.source && entry.target) {
              return { original: entry.source, translated: entry.target }
            } else if (entry.term && entry.translation) {
              return { original: entry.term, translated: entry.translation }
            }

            // 尝试获取第一个和第二个属性
            const keys = Object.keys(entry)
            if (keys.length >= 2) {
              return { original: entry[keys[0]], translated: entry[keys[1]] }
            }

            return null
          })
          .filter((entry: any): entry is TerminologyEntry => entry !== null)

        if (formattedTerms.length > 0) {
          this.terminology = formattedTerms
          console.log(`成功从数组提取 ${this.terminology.length} 个术语`)
          return
        }
      }

      // 检查是否为简单的键值对对象
      if (typeof parsedContent === 'object' && !Array.isArray(parsedContent)) {
        const terms = Object.entries(parsedContent)
          .filter(
            ([key, value]) =>
              key !== 'terminology' && typeof value === 'string' && key.trim().length > 0 && value.trim().length > 0,
          )
          .map(([key, value]) => ({
            original: key,
            translated: value as string,
          }))

        if (terms.length > 0) {
          this.terminology = terms
          console.log(`成功从键值对对象提取 ${this.terminology.length} 个术语`)
          return
        }
      }

      console.warn('无法从响应中提取有效术语，使用空术语表继续')
      this.terminology = []
    } catch (error) {
      console.error(`Error processing terminology response: ${error}`)
      // 解析失败时清空术语表
      this.terminology = []
    }
  }

  /**
   * Translate a batch of text strings
   * @param batch Array of text strings
   * @param systemPrompt System prompt for the AI
   * @param model OpenAI model to use
   * @returns Array of translated text strings
   */
  private async translateBatch(batch: string[], systemPrompt: string, model: string): Promise<string[]> {
    try {
      // Format the batch as a JSON array string
      const batchJson = JSON.stringify(batch)

      // 创建请求选项
      const requestOptions: any = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Translate the following subtitle texts (provided as JSON array):\n${batchJson}\n\nProvide the translated texts in a JSON object with a "translations" array in the same order. Example: { "translations": ["translated text 1", "translated text 2", ...] }`,
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }

      // 检查API请求缓存
      const cachedResponse = this.cacheService.getApiResponse(requestOptions)
      if (cachedResponse) {
        // 如果有缓存的API响应，直接使用
        const content = cachedResponse.choices[0]?.message.content
        if (content) {
          // 处理缓存的响应内容
          return this.processResponseContent(content, batch)
        }
      }

      // 如果没有缓存或缓存处理失败，发送API请求
      const response = await this.openai.chat.completions.create(requestOptions)

      // 缓存API响应
      if (this.cacheService.isEnabled()) {
        this.cacheService.setApiResponse(requestOptions, response)
      }

      const content = response.choices[0]?.message.content

      if (!content) {
        throw new Error('No content in translation response')
      }

      return this.processResponseContent(content, batch)
    } catch (error) {
      console.error(`Translation error: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  /**
   * 处理API响应内容，提取翻译结果
   * @param content API响应内容
   * @param batch 原始批次，用于回退处理
   * @returns 处理后的翻译结果数组
   */
  private processResponseContent(content: string, batch: string[]): string[] {
    try {
      // 使用通用处理方法处理响应内容
      const result = this.processAIResponse(content, {
        expectedArrayKey: 'translations',
        alternativeArrayKeys: ['terms'],
        fallbackData: batch,
      })

      return result
    } catch (error) {
      console.error(`Error processing response content: ${error}`)
      // 出错时返回原始批次，避免整个流程失败
      return batch
    }
  }

  /**
   * 通用AI响应处理方法
   * @param content API响应内容（可能包含Markdown代码块标记）
   * @param options 处理选项
   * @param options.expectedArrayKey 预期的数组键名（如'translations'或'terms'）
   * @param options.alternativeArrayKeys 替代的数组键名数组，当预期键不存在时尝试
   * @param options.fallbackData 当无法解析响应时使用的回退数据
   * @returns 处理后的数据数组
   * @throws 如果无法解析JSON且无法使用回退策略时抛出错误
   */
  private processAIResponse(
    content: string,
    options: {
      expectedArrayKey: string
      alternativeArrayKeys: string[]
      fallbackData: any[]
    },
  ): any[] {
    // 清理内容，移除可能的 Markdown 代码块标记
    const cleanedContent = this.cleanJsonContent(content)

    // 解析JSON响应
    let parsedContent
    try {
      parsedContent = JSON.parse(cleanedContent)
    } catch (error) {
      console.error('Failed to parse JSON response:', cleanedContent)
      // 尝试从非JSON响应中提取结果
      if (Array.isArray(options.fallbackData) && cleanedContent.includes('\n')) {
        // 假设每行对应一个结果
        const lines = cleanedContent.split('\n').filter((line) => line.trim())
        if (lines.length === options.fallbackData.length) {
          return lines
        }
      }

      // 增强错误信息，包含更多上下文
      throw new Error(`Invalid response format: not valid JSON. Content: ${cleanedContent.substring(0, 100)}...`)
    }

    // 检查是否有预期的数组键
    if (parsedContent[options.expectedArrayKey] && Array.isArray(parsedContent[options.expectedArrayKey])) {
      return parsedContent[options.expectedArrayKey]
    }

    // 检查替代数组键
    for (const key of options.alternativeArrayKeys) {
      if (parsedContent[key] && Array.isArray(parsedContent[key])) {
        return parsedContent[key]
      }
    }

    // 检查是否为数组本身（有些模型可能直接返回翻译数组而非嵌套对象）
    if (
      Array.isArray(parsedContent) &&
      (options.fallbackData.length === 0 || parsedContent.length === options.fallbackData.length)
    ) {
      return parsedContent
    }

    // 尝试提取任何可能的数组属性
    for (const key in parsedContent) {
      if (
        Array.isArray(parsedContent[key]) &&
        (options.fallbackData.length === 0 || parsedContent[key].length === options.fallbackData.length)
      ) {
        console.log(`Found alternative array key: ${key} with matching length`)
        return parsedContent[key]
      }
    }

    // 检查是否包含数字索引的对象（某些模型返回 {"0": "翻译1", "1": "翻译2"}）
    const numericKeys = Object.keys(parsedContent).filter((key) => !isNaN(Number(key)))
    if (numericKeys.length === options.fallbackData.length) {
      return numericKeys.map((key) => parsedContent[key])
    }

    // 记录更详细的错误信息以便于调试
    console.error(
      `Response format doesn't match expected structure. Content sample: ${JSON.stringify(parsedContent).substring(0, 200)}...`,
    )

    // 最后尝试直接返回原始数据，避免整个流程失败
    console.warn(
      `Could not find valid data in response (expected key: ${options.expectedArrayKey}), using fallback data`,
    )
    return options.fallbackData
  }

  /**
   * 清理JSON内容，移除Markdown代码块标记
   * @param content 原始内容
   * @returns 清理后的JSON内容
   */
  private cleanJsonContent(content: string): string {
    let cleanedContent = content.trim()

    // 处理完整的代码块格式 ```json ... ```
    const jsonBlockRegex = /^```(?:json)?\s*([\s\S]*?)```\s*$/
    const match = cleanedContent.match(jsonBlockRegex)
    if (match) {
      return match[1].trim()
    }

    // 处理只有开头的代码块标记
    if (cleanedContent.startsWith('```')) {
      const firstLineEnd = cleanedContent.indexOf('\n')
      if (firstLineEnd !== -1) {
        cleanedContent = cleanedContent.substring(firstLineEnd + 1)
      }
    }

    // 处理只有结尾的代码块标记
    if (cleanedContent.endsWith('```')) {
      cleanedContent = cleanedContent.substring(0, cleanedContent.lastIndexOf('```')).trim()
    }

    return cleanedContent
  }

  /**
   * Create a system prompt for the AI
   * @param targetLanguage Target language
   * @param sourceLanguage Source language
   * @param terminology 术语表
   * @returns System prompt string
   */
  private createSystemPrompt(
    targetLanguage: string,
    sourceLanguage?: string,
    terminology?: TerminologyEntry[],
  ): string {
    let prompt = `You are a professional subtitle translator. `

    if (sourceLanguage) {
      prompt += `Translate from ${sourceLanguage} to ${targetLanguage}. `
    } else {
      prompt += `Translate to ${targetLanguage}. `
    }

    // 始终保留格式
    prompt += `Preserve all formatting, line breaks, and special characters. `

    prompt += `
Your task is to translate each subtitle text accurately while maintaining the original meaning and tone.
Respond with a JSON object containing a "translations" array with the translated texts in the same order as the input.
Example response format: { "translations": ["translated text 1", "translated text 2", ...] }
`

    // 如果有术语表，添加到提示中并强调其重要性
    if (terminology && terminology.length > 0) {
      prompt += `\nIMPORTANT: You MUST use the following terminology consistently in your translations. These terms have been pre-translated specifically for this content and must be used exactly as provided:\n`

      // 将术语表格式化为表格形式
      prompt += `Original | Translation\n`
      prompt += `-------- | -----------\n`

      // 添加术语表条目
      for (const entry of terminology) {
        prompt += `${entry.original} | ${entry.translated}\n`
      }

      prompt += `\nWhen you encounter any of these terms in the source text, you MUST use the provided translation. This ensures consistency throughout the entire subtitle file. Do not translate these terms differently.`

      // 强调响应格式
      prompt += `\n\nIMPORTANT: Your response MUST be a valid JSON object with the exact format: { "translations": ["translated text 1", "translated text 2", ...] }`
    }

    return prompt
  }

  /**
   * 获取缓存服务实例
   * @returns 缓存服务实例
   */
  public getCacheService(): CacheService {
    return this.cacheService
  }

  /**
   * 获取当前使用的模型
   * @returns 当前使用的模型名称
   */
  public getModel(): string {
    return this.model
  }

  /**
   * 获取最后一次翻译的缓存命中信息
   * @returns 缓存命中信息 {hits: number, total: number}
   */
  public getCacheHitInfo(): { hits: number; total: number } {
    return {
      hits: this.lastCacheHits,
      total: this.lastTotalTexts,
    }
  }

  /**
   * 获取最后一次翻译的批次数量
   * @returns 批次数量
   */
  public getLastBatchesCount(): number {
    return this.lastBatchesCount
  }

  /**
   * 获取当前术语表
   * @returns 术语表
   */
  public getTerminology(): TerminologyEntry[] {
    return [...this.terminology]
  }

  /**
   * 设置术语表
   * @param terminology 术语表
   */
  public setTerminology(terminology: TerminologyEntry[]): void {
    this.terminology = [...terminology]
  }

  /**
   * 清空术语表
   */
  public clearTerminology(): void {
    this.terminology = []
  }

  /**
   * Create batches from an array of texts based on character length
   * @param texts Array of text strings
   * @param maxBatchLength Maximum character length for each batch
   * @returns Array of batches
   */
  private createBatches(texts: string[], maxBatchLength: number): string[][] {
    const batches: string[][] = []
    let currentBatch: string[] = []
    let currentBatchLength = 0

    for (const text of texts) {
      // 如果当前批次为空或添加此文本后不超过最大长度，则添加到当前批次
      if (currentBatch.length === 0 || currentBatchLength + text.length <= maxBatchLength) {
        currentBatch.push(text)
        currentBatchLength += text.length
      } else {
        // 否则，完成当前批次并开始新批次
        batches.push(currentBatch)
        currentBatch = [text]
        currentBatchLength = text.length
      }
    }

    // 添加最后一个批次（如果有）
    if (currentBatch.length > 0) {
      batches.push(currentBatch)
    }

    return batches
  }
}
