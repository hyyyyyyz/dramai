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

/**
 * 系统追加的修订的机器可读原因（用户自己的修改没有；以前创建的修订也没有）。
 * 界面据此显示本地化的说明，不要靠摘要文字（摘要是中文，给人看的）。以后新增原因码是加法。
 * - `native_audio_default`：这个镜头第一次拿到生成的视频，而模型无法关闭自带音频、镜头又没有使用原生人声，
 *   片段原声的默认音量被设为 0；
 * - `initial`：一集的第一份时间线（按镜头顺序一镜头一片段）；
 * - `sync_shots`：镜头新增 / 删除 / 重排后，把时间线同步成当前的镜头顺序；
 * - `rollback`：回滚到旧修订（`restoredFrom` 是旧修订号）。
 */
export const TIMELINE_REVISION_REASONS = [
  'native_audio_default',
  'initial',
  'sync_shots',
  'rollback',
] as const
export type TimelineRevisionReason = (typeof TIMELINE_REVISION_REASONS)[number]

export interface TimelineRevision {
  /** 从 1 连续编号。 */
  number: number
  parent?: number
  /**
   * 谁产生的这个修订：`creator` 用户自己；`system` **系统按规则自动产生**（不是用户，也不是智能体：第一份时间线、同步镜头顺序、
   * 自动静音）；`agent` / `external` 保留给以后真的有智能体 / 外部程序的时候（现在没有任何代码写它们，
   * 开发数据里早先的自动静音修订还记着 `agent`，照常读取）。回滚是用户的操作，作者是 `creator`。
   * 没有任何逻辑按作者种类做判断（“用户有没有调过音量”只看每个修订里片段的音量值）。
   */
  author: { kind: 'creator' | 'agent' | 'external' | 'system'; userId?: string }
  summary: string
  createdAt: number
  content: { clips: TimelineClip[]; bgm: TimelineBgmClip[] }
  changedClipIds?: string[]
  restoredFrom?: number
  /** 只有系统自动追加的修订才有，见 `TimelineRevisionReason`。 */
  reason?: TimelineRevisionReason
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
