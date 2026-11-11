/**
 * 域模型的公共类型。
 *
 * 约定：
 * - 所有实体 id 是不透明字符串（由 IdGenerator 发放，全局唯一、永不复用）。
 *   "只增不复用的号"另有 `number` 字段（项目内单调计数，来自 Project.counters），
 *   用于展示和"发号先后"；播出/成片顺序只看父实体里的有序数组，不看 id 也不看 number。
 * - 每份落库文档都带 `schemaVersion`，迁移按步执行（迁移逻辑在 server 的存储层）。
 * - 时间一律是 epoch 毫秒；时间线内部用整数微秒（见 timeline.ts）。
 */

export const ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const
export type AspectRatio = (typeof ASPECT_RATIOS)[number]

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === 'string' && (ASPECT_RATIOS as readonly string[]).includes(value)
}

/** 把比例拆成整数宽高比，例如 "9:16" → { w: 9, h: 16 }。 */
export function aspectParts(ratio: AspectRatio): { w: number; h: number } {
  const [w, h] = ratio.split(':').map(Number)
  return { w, h }
}

export type ProjectId = string
export type EpisodeId = string
export type SceneId = string
export type ShotId = string
export type AssetId = string
export type JobId = string
export type VersionId = string
export type CandidateId = string

export const SCHEMA_VERSIONS = {
  project: 1,
  episode: 1,
  scene: 1,
  shot: 1,
  asset: 1,
  candidate: 1,
  job: 1,
  artifact: 1,
  timeline: 1,
} as const

/** 指向项目文件夹内某个文件的引用。`path` 相对项目目录，历史版本的路径含版本号且不可变。 */
export interface FileRef {
  path: string
  mime: string
  bytes: number
  sha256: string
}

/** 文件自身的内容事实（探测所得），用于清单与预览。 */
export interface MediaFacts {
  width?: number
  height?: number
  durationSec?: number
  hasAudio?: boolean
  fps?: number
}
