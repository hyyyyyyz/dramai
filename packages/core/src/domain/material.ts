import type { FileRef, ProjectId } from './common.ts'

export type MaterialKind = 'doc' | 'txt' | 'md' | 'image'

/** 原文里识别出的一章。偏移按字符，行号从 1 起。 */
export interface Chapter {
  /** 0 起的序号（材料内）。 */
  index: number
  title: string
  startOffset: number
  endOffset: number
  startLine: number
  endLine: number
  charCount: number
}

/** 上传的素材：原文文档（解析成文本，**不截断**）或参考图。 */
export interface Material {
  schemaVersion: number
  id: string
  projectId: ProjectId
  /** 项目内单调发号；素材顺序按它。 */
  number: number
  kind: MaterialKind
  name: string
  /** 完整文本（image 为空串）。 */
  text: string
  charCount: number
  chapters: Chapter[]
  file?: FileRef
  size?: { width: number; height: number }
  createdAt: number
}
