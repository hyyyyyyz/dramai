import { describe, expect, it } from 'vitest'
import {
  chaptersOrSections,
  countChars,
  detectChapters,
  normalizeText,
  splitIntoSections,
  splitTextByBudget,
  windowChapters,
} from '../src/parsers/chapters.ts'
import { parseMaterial } from '../src/parsers/material.ts'
import { makeNovel } from './fakes.ts'

describe('countChars', () => {
  it('counts non-whitespace characters (Chinese by character)', () => {
    expect(countChars('你好，世界')).toBe(5)
    expect(countChars(' a b\n c\t')).toBe(3)
    expect(countChars('')).toBe(0)
  })
})

describe('detectChapters', () => {
  it('recognises Chinese chapter headings with numerals', () => {
    const text = '第一章 雨夜\n甲\n乙\n第二章 重逢\n丙\n第十二回：终局\n丁'
    const ch = detectChapters(text)
    expect(ch.map((c) => c.title)).toEqual(['第一章 雨夜', '第二章 重逢', '第十二回：终局'])
    expect(ch[0]).toMatchObject({ index: 0, startLine: 1, endLine: 3 })
    expect(text.slice(ch[1].startOffset, ch[1].endOffset)).toBe('第二章 重逢\n丙\n')
    expect(ch[2].endOffset).toBe(text.length)
  })

  it('recognises Arabic-numeral, English and markdown headings', () => {
    expect(detectChapters('第3章 开始\n文\n第 4 节 继续\n文').map((c) => c.title)).toEqual([
      '第3章 开始',
      '第 4 节 继续',
    ])
    expect(
      detectChapters('Chapter 1\ntext\nCHAPTER 2: Two\ntext\nChapter IV\ntext').map((c) => c.title),
    ).toHaveLength(3)
    expect(detectChapters('# 序\n文\n## 第一幕\n文').map((c) => c.title)).toEqual(['序', '第一幕'])
  })

  it('treats text before the first heading as a preface chapter', () => {
    const ch = detectChapters('这是一段前言。\n\n第一章 开始\n正文')
    expect(ch.map((c) => c.title)).toEqual(['前言', '第一章 开始'])
    expect(ch[0].charCount).toBe(countChars('这是一段前言。'))
  })

  it('returns nothing when there are no headings, and ignores long lines that merely start with 第', () => {
    expect(
      detectChapters(
        '一整段没有标题的文字。\n第二天他醒来的时候，雨已经停了很久很久，街上一个人也没有了，只剩下水洼里的灯光。',
      ),
    ).toEqual([])
    expect(detectChapters('')).toEqual([])
  })

  it('chapter char counts add up to the whole text', () => {
    const text = makeNovel(5, 4)
    const ch = detectChapters(text)
    expect(ch).toHaveLength(5)
    expect(ch.reduce((n, c) => n + c.charCount, 0)).toBe(countChars(text))
  })

  it('handles CRLF and BOM through normalizeText', () => {
    expect(normalizeText('﻿a\r\nb\rc')).toBe('a\nb\nc')
  })
})

describe('splitIntoSections: long text without headings', () => {
  const para = (n: number) =>
    `这是第${n}段，写的是雨夜里发生的事情，人物来来往往，没有谁多说一句话。`
  it('cuts at paragraph boundaries around the target size, covering everything exactly once', () => {
    const text = Array.from({ length: 60 }, (_, i) => para(i)).join('\n')
    const secs = splitIntoSections(text, 300)
    expect(secs.length).toBeGreaterThan(3)
    for (const s of secs) expect(s.charCount).toBeLessThanOrEqual(300 + 40)
    // 每一节都从段落开头开始、到段落结尾结束
    for (const s of secs) {
      expect(s.startOffset === 0 || text[s.startOffset - 1] === '\n').toBe(true)
      expect(s.endOffset === text.length || text[s.endOffset] === '\n').toBe(true)
    }
    expect(secs.reduce((n, s) => n + s.charCount, 0)).toBe(countChars(text))
    expect(secs.map((s) => s.index)).toEqual(secs.map((_, i) => i))
  })

  it('splits one huge paragraph at sentence ends', () => {
    const text = Array.from({ length: 200 }, (_, i) => `第${i}句话说完了。`).join('')
    const secs = splitIntoSections(text, 200)
    expect(secs.length).toBeGreaterThan(3)
    for (const s of secs) expect(text.slice(s.startOffset, s.endOffset).endsWith('。')).toBe(true)
  })

  it('chaptersOrSections prefers real headings', () => {
    expect(chaptersOrSections(makeNovel(3, 2)).map((c) => c.title)).toEqual([
      '第1章 夜雨',
      '第2章 夜雨',
      '第3章 夜雨',
    ])
    expect(
      chaptersOrSections(Array.from({ length: 30 }, (_, i) => para(i)).join('\n'), 200)[0].title,
    ).toMatch(/^第 1 节/)
  })
})

describe('windowChapters / splitTextByBudget', () => {
  const ch = (n: number, charCount: number) => ({ id: n, charCount })
  it('groups by char budget, never dropping or reordering a chapter', () => {
    const list = [ch(1, 500), ch(2, 500), ch(3, 500), ch(4, 2000), ch(5, 100)]
    const windows = windowChapters(list, { maxChars: 1200 })
    expect(windows.map((w) => w.map((c) => c.id))).toEqual([[1, 2], [3], [4], [5]])
    expect(windows.flat()).toEqual(list)
  })
  it('an oversized chapter becomes its own window, and maxItems caps the window length', () => {
    expect(windowChapters([ch(1, 9000)], { maxChars: 100 })).toEqual([[ch(1, 9000)]])
    expect(
      windowChapters([ch(1, 1), ch(2, 1), ch(3, 1)], { maxChars: 100, maxItems: 2 }).map(
        (w) => w.length,
      ),
    ).toEqual([2, 1])
    expect(windowChapters([], { maxChars: 10 })).toEqual([])
  })
  it('splits text under a char budget and reassembles losslessly at paragraph borders', () => {
    const text = Array.from({ length: 40 }, (_, i) => `第${i}段：${'字'.repeat(80)}`).join('\n')
    const parts = splitTextByBudget(text, 500)
    expect(parts.length).toBeGreaterThan(4)
    expect(parts.join('\n')).toBe(text)
    expect(splitTextByBudget('短', 500)).toEqual(['短'])
  })
})

describe('parseMaterial returns chapter count and char count, and never truncates', () => {
  it('reports chapters and characters for a long multi-chapter text file', async () => {
    const text = makeNovel(30, 10)
    expect(countChars(text)).toBeGreaterThan(4000 * 3) // 远超 v0.4 的 4000 字上限
    const m = await parseMaterial({ name: '长篇.txt', bytes: new TextEncoder().encode(text) })
    expect(m.kind).toBe('txt')
    expect(m.chapters).toHaveLength(30)
    expect(m.charCount).toBe(countChars(text))
    expect(m.text).toBe(normalizeText(text).trim())
    expect(m.text.length).toBeGreaterThan(4000)
  })
  it('images have no text and zero chapters', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
      1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
    ])
    const m = await parseMaterial({ name: 'a.png', bytes: png })
    expect(m).toMatchObject({ kind: 'image', text: '', charCount: 0, chapters: [] })
  })
})
