#!/usr/bin/env node

import cliProgress from 'cli-progress'
import { config } from 'dotenv'
import fs from 'fs'
import path from 'path'

import { dumpSrt, Srt, SubtitleItem } from './lib/srt'
import { extractGlossary, translateText } from './lib/translate'

// 加载环境变量
config()

/**
 * 主程序入口
 */

const maxLength = 2000
const concurrency = 10

const main = async () => {
  const srt = new Srt(fs.readFileSync(path.join(__dirname, '../subtitles.srt'), 'utf8'))
  const subtitles = srt.subtitles

  const batches: SubtitleItem[][] = []
  let currentBatchLength = 0
  let currentBatch: SubtitleItem[] = []

  console.log(`总共有 ${subtitles.length} 个字幕需要处理`)
  for (const subtitle of subtitles) {
    if (currentBatchLength + subtitle.text.length > maxLength) {
      batches.push(currentBatch)
      currentBatch = []
      currentBatchLength = 0
    }

    currentBatch.push(subtitle)
    currentBatchLength += subtitle.text.join('\n').length
  }

  // 添加最后一个batch（如果有内容）
  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }
  console.log(`总共有 ${batches.length} 个批次需要处理`)

  const sourceLanguage = 'english'
  const targetLanguage = 'chinese'
  const model = process.env.MODEL || 'gpt-4o'

  // 提取术语表
  console.log('正在提取术语表...')

  let progress = new cliProgress.SingleBar({
    format: '提取术语表: {bar} | {percentage}% | {value}/{total} | ETA: {eta}s',
  })
  progress.start(batches.length, 0)

  let glossary: Record<string, string> = {}
  for (let i = 0; i < batches.length; i += concurrency) {
    const batchPromises = batches.slice(i, i + concurrency).map(async (batch) => {
      const result = await extractGlossary(model, sourceLanguage, targetLanguage, batch)
      glossary = { ...glossary, ...result }
      progress.increment()
    })
    await Promise.all(batchPromises)
  }
  progress.stop()
  console.log('术语表提取完成:', glossary)

  // 并行处理批次，一次处理5个
  progress = new cliProgress.SingleBar({
    format: '翻译: {bar} | {percentage}% | {value}/{total} | ETA: {eta}s',
  })
  progress.start(batches.length, 0)
  let results: Record<string, string> = {}
  for (let i = 0; i < batches.length; i += concurrency) {
    const batchPromises = batches.slice(i, i + concurrency).map(async (batch, index) => {
      try {
        const batchResult = await translateText(model, sourceLanguage, targetLanguage, batch, glossary)
        progress.increment()
        results = { ...results, ...batchResult }
      } catch (error) {
        console.error(`批次 ${i + index + 1} 处理失败:`, error)
        return {}
      }
    })
    await Promise.all(batchPromises)
  }
  progress.stop()

  const srtContent = dumpSrt(
    subtitles.map((subtitle) => ({
      ...subtitle,
      text: results[subtitle.hash].split('\n'),
    })),
  )
  fs.writeFileSync(path.join(__dirname, `../subtitles.${model}.srt`), srtContent)
}

main()
