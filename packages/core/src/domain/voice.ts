/**
 * 发声归属（A9）——**阶段 2 只预留类型，不含行为**。
 *
 * 主流视频模型自带人声和口型。一个镜头的声音由谁出必须记录，否则会出现两层人声。
 * 具体的派生规则、规划期拦截、TTS 与对齐在阶段 5 实现；这里只保证存储形状不需要再改。
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
