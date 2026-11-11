import type { AssetId, ProjectId, ShotId } from './common.ts'
import type { AspectRatio } from './common.ts'
import type { MediaSlot } from './media.ts'
import type { ShotVoicePlan } from './voice.ts'

export interface Scene {
  schemaVersion: number
  id: string
  projectId: ProjectId
  episodeId: string
  number: number
  title?: string
  locationAssetId?: AssetId
  /** 拆分时 LLM 写的地点名（未解析的原始提示；地点候选确认后会解析成 `locationAssetId`）。 */
  locationHint?: string
  timeOfDay?: string
  /** 场景站位记录（A4）：固定锚点、轴线、屏幕方向。 */
  blocking?: string
  /** 镜头顺序。成片顺序看这个数组，不看 id。 */
  shotOrder: ShotId[]
  createdAt: number
  updatedAt: number
}

export const CAMERA_SHOTS = ['ECU', 'CU', 'MCU', 'MS', 'MLS', 'LS', 'ELS'] as const
export type CameraShot = (typeof CAMERA_SHOTS)[number]

export const CAMERA_ANGLES = [
  'eye_level',
  'high',
  'low',
  'dutch',
  'birds_eye',
  'over_shoulder',
] as const
export type CameraAngle = (typeof CAMERA_ANGLES)[number]

/** 一镜一个主运镜（铁律）。沿用 v0.4 的词表。 */
export const CAMERA_MOVEMENTS = [
  'static',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'zoom_in',
  'zoom_out',
  'orbit_left',
  'orbit_right',
  'dolly_in',
  'dolly_out',
] as const
export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number]

export interface DialogueLine {
  /** 说话人资产（实体确认后解析出来）。 */
  speakerAssetId?: AssetId
  /** 拆分时 LLM 给出的说话人名字（尚未解析成资产的原始提示；解析后保留供核对）。 */
  speakerName?: string
  text: string
  emotion?: string
}

/** 每个阶段的状态。`ready`（准备好）与 generating（生成中）是两个独立概念。 */
export type StageStatus = 'pending' | 'queued' | 'running' | 'succeeded' | 'failed'
export type ShotStage = 'image' | 'video' | 'audio'

export interface ShotPrompts {
  firstFrame?: string
  keyFrame?: string
  lastFrame?: string
  video?: string
}

/**
 * 提示词的“创作语义槽”（A17）：LLM 只填语义，画风前缀 / 参考图绑定 / 负面处理 / 防字地板
 * 由编译器按目标模型的写法（PromptDialect）在生成时注入。槽里的资产用 `@{assetId}` 占位符。
 */
export interface ShotPromptSpec {
  image?: import('../prompts/compile.ts').ImagePromptSpec
  video?: import('../prompts/compile.ts').VideoPromptSpec
  /** 镜内变化幅度（ViMax 的三分法）：决定是否需要尾帧。 */
  changeMagnitude?: 'small' | 'medium' | 'large'
}

export interface Shot {
  schemaVersion: number
  id: ShotId
  projectId: ProjectId
  sceneId: string
  /** 项目内单调发号，不复用；中途插镜不用改号。 */
  number: number
  title: string
  scriptExcerpt: string
  cameraShot?: CameraShot
  angle?: CameraAngle
  movement: CameraMovement
  /** 唯一时长来源。 */
  durationSec: number
  /** 空 = 继承项目画幅。 */
  aspectOverride?: AspectRatio
  moodTags: string[]
  atmosphere?: string
  dialogue: DialogueLine[]
  narration?: string
  actionBeats: string[]
  prompts: ShotPrompts
  /** 语义槽（可选）。有它时生成会按目标模型的写法重新编译；`prompts` 是它的中性文本形式，供预览和编辑。 */
  promptSpec?: ShotPromptSpec
  /**
   * 拆分时 LLM 写出的出场实体名字——**未解析的原始提示**，供实体抽取使用；
   * 候选确认后，真正的引用在引用表里，这里不再参与任何生成。
   */
  entityHints?: { characters: string[]; location?: string; props: string[]; costumes: string[] }
  /** 实体候选已确认、可进入生成。独立于 stages。 */
  ready: boolean
  stages: Record<ShotStage, StageStatus>
  /** 失败时记录失败在哪一阶段，不能只有一个 failed。 */
  failedStage?: 'image' | 'video'
  image: MediaSlot
  video: MediaSlot
  narrationAudio: MediaSlot
  /** A9 预留。 */
  voice?: ShotVoicePlan
  createdAt: number
  updatedAt: number
}

/** 镜头 → 资产的引用表行。 */
export interface ShotAssetRef {
  shotId: ShotId
  assetId: AssetId
  /** 引用的衍生形态名（换装/变身），空 = 本体。 */
  variantName?: string
}

export function effectiveAspect(
  project: { aspectRatio: AspectRatio },
  shot: { aspectOverride?: AspectRatio },
): AspectRatio {
  return shot.aspectOverride ?? project.aspectRatio
}
