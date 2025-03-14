import { EventEmitter } from 'events'
import fs from 'fs'
import OpenAI from 'openai'

import {
    createTerminologyExtractionPrompt, createTranslationSystemPrompt
} from '../prompts/translationPrompts'
import { TerminologyEntry, TranslationOptions } from '../types'

/**
 * Service for handling translations using OpenAI API
 *
 * 事件:
 * - 'progress': 当翻译进度更新时触发，参数为进度信息对象 {
 *   completedBatches: number - 已完成的批次数
 *   totalBatches: number - 总批次数
 *   completedPercent: number - 完成百分比 (0-100)
 *   translatedTexts: number - 已翻译文本数量估计
 *   totalTexts: number - 总文本数量
 * }
 *
 * 示例:
 * ```
 * translationService.on('progress', (progressInfo) => {
 *   console.log(`翻译进度: ${progressInfo.completedPercent}%`);
 * });
 * ```
 */
export class TranslationService extends EventEmitter {
  private openai: OpenAI
  private model: string
  private lastTotalTexts: number = 0
  private lastBatchesCount: number = 0
  private terminology: TerminologyEntry[] = [] // 术语表
  private completedBatches: number = 0 // 已完成的批次数
  private totalBatches: number = 0 // 总批次数
  private progressUpdateInterval: NodeJS.Timeout | null = null // 进度更新定时器

  /**
   * Initialize the translation service
   * @param apiKey OpenAI API key
   * @param baseUrl OpenAI API base URL
   * @param model OpenAI model to use
   */
  constructor(apiKey: string, baseUrl: string, model: string) {
    super() // 初始化EventEmitter

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
  }

