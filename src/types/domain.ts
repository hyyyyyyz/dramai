/**
 * 域模型 — dramai 的核心实体类型。
 *
 * 这些类型同时被 Zustand store、Dexie schema、AI 客户端协议共享。
 * 任何字段变更都意味着一次 IndexedDB 迁移（修改 src/core/storage/db.ts 的
 * version 号 + stores 描述）。
 */

export type ProviderKind = 'llm' | 'text2image' | 'image2video' | 'imageEdit'

export interface Provider {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  apiKey: string
  model: string
  notes?: string
  /** 仅在测试连接成功后写入。 */
  lastVerifiedAt?: number
}

export type ActiveProviderMap = Partial<Record<ProviderKind, string>>

export type ProjectStatus = 'draft' | 'storyboarding' | 'generating' | 'done'

export interface Project {
  id: string
  title: string
  summary?: string
  style?: string
  status: ProjectStatus
  createdAt: number
  updatedAt: number
}

export type CharacterRole = 'protagonist' | 'supporting' | 'extra'

export interface Character {
  id: string
  projectId: string
  name: string
  description?: string
  role: CharacterRole
  /** 关联到 assets 表里的参考图。 */
  referenceAssetId?: string
  /** 当为 true 时，分镜里出场会直接使用 referenceAssetId 作为图生图源图。 */
  locked: boolean
  createdAt: number
}

export type MaterialKind = 'doc' | 'txt' | 'md' | 'image'

export interface Material {
  id: string
  projectId: string
  kind: MaterialKind
  name: string
  /** 解析后的文本内容（image 类型为空字符串）。 */
  text: string
  /** 关联到 assets 表的原始文件。 */
  assetId?: string
  createdAt: number
}

export interface Storyboard {
  id: string
  projectId: string
  sequence: number
  sceneText: string
  narration?: string
  imagePrompt?: string
  /** 出场角色的 character.id 列表。 */
  characterIds: string[]
  durationSec?: number
  imageAssetId?: string
  videoAssetId?: string
  status: 'pending' | 'image-ready' | 'video-ready' | 'failed'
}

export type AssetKind = 'image' | 'video' | 'doc'

export interface Asset {
  id: string
  projectId: string
  kind: AssetKind
  /** 原始 mime type，例如 image/png、video/mp4。 */
  mimeType: string
  blob: Blob
  width?: number
  height?: number
  createdAt: number
}

export interface Generation {
  id: string
  projectId: string
  stageName: 'rewrite' | 'storyboard' | 'image' | 'camera' | 'video'
  status: 'pending' | 'running' | 'success' | 'failed'
  input: unknown
  output?: unknown
  error?: string
  retry: number
  createdAt: number
  finishedAt?: number
}
