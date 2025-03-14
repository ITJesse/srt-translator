import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * 缓存服务，用于缓存翻译请求和结果
 */
export class CacheService {
  private cacheDir: string;
  private enabled: boolean;

  /**
   * 初始化缓存服务
   * @param enabled 是否启用缓存 (默认: true)
   * @param cacheDir 缓存目录 (默认: ~/.srt-translator/cache)
   */
  constructor(enabled: boolean = true, cacheDir?: string) {
    this.enabled = enabled;

    // 设置缓存目录
    this.cacheDir =
      cacheDir || path.join(os.homedir(), ".srt-translator", "cache");

    // 确保缓存目录存在
    if (this.enabled) {
      this.ensureCacheDirExists();
    }

    // 移除初始化日志，避免干扰主程序输出
    // console.log(
    //   `Initialized CacheService, enabled: ${this.enabled}, cache directory: ${this.cacheDir}`
    // );
  }

  /**
   * 确保缓存目录存在
   */
  private ensureCacheDirExists(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
        // console.log(`Created cache directory: ${this.cacheDir}`);
      }
    } catch (error) {
      console.error(
        `Failed to create cache directory: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.enabled = false;
    }
  }

  /**
   * 生成缓存键
   * @param text 原文本
   * @param targetLanguage 目标语言
   * @param sourceLanguage 源语言
   * @param model 使用的模型
   * @returns 缓存键
   */
  private generateKey(
    text: string,
    targetLanguage: string,
    sourceLanguage?: string,
    model?: string
  ): string {
    const keyString = `${text}|${sourceLanguage || ""}|${targetLanguage}|${
      model || ""
    }`;
    // 使用 MD5 哈希生成文件名安全的缓存键
    return crypto.createHash("md5").update(keyString).digest("hex");
  }

  /**
   * 获取缓存文件路径
   * @param key 缓存键
   * @returns 缓存文件路径
   */
  private getCacheFilePath(key: string): string {
    return path.join(this.cacheDir, `${key}.txt`);
  }

  /**
   * 获取缓存的翻译结果
   * @param text 原文本
   * @param targetLanguage 目标语言
   * @param sourceLanguage 源语言
   * @param model 使用的模型
   * @returns 缓存的翻译结果，如果没有缓存则返回null
   */
  public get(
    text: string,
    targetLanguage: string,
    sourceLanguage?: string,
    model?: string
  ): string | null {
    if (!this.enabled) return null;

    const key = this.generateKey(text, targetLanguage, sourceLanguage, model);
    const cacheFilePath = this.getCacheFilePath(key);

    try {
      if (fs.existsSync(cacheFilePath)) {
        return fs.readFileSync(cacheFilePath, "utf-8");
      }
    } catch (error) {
      console.error(
        `Failed to read cache file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    return null;
  }

  /**
   * 设置缓存
   * @param text 原文本
   * @param translation 翻译结果
   * @param targetLanguage 目标语言
   * @param sourceLanguage 源语言
   * @param model 使用的模型
   */
  public set(
    text: string,
    translation: string,
    targetLanguage: string,
    sourceLanguage?: string,
    model?: string
  ): void {
    if (!this.enabled) return;

    const key = this.generateKey(text, targetLanguage, sourceLanguage, model);
    const cacheFilePath = this.getCacheFilePath(key);

    try {
      fs.writeFileSync(cacheFilePath, translation, "utf-8");
    } catch (error) {
      console.error(
        `Failed to write cache file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 清除缓存
   */
  public clear(): void {
    if (!this.enabled) return;

    try {
      if (fs.existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          fs.unlinkSync(path.join(this.cacheDir, file));
        }
        // console.log(
        //   `Cleared ${files.length} cache files from ${this.cacheDir}`
        // );
      }
    } catch (error) {
      console.error(
        `Failed to clear cache directory: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 获取缓存大小
   * @returns 缓存条目数量
   */
  public size(): number {
    if (!this.enabled || !fs.existsSync(this.cacheDir)) {
      return 0;
    }

    try {
      const files = fs.readdirSync(this.cacheDir);
      return files.length;
    } catch (error) {
      console.error(
        `Failed to get cache size: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return 0;
    }
  }

  /**
   * 启用或禁用缓存
   * @param enabled 是否启用缓存
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (enabled) {
      this.ensureCacheDirExists();
    }

    // 简化日志输出
    // console.log(`Cache ${enabled ? "enabled" : "disabled"}`);
  }

  /**
   * 检查缓存是否启用
   * @returns 缓存是否启用
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 获取缓存目录
   * @returns 缓存目录路径
   */
  public getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * 设置缓存目录
   * @param dir 缓存目录路径
   */
  public setCacheDir(dir: string): void {
    this.cacheDir = dir;

    if (this.enabled) {
      this.ensureCacheDirExists();
    }

    // 简化日志输出
    // console.log(`Cache directory set to: ${this.cacheDir}`);
  }
}
