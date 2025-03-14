import OpenAI from 'openai'

import { extractGlossaryPrompt, systemPrompt } from './prompts'
import { SubtitleItem } from './srt'

/**
 * 翻译文本配置接口
 */
export interface TranslateTextConfig {
  model: string
  sourceLanguage: string
  targetLanguage: string
  subtitles: SubtitleItem[]
  glossary?: Record<string, string>
  apiKey?: string
  baseUrl?: string
  retryCount?: number
  previousTranslated?: Record<string, string>
}

/**
 * 提取术语表配置接口
 */
export interface ExtractGlossaryConfig {
  model: string
  sourceLanguage: string
  targetLanguage: string
  subtitles: SubtitleItem[]
  apiKey?: string
  baseUrl?: string
}

/**
 * 字幕翻译器类，封装了字幕翻译和术语提取的功能
 */
export class Translator {
  private model: string
  private apiKey?: string
  private baseUrl?: string
  private openai: OpenAI

  /**
   * 创建翻译器实例
   * @param model 使用的OpenAI模型名称
   * @param apiKey OpenAI API密钥
   * @param baseUrl OpenAI API基础URL，可选
   */
  constructor(model: string, apiKey?: string, baseUrl?: string) {
    this.model = model
    this.apiKey = apiKey
    this.baseUrl = baseUrl
    this.openai = new OpenAI({
      apiKey: apiKey || '',
      baseURL: baseUrl,
    })
  }

  /**
   * 验证所有字幕是否都已被翻译，并返回未翻译的字幕hash列表
   * @param originalMap 原始字幕映射，格式为 {hash: 原文本}
   * @param translatedMap 翻译后字幕映射，格式为 {hash: 翻译文本}
   * @returns 未翻译的字幕hash列表
   */
  private validateAllSubtitlesTranslated(
    originalMap: Record<string, string>,
    translatedMap: Record<string, string>,
  ): string[] {
    const originalHashes = Object.keys(originalMap)
    const translatedHashes = Object.keys(translatedMap)

    // 找出未被翻译的字幕
    const missingHashes = originalHashes.filter((hash) => !translatedHashes.includes(hash))

    if (missingHashes.length > 0) {
      // 有未翻译的字幕
      const missingCount = missingHashes.length
      const totalCount = originalHashes.length
      console.log(`有${missingCount}/${totalCount}个字幕未被翻译，将尝试重新翻译这些字幕。`)
      for (const hash of missingHashes) {
        console.log(`未翻译字幕: ${originalMap[hash]}`)
      }
    }

    return missingHashes
  }

