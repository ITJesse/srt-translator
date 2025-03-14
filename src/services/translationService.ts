import OpenAI from 'openai'

import { TranslationOptions } from '../types'

/**
 * Service for handling translations using OpenAI API
 */
export class TranslationService {
  private openai: OpenAI;
  private defaultModel: string;
  
  /**
   * Initialize the translation service
   * @param apiKey OpenAI API key
   * @param baseUrl Custom OpenAI API base URL
   */
  constructor(apiKey?: string, baseUrl?: string) {
    this.openai = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
      baseURL: baseUrl || process.env.OPENAI_API_BASE_URL
    });
    
    // 使用环境变量中的DEFAULT_MODEL或默认为'gpt-3.5-turbo'
    this.defaultModel = process.env.DEFAULT_MODEL || 'gpt-3.5-turbo';
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
      model = this.defaultModel, 
      preserveFormatting = true, 
      apiKey, 
      baseUrl,
      maxBatchLength = 2000 // 默认最大批次长度为2000字符
    } = options;
    
    // 输出使用的模型信息
    console.log(`Using translation model: ${model}`);
    
    // Reinitialize OpenAI client if custom API key or baseUrl is provided
    if (apiKey || baseUrl) {
      this.openai = new OpenAI({
        apiKey: apiKey || process.env.OPENAI_API_KEY,
        baseURL: baseUrl || process.env.OPENAI_API_BASE_URL
      });
    }
    
    // Prepare the system prompt
    const systemPrompt = this.createSystemPrompt(sourceLanguage, targetLanguage, preserveFormatting);
    
    // Process texts in batches based on text length to avoid token limits
    const batches = this.createBatches(texts, maxBatchLength);
    
    const translatedBatches: string[][] = [];
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchItemCount = batch.length;
      const batchTotalLength = batch.reduce((sum, text) => sum + text.length, 0);
      console.log(`Translating batch ${i + 1}/${batches.length} (${batchItemCount} items, ${batchTotalLength} characters)...`);
      
      const translatedBatch = await this.translateBatch(batch, systemPrompt, model);
      translatedBatches.push(translatedBatch);
    }
    
    // Flatten the batches back into a single array
    return translatedBatches.flat();
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
      if (currentBatch.length === 0 || currentBatchLength + text.length <= maxBatchLength) {
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
  private async translateBatch(batch: string[], systemPrompt: string, model: string): Promise<string[]> {
    try {
      // Format the batch as a JSON array string
      const batchJson = JSON.stringify(batch);
      
      // 创建请求选项
      const requestOptions: any = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Translate the following subtitle texts (provided as JSON array):\n${batchJson}` }
        ],
        temperature: 0.3
      };
      
      // 只有OpenAI模型才添加response_format选项
      if (model.startsWith('gpt-')) {
        requestOptions.response_format = { type: 'json_object' };
      }
      
      const response = await this.openai.chat.completions.create(requestOptions);
      
      const content = response.choices[0]?.message.content;
      
      if (!content) {
        throw new Error('No content in translation response');
      }
      
      // Parse the JSON response
      const parsedContent = JSON.parse(content);
      
      if (!parsedContent.translations || !Array.isArray(parsedContent.translations)) {
        throw new Error('Invalid translation response format');
      }
      
      return parsedContent.translations;
    } catch (error) {
      console.error(`Translation error: ${error instanceof Error ? error.message : String(error)}`);
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
  private createSystemPrompt(sourceLanguage?: string, targetLanguage: string = 'English', preserveFormatting: boolean = true): string {
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