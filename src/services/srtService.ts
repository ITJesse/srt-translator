import * as fs from 'fs'
import * as path from 'path'
import { parse, parseSync, stringify, stringifySync } from 'subtitle'

import { SubtitleItem, TranslatedSubtitleItem } from '../types'

/**
 * Service for handling SRT file operations
 */
export class SrtService {
  /**
   * Parse an SRT file and return an array of subtitle items
   * @param filePath Path to the SRT file
   * @returns Array of subtitle items
   */
  public async parseSrtFile(filePath: string): Promise<SubtitleItem[]> {
    try {
      const absolutePath = path.resolve(filePath);
      const fileContent = await fs.promises.readFile(absolutePath, 'utf-8');
      
      // 使用parseSync方法同步解析SRT内容
      const nodes = parseSync(fileContent);
      
      const subtitles: SubtitleItem[] = [];
      let index = 1;
      
      // 处理解析后的节点
      for (const node of nodes) {
        if (node.type === 'cue') {
          subtitles.push({
            id: index++,
            start: node.data.start,
            end: node.data.end,
            text: node.data.text || ''
          });
        }
      }
      
      return subtitles;
    } catch (error) {
      console.error(`Error parsing SRT file: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Write translated subtitles to a new SRT file
   * @param subtitles Array of translated subtitle items
   * @param outputPath Path to save the translated SRT file
   */
  public async writeSrtFile(subtitles: TranslatedSubtitleItem[], outputPath: string): Promise<void> {
    try {
      const srtContent = subtitles.map(subtitle => {
        return {
          type: 'cue' as const,
          data: {
            start: subtitle.start,
            end: subtitle.end,
            text: subtitle.text
          }
        };
      });
      
      // 使用stringifySync方法生成SRT内容
      const output = stringifySync(srtContent, { format: 'SRT' });
      
      const absolutePath = path.resolve(outputPath);
      await fs.promises.writeFile(absolutePath, output, 'utf-8');
      console.log(`Translated subtitles saved to: ${absolutePath}`);
    } catch (error) {
      console.error(`Error writing SRT file: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Extract text content from subtitles for translation
   * @param subtitles Array of subtitle items
   * @returns Array of text strings
   */
  public extractTextForTranslation(subtitles: SubtitleItem[]): string[] {
    return subtitles.map(subtitle => subtitle.text);
  }
  
  /**
   * Create translated subtitle items by combining original subtitles with translated text
   * @param originalSubtitles Original subtitle items
   * @param translatedTexts Array of translated text strings
   * @returns Array of translated subtitle items
   */
  public createTranslatedSubtitles(
    originalSubtitles: SubtitleItem[], 
    translatedTexts: string[]
  ): TranslatedSubtitleItem[] {
    if (originalSubtitles.length !== translatedTexts.length) {
      throw new Error('Number of original subtitles and translated texts do not match');
    }
    
    return originalSubtitles.map((subtitle, index) => ({
      ...subtitle,
      originalText: subtitle.text,
      text: translatedTexts[index]
    }));
  }
} 