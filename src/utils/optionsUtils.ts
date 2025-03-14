import { CliOptions } from '../types'

/**
 * 处理命令行选项并应用默认值
 * @param rawOptions 原始命令行选项
 * @returns 处理后的选项，应用了默认值
 */
export function processOptions(
  rawOptions: Record<string, any>
): Omit<CliOptions, "input" | "output"> {
  return {
    sourceLanguage: rawOptions.sourceLanguage,
    targetLanguage: rawOptions.targetLanguage || "English",
    model: rawOptions.model || process.env.DEFAULT_MODEL || "gpt-3.5-turbo",
    preserveFormatting:
      rawOptions.preserveFormatting !== undefined
        ? rawOptions.preserveFormatting
        : true,
    apiKey: rawOptions.apiKey || process.env.OPENAI_API_KEY,
    baseUrl: rawOptions.baseUrl || process.env.OPENAI_API_BASE_URL,
    maxBatchLength: rawOptions.maxBatchLength
      ? parseInt(rawOptions.maxBatchLength, 10)
      : 2000,
  };
}
