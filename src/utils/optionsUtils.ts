import * as os from 'os'
import * as path from 'path'

import { CliOptions } from '../types'

/**
 * 处理命令行选项并应用默认值
 * @param rawOptions 原始命令行选项
 * @returns 处理后的选项，应用了默认值
 */
export function processOptions(rawOptions: Record<string, any>): Omit<CliOptions, 'input' | 'output'> {
  if (!rawOptions.targetLanguage && !process.env.DEFAULT_TARGET_LANGUAGE) {
    throw new Error('Target language is required')
  }
  if (!rawOptions.apiKey && !process.env.OPENAI_API_KEY) {
    throw new Error('API key is required')
  }

  return {
    sourceLanguage: rawOptions.sourceLanguage || '',
    targetLanguage: rawOptions.targetLanguage || process.env.DEFAULT_TARGET_LANGUAGE,
    model: rawOptions.model || process.env.DEFAULT_MODEL || 'gpt-3.5-turbo',
    apiKey: rawOptions.apiKey || process.env.OPENAI_API_KEY || '',
    baseUrl: rawOptions.baseUrl || process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1',
    maxBatchLength: rawOptions.maxBatchLength ? parseInt(rawOptions.maxBatchLength, 10) : 2000,
    concurrentRequests: rawOptions.concurrentRequests ? parseInt(rawOptions.concurrentRequests, 10) : 5,
    terminology: rawOptions.terminology === true,
  }
}
