import crypto from 'crypto'

export type SubtitleItem = {
  index: number
  time: string
  text: string[]
  hash: string
}

export class Srt {
  public subtitles: SubtitleItem[] = []

  constructor(srtContent: string) {
    this.subtitles = this.parseSrt(srtContent)
  }

  parseSrt = (srtContent: string) => {
    const lines = srtContent.split('\n')
    const subtitles = []

    let index = -1
    let time = ''
    let text = []
    let pos = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (line.trim() === '') {
        if (index !== -1) {
          subtitles.push({
            index,
            time,
            text,
            hash: crypto.createHash('sha256').update(time).digest('hex').slice(0, 7),
          })
        }
        index = -1
        time = ''
        text = []
        pos = 0
        continue
      }

      if (pos === 0) {
        index = parseInt(line, 10)
        pos += 1
        continue
      }

      if (pos === 1) {
        time = line
        pos += 1
        continue
      }

      if (pos >= 2) {
        text.push(line)
      }
    }

    return subtitles
  }
}

export const dumpSrt = (subtitles: SubtitleItem[]) => {
  const sorted = subtitles.sort((a, b) => {
    return a.index - b.index
  })

  return sorted
    .map((subtitle) => {
      return `${subtitle.index}\n${subtitle.time}\n${subtitle.text.join('\n')}\n\n`
    })
    .join('')
}
