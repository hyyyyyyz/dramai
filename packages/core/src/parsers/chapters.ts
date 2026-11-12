import type { Chapter } from '../domain/material.ts'

/**
 * 章节识别与字数统计。原文**不截断**：长篇小说按章节 / 段落切成可分批处理的片段。
 */

/** 字数：不含空白字符的码点数（中文按字，英文按字符）。 */
export function countChars(text: string): number {
  let n = 0
  for (const ch of text) if (!/\s/u.test(ch)) n++
  return n
}

export function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
}

const NUM = '[零〇一二三四五六七八九十百千万两\\d]+'
const HEADING_PATTERNS: RegExp[] = [
  new RegExp(`^第\\s*${NUM}\\s*[章回节集幕篇](?:[\\s:：.、·-]|$)`),
  /^(?:chapter|ch\.)\s*(?:\d+|[ivxlc]+)\b/i,
  /^#{1,3}\s+\S/,
]

function isHeading(line: string): boolean {
  const t = line.trim()
  if (t.length === 0 || t.length > 40) return false
  return HEADING_PATTERNS.some((re) => re.test(t))
}

/** 识别章节。识别不到任何标题时返回 []。标题之前的非空前言算作第 0 章“前言”。 */
export function detectChapters(rawText: string): Chapter[] {
  const text = normalizeText(rawText)
  const lines = text.split('\n')
  const heads: Array<{ line: number; offset: number; title: string }> = []
  let offset = 0
  lines.forEach((line, i) => {
    if (isHeading(line))
      heads.push({ line: i, offset, title: line.trim().replace(/^#{1,3}\s+/, '') })
    offset += line.length + 1
  })
  if (heads.length === 0) return []

  const chapters: Chapter[] = []
  const push = (
    title: string,
    startLine: number,
    startOffset: number,
    endLine: number,
    endOffset: number,
  ) => {
    const body = text.slice(startOffset, endOffset)
    chapters.push({
      index: chapters.length,
      title,
      startOffset,
      endOffset,
      startLine: startLine + 1,
      endLine: endLine + 1,
      charCount: countChars(body),
    })
  }
  if (heads[0].offset > 0 && text.slice(0, heads[0].offset).trim()) {
    push('前言', 0, 0, heads[0].line - 1, heads[0].offset)
  }
  heads.forEach((h, i) => {
    const next = heads[i + 1]
    const endOffset = next ? next.offset : text.length
    const endLine = next ? next.line - 1 : lines.length - 1
    push(h.title, h.line, h.offset, Math.max(h.line, endLine), endOffset)
  })
  return chapters
}

/**
 * 没有章节标题的文本：按段落切成约 `targetChars` 字一段的“节”，保证每段在段落边界上断开。
 * 单个超长段落（没有换行的整篇）按句末标点再切。
 */
export function splitIntoSections(rawText: string, targetChars = 3000): Chapter[] {
  const text = normalizeText(rawText)
  const units: Array<{ start: number; end: number }> = []
  let pos = 0
  for (const para of text.split('\n')) {
    const end = pos + para.length
    if (countChars(para) > targetChars * 1.5) {
      // 超长段落：按句末标点切
      let s = pos
      const re = /[。！？!?；;…]+["”』」)）]*/g
      let m: RegExpExecArray | null
      const slice = text.slice(pos, end)
      let last = 0
      while ((m = re.exec(slice))) {
        const e = pos + m.index + m[0].length
        units.push({ start: s, end: e })
        s = e
        last = m.index + m[0].length
      }
      if (pos + last < end) units.push({ start: pos + last, end })
    } else if (para.trim()) {
      units.push({ start: pos, end })
    }
    pos = end + 1
  }
  const sections: Chapter[] = []
  let cur: { start: number; end: number; chars: number } | undefined
  const flush = () => {
    if (!cur) return
    const body = text.slice(cur.start, cur.end)
    const startLine = text.slice(0, cur.start).split('\n').length
    sections.push({
      index: sections.length,
      title: `第 ${sections.length + 1} 节`,
      startOffset: cur.start,
      endOffset: cur.end,
      startLine,
      endLine: startLine + body.split('\n').length - 1,
      charCount: cur.chars,
    })
    cur = undefined
  }
  for (const u of units) {
    const chars = countChars(text.slice(u.start, u.end))
    if (cur && cur.chars + chars > targetChars) flush()
    cur = cur
      ? { start: cur.start, end: u.end, chars: cur.chars + chars }
      : { start: u.start, end: u.end, chars }
  }
  flush()
  return sections
}

/** 供分集规划使用：有章节标题用章节，没有就合成“节”。 */
export function chaptersOrSections(text: string, targetChars = 3000): Chapter[] {
  const found = detectChapters(text)
  return found.length > 0 ? found : splitIntoSections(text, targetChars)
}

/**
 * 把一段章节序列按字数预算切成若干窗口（每个窗口至少含一章；超长章节单独成窗）。
 */
export function windowChapters<T extends { charCount: number }>(
  chapters: readonly T[],
  options: { maxChars: number; maxItems?: number },
): T[][] {
  const out: T[][] = []
  let cur: T[] = []
  let chars = 0
  for (const c of chapters) {
    const full = cur.length >= (options.maxItems ?? Infinity)
    if (cur.length > 0 && (chars + c.charCount > options.maxChars || full)) {
      out.push(cur)
      cur = []
      chars = 0
    }
    cur.push(c)
    chars += c.charCount
  }
  if (cur.length > 0) out.push(cur)
  return out
}

/**
 * 把一段文本切成不超过 `maxChars` 字的片段，只在段落（其次句末）边界断开。用于一章本身就很长的情况。
 */
export function splitTextByBudget(rawText: string, maxChars: number): string[] {
  const text = normalizeText(rawText)
  if (countChars(text) <= maxChars) return [text]
  const secs = splitIntoSections(text, maxChars)
  return secs.map((s) => text.slice(s.startOffset, s.endOffset))
}
