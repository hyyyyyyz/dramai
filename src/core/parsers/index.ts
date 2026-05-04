import type { MaterialKind } from '@/types/domain'
import { parseDocxFile } from '@/core/parsers/docx'
import { parsePlainTextFile } from '@/core/parsers/text'
import { parseImageFile } from '@/core/parsers/image'

export interface ParsedMaterial {
  kind: MaterialKind
  /** 用于展示的文件名，去掉扩展名后的 base name 不在这里处理。 */
  name: string
  /** 解析后的纯文本内容（image 留空字符串）。 */
  text: string
  /** 图片专用：尺寸 + thumbnail blob URL（调用方负责释放）。 */
  preview?: {
    width: number
    height: number
  }
  /**
   * 原始文件 — 调用方决定要不要把它写进 IndexedDB assets 表，
   * 或者只解析文本然后丢弃。
   */
  blob: Blob
  /** 原始 mime，用于回写到 Asset。 */
  mimeType: string
}

/** 文件大小硬上限：默认 20 MB，避免 IndexedDB 写爆。 */
export const MAX_MATERIAL_SIZE = 20 * 1024 * 1024

const SUPPORTED_EXT_TO_KIND: Record<string, MaterialKind> = {
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

export class UnsupportedMaterialError extends Error {
  constructor(file: File) {
    super(`不支持的文件类型：${file.name}`)
    this.name = 'UnsupportedMaterialError'
  }
}

export class MaterialTooLargeError extends Error {
  constructor(file: File) {
    super(
      `文件 ${file.name} 体积 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 ${(MAX_MATERIAL_SIZE / 1024 / 1024).toFixed(0)}MB 上限`,
    )
    this.name = 'MaterialTooLargeError'
  }
}

export function detectKind(file: File): MaterialKind | undefined {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  if (ext in SUPPORTED_EXT_TO_KIND) return SUPPORTED_EXT_TO_KIND[ext]
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'text/plain') return 'txt'
  if (file.type === 'text/markdown') return 'md'
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'doc'
  }
  return undefined
}

export async function parseFile(file: File): Promise<ParsedMaterial> {
  if (file.size > MAX_MATERIAL_SIZE) {
    throw new MaterialTooLargeError(file)
  }
  const kind = detectKind(file)
  if (!kind) throw new UnsupportedMaterialError(file)

  switch (kind) {
    case 'doc':
      return parseDocxFile(file)
    case 'image':
      return parseImageFile(file)
    case 'txt':
    case 'md':
      return parsePlainTextFile(file, kind)
  }
}
