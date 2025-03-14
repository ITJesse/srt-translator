import * as fs from 'fs'
import * as path from 'path'

/**
 * Utility functions for file operations
 */
export class FileUtils {
  /**
   * Check if a file exists
   * @param filePath Path to the file
   * @returns True if the file exists, false otherwise
   */
  public static async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Ensure a directory exists, create it if it doesn't
   * @param dirPath Path to the directory
   */
  public static async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.promises.access(dirPath, fs.constants.F_OK);
    } catch {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  }
  
  /**
   * Generate an output file path based on the input file path
   * @param inputPath Input file path
   * @param targetLanguage Target language code
   * @returns Output file path
   */
  public static generateOutputPath(inputPath: string, targetLanguage: string): string {
    const parsedPath = path.parse(inputPath);
    const outputFileName = `${parsedPath.name}.${targetLanguage}${parsedPath.ext}`;
    return path.join(parsedPath.dir, outputFileName);
  }
  
  /**
   * Validate that a file has the .srt extension
   * @param filePath Path to the file
   * @returns True if the file has the .srt extension, false otherwise
   */
  public static isSrtFile(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.srt';
  }
} 