  /**
   * 使用OpenAI API翻译字幕
   * @param config 翻译配置对象
   * @returns 翻译后的字幕内容，格式为 {hash: 翻译文本}
   */
  public async translateText(config: {
    subtitles: SubtitleItem[]
    glossary?: Record<string, string>
    retryCount?: number
    previousTranslated?: Record<string, string>
    sourceLanguage?: string
    targetLanguage?: string
  }): Promise<Record<string, string>> {
    const {
      subtitles,
      glossary,
      retryCount = 0,
      previousTranslated = {},
      sourceLanguage = 'english',
      targetLanguage = 'chinese',
    } = config

    try {
      // 将SubtitleItem[]转换为API所需的格式：{hash: text}
      const subtitleMap: Record<string, string> = {}
      for (const subtitle of subtitles) {
        subtitleMap[subtitle.hash] = subtitle.text.join('\n')
      }

      // 如果是递归调用，只处理未翻译的部分
      let currentSubtitleMap = subtitleMap
      if (retryCount > 0 && Object.keys(previousTranslated).length > 0) {
        const translatedHashes = Object.keys(previousTranslated)
        currentSubtitleMap = {}

        // 只保留未翻译的字幕
        for (const hash in subtitleMap) {
          if (!translatedHashes.includes(hash)) {
            currentSubtitleMap[hash] = subtitleMap[hash]
          }
        }

        console.log(`第${retryCount}次重试，处理${Object.keys(currentSubtitleMap).length}个未翻译字幕...`)
      }

      // 如果当前没有需要翻译的字幕，直接返回之前的结果
      if (Object.keys(currentSubtitleMap).length === 0) {
        return previousTranslated
      }

      // 使用prompts.ts中定义的系统提示词
      const prompt = systemPrompt(sourceLanguage, targetLanguage, glossary)

      // 格式化输入内容为JSON字符串
      const formattedUserInput = JSON.stringify(currentSubtitleMap, null, 2)

      // 调用OpenAI API
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: formattedUserInput },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      })

      // 解析返回的JSON结果
      const completion = response.choices[0].message.content
      if (!completion) {
        throw new Error('OpenAI返回了空的翻译结果')
      }

      const currentTranslatedMap = JSON.parse(completion) as Record<string, string>

      // 合并当前翻译结果和之前的翻译结果
      const translatedMap = { ...previousTranslated, ...currentTranslatedMap }

      // 验证所有字幕是否都已被翻译
      const missingHashes = this.validateAllSubtitlesTranslated(subtitleMap, translatedMap)

      // 如果有未翻译的字幕，并且递归次数小于3，则递归调用
      if (missingHashes.length > 0 && retryCount < 3) {
        console.log(`第${retryCount + 1}次重试翻译，还有${missingHashes.length}个字幕未翻译`)
        return this.translateText({
          subtitles,
          glossary,
          retryCount: retryCount + 1,
          previousTranslated: translatedMap,
          sourceLanguage,
          targetLanguage,
        })
      }

      // 如果达到最大重试次数(3次)后仍有未翻译字幕，则抛出错误
      if (missingHashes.length > 0) {
        const missingCount = missingHashes.length
        const totalCount = Object.keys(subtitleMap).length
        throw new Error(
          `经过${retryCount}次重试后仍有${missingCount}/${totalCount}个字幕未被翻译。未翻译的哈希值: ${missingHashes.join(', ')}`,
        )
      }

      return translatedMap
    } catch (error) {
      console.error('翻译过程中出现错误:', error)
      throw error
    }
  }

  /**
   * 从字幕中提取术语表
   * @param config 提取术语表配置对象
   * @returns 提取的术语表，格式为 {源语言词汇: 目标语言对应}
   */
  public async extractGlossary(config: {
    subtitles: SubtitleItem[]
    sourceLanguage?: string
    targetLanguage?: string
  }): Promise<Record<string, string>> {
    const { subtitles, sourceLanguage = 'english', targetLanguage = 'chinese' } = config

    try {
      // 使用prompts.ts中定义的系统提示词
      const prompt = extractGlossaryPrompt(sourceLanguage, targetLanguage)

      // 将所有字幕文本合并成一个文本字符串进行分析
      const subtitleText = subtitles.map((subtitle) => subtitle.text.join('\n')).join('\n')

      // 调用OpenAI API
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: subtitleText },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      })

      // 解析返回的JSON结果
      const completion = response.choices[0].message.content
      if (!completion) {
        throw new Error('OpenAI返回了空的术语提取结果')
      }

      return JSON.parse(completion)
    } catch (error) {
      console.error('术语提取过程中出现错误:', error)
      throw error
    }
  }
}

/**
 * 创建一个翻译器实例的便捷函数
 * @param config 翻译器配置
 * @returns Translator实例
 */
export const createTranslator = (config: { model: string; apiKey?: string; baseUrl?: string }): Translator => {
  const { model, apiKey, baseUrl } = config
  return new Translator(model, apiKey, baseUrl)
}

/**
 * 使用OpenAI API翻译字幕（向后兼容函数）
 * @param config 翻译配置对象
 * @returns 翻译后的字幕内容，格式为 {hash: 翻译文本}
 */
export const translateText = async (config: TranslateTextConfig): Promise<Record<string, string>> => {
  const {
    model,
    apiKey,
    baseUrl,
    subtitles,
    glossary,
    retryCount = 0,
    previousTranslated = {},
    sourceLanguage,
    targetLanguage,
  } = config
  const translator = new Translator(model, apiKey, baseUrl)
  return translator.translateText({
    subtitles,
    glossary,
    retryCount,
    previousTranslated,
    sourceLanguage,
    targetLanguage,
  })
}

/**
 * 从字幕中提取术语表（向后兼容函数）
 * @param config 提取术语表配置对象
 * @returns 提取的术语表，格式为 {源语言词汇: 目标语言对应}
 */
export const extractGlossary = async (config: ExtractGlossaryConfig): Promise<Record<string, string>> => {
  const { model, apiKey, baseUrl, subtitles, sourceLanguage, targetLanguage } = config
  const translator = new Translator(model, apiKey, baseUrl)
  return translator.extractGlossary({
    subtitles,
    sourceLanguage,
    targetLanguage,
  })
}
