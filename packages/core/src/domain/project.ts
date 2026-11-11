import type { AspectRatio, EpisodeId, FileRef, ProjectId } from './common.ts'
import type { NarrationDelivery } from './voice.ts'

/**
 * 风格快照（A1）：创建项目时把所选风格模板展开成完整文本写进项目。
 * 之后模板更新不回写旧项目（否则已出片项目会风格突变）。
 * "风格模板 / 风格参考图 / 自定义 / 无" 互斥，写入一个时清掉另一个。
 */
export type StyleSource = 'template' | 'reference_image' | 'custom' | 'none'

export interface StyleSnapshot {
  source: StyleSource
  /** 来源模板 id，只是来源标记，不参与生成。 */
  templateId?: string
  /** 给人看的名称。 */
  label: string
  /** 给人看的描述（中文）。 */
  description: string
  /** 展开后的画面关键词（英文），生成图像时作为视觉基底。 */
  imageKeywords: string
  /** source = reference_image 时指向某个资产原图。 */
  referenceFile?: FileRef
  expandedAt: number
}

/** 项目内的单调计数器：只增不复用，覆盖已删除对象。 */
export interface ProjectCounters {
  episode: number
  scene: number
  shot: number
  asset: number
  material: number
}

export interface Project {
  schemaVersion: number
  id: ProjectId
  name: string
  summary?: string
  /** 项目唯一的画幅真相：生图、生视频、合成都以它为准。 */
  aspectRatio: AspectRatio
  style: StyleSnapshot
  /** 旁白交付方式（A9）。 */
  narrationDelivery: NarrationDelivery
  /**
   * 旁白配音设置（项目级）：用哪个 TTS 服务商配置、哪个音色、语速。
   * 角色的对白音色在角色资产的 `voiceRef` 上，不在这里。改了它，已生成的旁白音频判为过期。
   */
  narrationVoice?: NarrationVoice
  /** 播出顺序（"分集账本"）。顺序不放在 Episode 上。 */
  episodeOrder: EpisodeId[]
  counters: ProjectCounters
  /** 从 v0.4 备份导入时记下来源，避免重复导入。 */
  importedFrom?: { format: 'dramai-backup'; version: number; legacyProjectId: string }
  createdAt: number
  updatedAt: number
  /** 已删除项目进回收目录，保留期内可恢复。 */
  deletedAt?: number
}

export interface NarrationVoice {
  /** TTS 服务商配置 id（`ProviderConfig.id`）。 */
  providerConfigId: string
  voice: string
  speed?: number
}

/**
 * 集的状态（按创作流程的里程碑）：
 * - `planned`      待拆分：已规划标题与原文范围，还没有拆出镜头
 * - `storyboarding` 分镜进行中：已有镜头，但还有镜头没“准备好”（候选未确认等）
 * - `producing`    制作中：全部镜头准备好，在出设定图 / 分镜图 / 视频
 * - `composed`     已合成：有当前成片
 * - `exported`     已导出：用户导出过成片或草稿包
 *
 * 状态是存下来的里程碑；各步骤的**计数**不存，由 `episodeProgress` 现算。
 * `deriveEpisodeStatus` 给出“按现状应处的状态”，2B 在相关操作之后用它更新。
 */
export const EPISODE_STATUSES = [
  'planned',
  'storyboarding',
  'producing',
  'composed',
  'exported',
] as const
export type EpisodeStatus = (typeof EPISODE_STATUSES)[number]

export interface Episode {
  schemaVersion: number
  id: EpisodeId
  projectId: ProjectId
  /** 项目内单调发号，不复用；不是播出顺序。 */
  number: number
  title: string
  /** 一两句剧情概要（分集规划产出）。 */
  summary?: string
  /** 对应原文的章节/行范围，可空。 */
  sourceRange?: { materialId?: string; startLine?: number; endLine?: number }
  status: EpisodeStatus
  sceneOrder: string[]
  createdAt: number
  updatedAt: number
}
