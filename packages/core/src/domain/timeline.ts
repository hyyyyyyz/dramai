import type { EpisodeId, ShotId } from './common.ts'

/**
 * 剪辑时间线（A8）。2B 实现：创建、追加修订、回滚、摆放（纯函数）、读取时的问题检查、渲染。
 * 转场只做硬切（词表保留在类型里），配乐一条。
 *
 * 成片渲染、浏览器预览、剪映草稿共用这一份数据。内部时间一律是整数微秒（`*Us`），
 * 对外才换算成秒。修订追加式、不可变；回滚 = 以旧内容追加新修订。
 */

export const TIMELINE_TRANSITIONS = [
  'dissolve',
  'fade_black',
  'fade_white',
  'push_left',
  'push_right',
  'push_up',
  'push_down',
  'wipe_left',
  'wipe_right',
  'wipe_up',
  'wipe_down',
  'circle',
  'bars_h',
  'bars_v',
  'mosaic',
  'blur',
  'radial',
  'gradient_wipe',
  'squeeze',
] as const
export type TimelineTransition = (typeof TIMELINE_TRANSITIONS)[number]

export interface TimelineClip {
  /** 形如 "c12"，稳定、不复用。 */
  id: string
  shotId: ShotId
  /** 截取只对 basisVersionId 这一视频版本有效；换了版本，整段使用。 */
  trim?: { inUs: number; outUs: number; basisVersionId: string }
  /** 0..1。台词/无人声镜 1.0；画外音镜 0.3。 */
  sourceVolume: number
  /** 出点帧静帧延长。 */
  holdUs: number
  /** 一个镜头最多一个片段承载旁白。 */
  carriesNarration: boolean
  reason?: string
  transitionToNext?: { type: TimelineTransition; durationUs: number }
}

export interface TimelineBgmClip {
  /** 形如 "b3"。 */
  id: string
  bgmId: string
  startUs: number
  inUs: number
  outUs: number
  /** 默认 0.25。 */
  volume: number
  /** 默认各 1 秒。 */
  fadeInUs: number
  fadeOutUs: number
}

export interface TimelineRevision {
  /** 从 1 连续编号。 */
  number: number
  parent?: number
  author: { kind: 'creator' | 'agent' | 'external'; userId?: string }
  summary: string
  createdAt: number
  content: { clips: TimelineClip[]; bgm: TimelineBgmClip[] }
  changedClipIds?: string[]
  restoredFrom?: number
}

export interface TimelineDocument {
  schemaVersion: number
  /** 形如 "tl-xxxxxxxx"，随机、不复用；产物身份挂在它上面。 */
  id: string
  projectId: string
  episodeId: EpisodeId
  name: string
  nextClipNumber: number
  nextBgmNumber: number
  revisions: TimelineRevision[]
}
