/**
 * 发声归属（A9）。
 *
 * 主流视频模型自带人声和口型。一个镜头的声音由谁出必须明确，否则会出现两层人声：
 * 视频模型要么让画面里的人物对口型念出画外音，要么随机冒出一个不属于任何人的声音。
 *
 * 规则（`deriveVoiceOwner`，机械派生，**不落盘**，每次从台词 / 旁白条目重算）：
 * - 只有台词 → `native`：由视频模型的原生人声承载（生成视频时开启原声）；
 * - 只有旁白 → 按项目的旁白交付方式：`tts` / `post` / `none`(→ silent)；旁白**整段不进视频提示词**；
 * - 两者都有 → `conflict`：规划阶段拦截（准入检查直接阻断，不让它走到付费）；
 * - 都没有 → `silent`。
 */

/** 旁白交付方式：项目级配置，创建项目时选。`post` 项目不生成 TTS，也不报旁白缺失。 */
export type NarrationDelivery = 'tts' | 'post' | 'none'

/**
 * 一个镜头的发声归属。
 * - `native`：台词由视频模型的原生人声承载
 * - `tts`：旁白由独立 TTS 交付
 * - `post`：旁白留给后期配音
 * - `silent`：无人声
 * - `conflict`：台词与旁白混在同一镜头（规划阶段应拦截）
 */
export type VoiceOwner = 'native' | 'tts' | 'post' | 'silent' | 'conflict'

export interface ShotVoicePlan {
  /** 预留。当前不写入；将来由台词/旁白条目机械派生。 */
  owner?: VoiceOwner
  /** 预留：把角色音色参考音频随视频请求发出（音色锚定）。 */
  anchorAssetIds?: string[]
}

export interface VoiceSource {
  dialogue: ReadonlyArray<{ text: string }>
  narration?: string
}

export function hasDialogue(shot: VoiceSource): boolean {
  return shot.dialogue.some((d) => d.text.trim().length > 0)
}

export function hasNarration(shot: VoiceSource): boolean {
  return (shot.narration?.trim().length ?? 0) > 0
}

export function deriveVoiceOwner(shot: VoiceSource, delivery: NarrationDelivery): VoiceOwner {
  const d = hasDialogue(shot)
  const n = hasNarration(shot)
  if (d && n) return 'conflict'
  if (d) return 'native'
  if (n) return delivery === 'none' ? 'silent' : delivery
  return 'silent'
}
