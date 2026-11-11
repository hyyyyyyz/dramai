import { readImageSize } from './image-size.ts'

import type { Chapter, MaterialKind } from '../domain/material.ts'
import { countChars, detectChapters, normalizeText } from './chapters.ts'
import { DomainError } from '../errors.ts'

export type { MaterialKind }

export interface ParsedMaterial {
  kind: MaterialKind
  name: string
  /** 解析后的纯文本（image 为空字符串）。**不截断**。 */
  text: string
  /** 字数（不含空白）。 */
  charCount: number
  /** 识别出的章节（没有标题则为空）。 */
  chapters: Chapter[]
  /** 图片尺寸（读不出则缺省）。 */
  size?: { width: number; height: number }
  mimeType: string
}

/** 文件大小硬上限：20 MB。 */
export const MAX_MATERIAL_SIZE = 20 * 1024 * 1024

const EXT_TO_KIND: Record<string, MaterialKind> = {
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  doc: 'doc',
  docx: 'doc',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export class UnsupportedMaterialError extends Error {
  constructor(name: string) {
    super(`不支持的文件类型：${name}`)
    this.name = 'UnsupportedMaterialError'
  }
}

export class MaterialTooLargeError extends Error {
  constructor(name: string, bytes: number) {
    super(
      `文件 ${name} 体积 ${(bytes / 1024 / 1024).toFixed(1)}MB，超过 ${(MAX_MATERIAL_SIZE / 1024 / 1024).toFixed(0)}MB 上限`,
    )
    this.name = 'MaterialTooLargeError'
  }
}

export function detectKind(name: string, mime?: string): MaterialKind | undefined {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext in EXT_TO_KIND) return EXT_TO_KIND[ext]
  if (mime?.startsWith('image/')) return 'image'
  if (mime === 'text/plain') return 'txt'
  if (mime === 'text/markdown') return 'md'
  if (mime === DOCX_MIME) return 'doc'
  return undefined
}

export async function parseMaterial(input: {
  name: string
  bytes: Uint8Array
  mime?: string
}): Promise<ParsedMaterial> {
  if (input.bytes.byteLength > MAX_MATERIAL_SIZE) {
    throw new MaterialTooLargeError(input.name, input.bytes.byteLength)
  }
  const kind = detectKind(input.name, input.mime)
  if (!kind) throw new UnsupportedMaterialError(input.name)

  switch (kind) {
    case 'doc': {
      const mammoth = await import('mammoth')
      try {
        const result = await mammoth.extractRawText({ buffer: Buffer.from(input.bytes) })
        return withText({
          kind,
          name: input.name,
          text: result.value.trim(),
          mimeType: input.mime || DOCX_MIME,
        })
      } catch (err) {
        // 旧版 .doc（OLE）格式 mammoth 不支持，会走到这里。
        throw new DomainError(
          'MATERIAL_PARSE_FAILED',
          `无法解析文档 ${input.name}：${err instanceof Error ? err.message : String(err)}`,
          { cause: err, details: { name: input.name } },
        )
      }
    }
    case 'image': {
      const size = readImageSize(input.bytes)
      return {
        kind,
        name: input.name,
        text: '',
        charCount: 0,
        chapters: [],
        size: size ? { width: size.width, height: size.height } : undefined,
        mimeType: input.mime || size?.mime || 'image/*',
      }
    }
    case 'txt':
    case 'md': {
      // md 不展开为 HTML：LLM 自己读得懂，列表/标题对抽分镜更友好。
      const text = new TextDecoder('utf-8')
        .decode(input.bytes)
        .replace(/^\uFEFF/, '')
        .trim()
      return withText({
        kind,
        name: input.name,
        text,
        mimeType: input.mime || (kind === 'md' ? 'text/markdown' : 'text/plain'),
      })
    }
  }
}

function withText(p: Omit<ParsedMaterial, 'charCount' | 'chapters'>): ParsedMaterial {
  const text = normalizeText(p.text)
  return { ...p, text, charCount: countChars(text), chapters: detectChapters(text) }
}
