import OpenAI from 'openai'

import { extractGlossaryPrompt, systemPrompt } from './prompts'
import { SubtitleItem } from './srt'

/**
 * 字幕翻译和术语表提取类
 */
export class Translator {
  private model: string
  private apiKey?: string
  private baseUrl?: string
  private openai: OpenAI

  /**
   * 创建翻译器实例
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
   * 验证所有字幕是否已翻译并返回未翻译字幕哈希列表
   */
  private validateAllSubtitlesTranslated(
    originalMap: Record<string, string>,
    translatedMap: Record<string, string>,
  ): string[] {
    const originalHashes = Object.keys(originalMap)
    const translatedHashes = Object.keys(translatedMap)

    const missingHashes = originalHashes.filter((hash) => !translatedHashes.includes(hash))

    if (missingHashes.length > 0) {
      const missingCount = missingHashes.length
      const totalCount = originalHashes.length
      console.log(`${missingCount}/${totalCount} subtitles not translated, will attempt to translate them again.`)
      for (const hash of missingHashes) {
        console.log(`Untranslated subtitle: ${originalMap[hash]}`)
      }
    }

    return missingHashes
  }

  /**
   * 使用OpenAI API翻译字幕
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
      // 将SubtitleItem[]转换为API所需格式：{hash: text}
      const subtitleMap: Record<string, string> = {}
      for (const subtitle of subtitles) {
        subtitleMap[subtitle.hash] = subtitle.text.join('\n')
      }

      // 如果是递归调用，只处理未翻译部分
      let currentSubtitleMap = subtitleMap
      if (retryCount > 0 && Object.keys(previousTranslated).length > 0) {
        const translatedHashes = Object.keys(previousTranslated)
        currentSubtitleMap = {}

        for (const hash in subtitleMap) {
          if (!translatedHashes.includes(hash)) {
            currentSubtitleMap[hash] = subtitleMap[hash]
          }
        }

        console.log(
          `Retry #${retryCount}, processing ${Object.keys(currentSubtitleMap).length} untranslated subtitles...`,
        )
      }

      // 如果没有需要翻译的字幕，返回之前的结果
      if (Object.keys(currentSubtitleMap).length === 0) {
        return previousTranslated
      }

      const prompt = systemPrompt(sourceLanguage, targetLanguage, glossary)
      const formattedUserInput = JSON.stringify(currentSubtitleMap, null, 2)

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: formattedUserInput },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      })

      const completion = response.choices[0].message.content
      if (!completion) {
        throw new Error('OpenAI returned empty translation result')
      }

      const currentTranslatedMap = JSON.parse(completion) as Record<string, string>
      const translatedMap = { ...previousTranslated, ...currentTranslatedMap }

      // 验证所有字幕是否已翻译
      const missingHashes = this.validateAllSubtitlesTranslated(subtitleMap, translatedMap)

      // 如果有未翻译字幕且重试次数小于3，递归调用
      if (missingHashes.length > 0 && retryCount < 3) {
        console.log(`Retry translation #${retryCount + 1}, ${missingHashes.length} subtitles still untranslated`)
        return this.translateText({
          subtitles,
          glossary,
          retryCount: retryCount + 1,
          previousTranslated: translatedMap,
          sourceLanguage,
          targetLanguage,
        })
      }

      // 如果达到最大重试次数(3)且仍有未翻译字幕，抛出错误
      if (missingHashes.length > 0) {
        const missingCount = missingHashes.length
        const totalCount = Object.keys(subtitleMap).length
        throw new Error(
          `After ${retryCount} retries, ${missingCount}/${totalCount} subtitles remain untranslated. Untranslated hashes: ${missingHashes.join(', ')}`,
        )
      }

      return translatedMap
    } catch (error) {
      console.error('Error during translation:', error)
      throw error
    }
  }

  /**
   * 从字幕中提取术语表
   */
  public async extractGlossary(config: {
    subtitles: SubtitleItem[]
    sourceLanguage?: string
    targetLanguage?: string
    existingGlossary?: Record<string, string>
  }): Promise<Record<string, string>> {
    const {
      subtitles,
      sourceLanguage = 'english',
      targetLanguage = 'chinese',
      existingGlossary,
    } = config

    try {
      const prompt = extractGlossaryPrompt(sourceLanguage, targetLanguage, existingGlossary)
      const subtitleText = subtitles.map((subtitle) => subtitle.text.join('\n')).join('\n')

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: subtitleText },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      })

      const completion = response.choices[0].message.content
      if (!completion) {
        throw new Error('OpenAI returned empty glossary extraction result')
      }

      return JSON.parse(completion)
    } catch (error) {
      console.error('Error during glossary extraction:', error)
      throw error
    }
  }
}