  /**
   * Translate an array of text strings
   * @param texts Array of text strings to translate
   * @param options Translation options
   * @returns Array of translated text strings
   */
  public async translateTexts(texts: string[], options: TranslationOptions): Promise<string[]> {
    const { sourceLanguage, targetLanguage, model, apiKey, baseUrl, maxBatchLength, concurrentRequests, terminology } =
      options

    // 使用传入的模型
    const modelToUse = model || this.model

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

    // 重置进度跟踪
    this.completedBatches = 0
    this.totalBatches = batches.length

    // 开始进度更新
    this.startProgressTracking()

    // 第一步：如果启用了术语功能，先批量处理所有batches中的术语
    if (terminology) {
      console.log('\n第一步：正在从所有批次中提取并翻译术语...')
      await this.extractAndTranslateTermsInOneStep(
        batches,
        sourceLanguage,
        targetLanguage,
        modelToUse,
        options.concurrentRequests,
      )

      // 如果成功提取到术语，显示提取到的术语数量
      if (this.terminology.length > 0) {
        console.log(`\n成功提取并翻译 ${this.terminology.length} 个术语，这些术语将在所有批次的翻译中保持一致性`)
      } else {
        console.log('\n未从内容中提取到重要术语，将继续进行正常翻译')
      }
    }

    // 第二步：准备翻译所有批次时使用的系统提示（包含已提取的术语）
    const systemPrompt = createTranslationSystemPrompt(
      targetLanguage,
      sourceLanguage,
      terminology ? this.terminology : undefined,
    )

    // 第三步：翻译所有批次
    // 使用并行处理批次
    const parallelRequests = concurrentRequests || 1

    // 如果启用了术语功能，在开始翻译前显示提示
    if (terminology && this.terminology.length > 0) {
      console.log('第三步：开始使用提取的术语表进行批次翻译...')
    } else {
      console.log('第二步：开始翻译批次...')
    }

    // 实现并发控制的批次处理
    const results: { index: number; translations: string[] }[] = []

    // 将批次分组，每组最多包含 parallelRequests 个批次
    for (let i = 0; i < batches.length; i += parallelRequests) {
      const currentBatchGroup = batches.slice(i, i + parallelRequests)

      // 并行处理当前组中的批次
      const groupPromises = currentBatchGroup.map(async (batch, groupIndex) => {
        const batchIndex = i + groupIndex

        try {
          // 添加重试逻辑
          let attempts = 0
          const maxAttempts = 3
          let lastError: any = null

          while (attempts < maxAttempts) {
            try {
              const translations = await this.translateBatch(batch, systemPrompt, modelToUse)
              this.updateProgress() // 更新进度
              return { index: batchIndex, translations }
            } catch (error) {
              attempts++
              lastError = error
              console.error(`Error translating batch ${batchIndex} (Attempt ${attempts}/${maxAttempts}): ${error}`)

              if (attempts < maxAttempts) {
                // 等待一小段时间再重试
                await new Promise((resolve) => setTimeout(resolve, 1000 * attempts))
                console.log(`Retrying batch ${batchIndex} (Attempt ${attempts + 1}/${maxAttempts})...`)
              }
            }
          }

          // 如果所有重试都失败，则终止整个过程
          console.error(`批次 ${batchIndex} 翻译失败，已重试 ${maxAttempts} 次，终止翻译过程`)
          this.updateProgress() // 更新失败的进度
          throw new Error(`批次 ${batchIndex} 翻译失败，已重试 ${maxAttempts} 次: ${lastError}`)
        } catch (error) {
          // 捕获并抛出错误，这将导致整个 Promise.all 失败，从而终止翻译过程
          console.error(`Critical error in batch ${batchIndex}: ${error}`)
          throw error
        }
      })

      // 修改错误处理，捕获可能的批次处理失败
      try {
        // 等待当前组中所有批次处理完成
        const groupResults = await Promise.all(groupPromises)
        results.push(...groupResults)
      } catch (error) {
        // 停止进度更新
        this.stopProgressTracking()
        // 打印最终的错误信息
        console.error(`\n翻译过程终止: ${error}`)
        // 抛出错误，终止整个翻译过程
        throw new Error(`翻译过程终止: ${error}`)
      }
    }

    // 停止进度更新
    this.stopProgressTracking()

    // 打印最终进度（100%）
    this.printProgress(this.totalBatches, this.totalBatches)
    console.log('\n翻译完成！')

    // 按原始批次顺序整理结果
    results.sort((a, b) => a.index - b.index)
    const allTranslations = results.flatMap((result) => result.translations)

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
    concurrentRequests: number,
  ): Promise<void> {
    // 清空现有术语表
    this.terminology = []

    const fetch = async (batch: string[]) => {
      // 合并所有批次文本用于术语提取，确保不遗漏任何可能的术语
      const allTexts = batch.join('\n')

      // 创建术语提取和翻译的系统提示
      const extractAndTranslatePrompt = createTerminologyExtractionPrompt(sourceLanguage, targetLanguage)

      try {
        console.log(`正在处理 ${batch.length} 条字幕文本的术语...`)

        // 创建请求选项
        const requestOptions: any = {
          model,
          messages: [
            { role: 'system', content: extractAndTranslatePrompt },
            {
              role: 'user',
              content: `Extract and translate important terms from the following subtitle text:\n\n${allTexts}\n\nCRITICAL: Respond ONLY with a valid JSON object containing the terminology array. Each term in the source language MUST have exactly ONE corresponding translation. Make sure your JSON is valid and follows the required format exactly:\n{\n  "terminology": [\n    {"original": "term1", "translated": "translation1"},\n    {"original": "term2", "translated": "translation2"}\n  ]\n}\n\nFocus on identifying terms that appear multiple times and need consistent translation, such as character names, technical terms, locations, and recurring phrases. The quality and consistency of these translations will greatly impact the overall subtitle translation.`,
            },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }

        // 发送API请求提取术语
        console.log('发送API请求提取术语...')
        const response = await this.openai.chat.completions.create(requestOptions)

        const content = response.choices[0]?.message.content
        if (!content) {
          throw new Error('No content in terminology extraction and translation response')
        }

        this.processTerminologyResponse(content)
      } catch (error) {
        console.error(
          `Error extracting and translating terms: ${error instanceof Error ? error.message : String(error)}`,
        )
        // 出错时清空术语表，继续正常翻译流程
        // this.terminology = []
      }
    }
    // 使用并发请求提取术语, 遵循 concurrentRequests 限制
    for (let i = 0; i < batches.length; i += concurrentRequests) {
      const batchGroup = batches.slice(i, i + concurrentRequests)
      await Promise.all(batchGroup.map(fetch))
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
        // 过滤出有效的术语条目
        const newTerms = parsedContent.terminology.filter(
          (entry: any) => entry && typeof entry === 'object' && entry.original && entry.translated,
        )

        // 合并新旧术语表,使用Map去重
        const termMap = new Map()

        // 先添加现有术语
        this.terminology.forEach((term) => {
          termMap.set(term.original, term)
        })

        // 添加新术语,如果有重复则覆盖
        newTerms.forEach((term: TerminologyEntry) => {
          termMap.set(term.original, term)
        })

        // 转换回数组
        this.terminology = Array.from(termMap.values())

        console.log(`\n成功提取并合并 ${newTerms.length} 个术语，当前术语表共有 ${this.terminology.length} 个术语`)
        return
      }

      console.warn('无法从响应中提取有效术语，保持现有术语表不变')
    } catch (error) {
      console.error(`Error processing terminology response: ${error}`)
      // 发生错误时保持现有术语表不变
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
      const response = await this.openai.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Translate the following subtitle texts (provided as JSON array):\n${JSON.stringify(batch)}`,
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      })

      const content = response.choices[0]?.message.content
      if (!content) {
        throw new Error('Empty response from OpenAI API')
      }

      // 处理API响应
      return this.processResponseContent(content, batch)
    } catch (error) {
      // 处理错误
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Translation error: ${errorMessage}`)
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
        strictLengthCheck: true, // 启用严格长度检查
      })

      // 增加验证：确保翻译结果数量与原始批次数量匹配
      if (result.length !== batch.length) {
        console.error('\n翻译结果数量不匹配！')
        console.error(`期望数量: ${batch.length}, 实际数量: ${result.length}`)
        console.error('原始批次:')
        batch.forEach((text, index) => {
          console.error(`[${index}]: ${text}`)
        })
        console.error('翻译结果:')
        result.forEach((text, index) => {
          console.error(`[${index}]: ${text}`)
        })

        throw new Error(`翻译结果数量不匹配: 期望 ${batch.length} 条，实际 ${result.length} 条`)
      }

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
   * @param options.strictLengthCheck 是否启用严格长度检查，如果为true则在数量不匹配时抛出错误
   * @returns 处理后的数据数组
   * @throws 如果无法解析JSON或启用严格长度检查且数量不匹配时抛出错误
   */
  private processAIResponse(
    content: string,
    options: {
      expectedArrayKey: string
      alternativeArrayKeys: string[]
      fallbackData: any[]
      strictLengthCheck?: boolean
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
        // 检查长度是否匹配
        if (options.strictLengthCheck && lines.length !== options.fallbackData.length) {
          console.error('\n非JSON响应行数不匹配！')
          console.error(`期望数量: ${options.fallbackData.length}, 实际数量: ${lines.length}`)
          console.error('响应内容:')
          console.error(cleanedContent)
          throw new Error(`非JSON响应行数不匹配: 期望 ${options.fallbackData.length} 行，实际 ${lines.length} 行`)
        }

        if (lines.length === options.fallbackData.length) {
          return lines
        }
      }

      // 增强错误信息，包含更多上下文
      throw new Error(`Invalid response format: not valid JSON. Content: ${cleanedContent.substring(0, 100)}...`)
    }

    // 检查是否有预期的数组键
    if (parsedContent[options.expectedArrayKey] && Array.isArray(parsedContent[options.expectedArrayKey])) {
      const result = parsedContent[options.expectedArrayKey]
      // 检查长度是否匹配
      if (options.strictLengthCheck && result.length !== options.fallbackData.length) {
        console.error(`\n键 "${options.expectedArrayKey}" 中的数组长度不匹配！`)
        console.error(`期望数量: ${options.fallbackData.length}, 实际数量: ${result.length}`)
        fs.writeFileSync('request.json', JSON.stringify(options.fallbackData, null, 2))
        fs.writeFileSync('response.json', JSON.stringify(parsedContent, null, 2))
        throw new Error(`翻译结果数量不匹配: 期望 ${options.fallbackData.length} 条，实际 ${result.length} 条`)
      }
      return result
    }

    // 检查替代数组键
    for (const key of options.alternativeArrayKeys) {
      if (parsedContent[key] && Array.isArray(parsedContent[key])) {
        const result = parsedContent[key]
        // 检查长度是否匹配
        if (options.strictLengthCheck && result.length !== options.fallbackData.length) {
          console.error(`\n替代键 "${key}" 中的数组长度不匹配！`)
          console.error(`期望数量: ${options.fallbackData.length}, 实际数量: ${result.length}`)
          fs.writeFileSync('request.json', JSON.stringify(options.fallbackData, null, 2))
          fs.writeFileSync('response.json', JSON.stringify(parsedContent, null, 2))
          throw new Error(`替代键翻译结果数量不匹配: 期望 ${options.fallbackData.length} 条，实际 ${result.length} 条`)
        }
        return result
      }
    }

    // 检查是否为数组本身（有些模型可能直接返回翻译数组而非嵌套对象）
    if (Array.isArray(parsedContent)) {
      // 检查长度是否匹配
      if (options.strictLengthCheck && parsedContent.length !== options.fallbackData.length) {
        console.error('\n响应数组长度不匹配！')
        console.error(`期望数量: ${options.fallbackData.length}, 实际数量: ${parsedContent.length}`)
        fs.writeFileSync('request.json', JSON.stringify(options.fallbackData, null, 2))
        fs.writeFileSync('response.json', JSON.stringify(parsedContent, null, 2))
        throw new Error(`响应数组长度不匹配: 期望 ${options.fallbackData.length} 条，实际 ${parsedContent.length} 条`)
      }

      if (options.fallbackData.length === 0 || parsedContent.length === options.fallbackData.length) {
        return parsedContent
      }
    }

    // 尝试提取任何可能的数组属性
    for (const key in parsedContent) {
      if (Array.isArray(parsedContent[key])) {
        const result = parsedContent[key]
        // 检查长度是否匹配
        if (options.strictLengthCheck && result.length !== options.fallbackData.length) {
          continue // 长度不匹配，尝试下一个键
        }

        if (options.fallbackData.length === 0 || result.length === options.fallbackData.length) {
          console.log(`Found alternative array key: ${key} with matching length`)
          return result
        }
      }
    }

    // 检查是否包含数字索引的对象（某些模型返回 {"0": "翻译1", "1": "翻译2"}）
    const numericKeys = Object.keys(parsedContent).filter((key) => !isNaN(Number(key)))
    if (numericKeys.length > 0) {
      // 检查长度是否匹配
      if (options.strictLengthCheck && numericKeys.length !== options.fallbackData.length) {
        console.error('\n数字索引对象长度不匹配！')
        console.error(`期望数量: ${options.fallbackData.length}, 实际数量: ${numericKeys.length}`)
        fs.writeFileSync('request.json', JSON.stringify(options.fallbackData, null, 2))
        fs.writeFileSync('response.json', JSON.stringify(parsedContent, null, 2))
        throw new Error(`数字索引对象长度不匹配: 期望 ${options.fallbackData.length} 条，实际 ${numericKeys.length} 条`)
      }

      if (numericKeys.length === options.fallbackData.length) {
        return numericKeys.map((key) => parsedContent[key])
      }
    }

    // 如果启用了严格长度检查但未找到匹配的数据，抛出错误
    if (options.strictLengthCheck) {
      console.error('\n无法找到匹配长度的翻译结果！')
      console.error(`期望数量: ${options.fallbackData.length}`)
      fs.writeFileSync('request.json', JSON.stringify(options.fallbackData, null, 2))
      fs.writeFileSync('response.json', JSON.stringify(parsedContent, null, 2))
      throw new Error(`无法找到匹配长度的翻译结果: 期望 ${options.fallbackData.length} 条`)
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
   * 获取模型名称
   * @returns 当前使用的模型名称
   */
  public getModel(): string {
    return this.model
  }

  /**
   * 获取上次翻译的批次数量
   * @returns 批次数量
   */
  public getLastBatchesCount(): number {
    return this.lastBatchesCount
  }

  /**
   * 获取术语表
   * @returns 术语表数组
   */
  public getTerminology(): TerminologyEntry[] {
    return this.terminology
  }

  /**
   * 设置术语表
   * @param terminology 术语表数组
   */
  public setTerminology(terminology: TerminologyEntry[]): void {
    this.terminology = terminology
  }

  /**
   * 清空术语表
   */
  public clearTerminology(): void {
    this.terminology = []
  }

  /**
   * 手动打印当前翻译进度
   * 可以从外部调用此方法随时查看最新进度
   */
  public printCurrentProgress(): void {
    this.printProgress(this.completedBatches, this.totalBatches)
  }

  /**
   * 获取当前翻译进度详细信息
   * @returns 翻译进度信息对象
   */
  public getProgressInfo(): {
    completedBatches: number
    totalBatches: number
    completedPercent: number
    translatedTexts: number
    totalTexts: number
  } {
    const completedPercent = this.totalBatches ? Math.floor((this.completedBatches / this.totalBatches) * 100) : 0
    const translatedTexts = this.lastTotalTexts
      ? Math.min(this.lastTotalTexts, Math.floor((this.completedBatches / this.totalBatches) * this.lastTotalTexts))
      : 0

    return {
      completedBatches: this.completedBatches,
      totalBatches: this.totalBatches,
      completedPercent,
      translatedTexts,
      totalTexts: this.lastTotalTexts,
    }
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

  /**
   * 开始进度跟踪，设置定时更新进度信息
   */
  private startProgressTracking(): void {
    // 先清除可能存在的定时器
    this.stopProgressTracking()

    // 立即打印初始进度
    this.printProgress(0, this.totalBatches)

    // 设置定时器，每秒更新一次显示（不影响实际进度更新）
    this.progressUpdateInterval = setInterval(() => {
      this.printProgress(this.completedBatches, this.totalBatches)
    }, 1000)
  }

  /**
   * 停止进度跟踪，清除定时器
   */
  private stopProgressTracking(): void {
    if (this.progressUpdateInterval) {
      clearInterval(this.progressUpdateInterval)
      this.progressUpdateInterval = null
    }
  }

  /**
   * 更新已完成批次数
   */
  private updateProgress(): void {
    this.completedBatches++

    // 发送进度更新事件
    this.emit('progress', this.getProgressInfo())
  }

  /**
   * 打印翻译进度条
   * @param completed 已完成的批次数
   * @param total 总批次数
   */
  private printProgress(completed: number, total: number): void {
    const percent = Math.floor((completed / total) * 100)
    const barLength = 30
    const filledLength = Math.floor((completed / total) * barLength)

    // 创建进度条
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength)

    // 计算已翻译的文本数
    const translatedTexts = Math.min(this.lastTotalTexts, Math.floor((completed / total) * this.lastTotalTexts))

    // 在同一行更新进度信息
    process.stdout.write(
      `\r翻译进度: [${bar}] ${percent}% | ${completed}/${total} 批次 | ${translatedTexts}/${this.lastTotalTexts} 字幕`,
    )
  }
}
