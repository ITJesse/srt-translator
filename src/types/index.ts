// Subtitle types
export interface SubtitleItem {
  id: string | number
  start: number
  end: number
  text: string
}

export interface TranslatedSubtitleItem extends SubtitleItem {
  originalText: string
}

// Translation service types
export interface TranslationOptions {
  sourceLanguage?: string
  targetLanguage: string
  model?: string
  apiKey?: string
  baseUrl?: string
  maxBatchLength?: number
  concurrentRequests?: number
  terminology?: boolean
}

// 术语表接口
export interface TerminologyEntry {
  original: string
  translated: string
}

// CLI options
export interface CliOptions {
  input: string
  output: string
  sourceLanguage: string
  targetLanguage: string
  model: string
  apiKey: string
  baseUrl: string
  maxBatchLength: number
  concurrentRequests: number
  terminology: boolean
}
