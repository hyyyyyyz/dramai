import './zod-setup.ts'
import { z } from 'zod'

/**
 * 前后端契约里的数据形状（响应和请求用到的实体）。
 *
 * 这个包**不 import 服务端或 core 的任何代码**：前端只依赖它。形状与 `@dramai/core` 的领域类型保持一致，
 * 服务端在返回前做结构检查（类型对不上就编译失败），所以两边不会悄悄漂移。
 */

export const aspectRatio = z.enum(['9:16', '16:9', '1:1'])
export type AspectRatio = z.infer<typeof aspectRatio>

export const fileRef = z.object({
  path: z.string(),
  mime: z.string(),
  bytes: z.number(),
  sha256: z.string(),
})
export type FileRef = z.infer<typeof fileRef>

export const mediaFacts = z.object({
  width: z.number().optional(),
  height: z.number().optional(),
  durationSec: z.number().optional(),
  hasAudio: z.boolean().optional(),
  fps: z.number().optional(),
})

export const providerSnapshot = z.object({
  providerConfigId: z.string().optional(),
  protocol: z.string(),
  baseUrl: z.string(),
  model: z.string(),
})

const referenceRole = z.enum(['start_frame', 'character', 'prop', 'location', 'costume', 'style'])
const usedReferenceItem = z.object({
  /** 发出的顺序，从 1 起，就是提示词里的“图 N”。较早的版本没有这个字段（按数组顺序理解）。 */
  order: z.number().optional(),
  role: referenceRole,
  assetId: z.string().optional(),
  assetName: z.string().optional(),
  variantName: z.string().optional(),
  versionId: z.string().optional(),
  sha256: z.string().optional(),
})

export const usedReferences = z.object({
  frame: z.enum(['as_reference', 'with_references']),
  references: z.array(usedReferenceItem),
  trimmed: z.number(),
})

export const mediaVersion = z.object({
  id: z.string(),
  kind: z.enum(['image', 'video', 'audio']),
  file: fileRef,
  source: z.enum(['generated', 'uploaded', 'image_edit']),
  createdAt: z.number(),
  jobId: z.string().optional(),
  /** 产生这个版本的那一次尝试（任务的 `attempt`）；较早的版本没有。恢复流程据此区分“这次尝试已经保存”和“上一次留下的旧版本”。 */
  attempt: z.number().optional(),
  prompt: z.string().optional(),
  provider: providerSnapshot.optional(),
  facts: mediaFacts.optional(),
  withNativeAudio: z.boolean().optional(),
  /** 视频：开启参考图生成时用了哪些参考图（只是记录，不参与过期判断）。 */
  usedReferences: usedReferences.optional(),
  basisDigest: z.string().optional(),
})
export type MediaVersion = z.infer<typeof mediaVersion>

export const mediaSlot = z.object({
  currentVersionId: z.string().nullable(),
  versions: z.array(mediaVersion),
})
export type MediaSlot = z.infer<typeof mediaSlot>

// === 项目 / 集 / 场 / 镜头 ===

export const styleSnapshot = z.object({
  source: z.enum(['template', 'reference_image', 'custom', 'none']),
  templateId: z.string().optional(),
  label: z.string(),
  description: z.string(),
  imageKeywords: z.string(),
  referenceFile: fileRef.optional(),
  expandedAt: z.number(),
})

export const narrationDelivery = z.enum(['tts', 'post', 'none'])

export const project = z.object({
  schemaVersion: z.number(),
  id: z.string(),
  name: z.string(),
  summary: z.string().optional(),
  aspectRatio,
  style: styleSnapshot,
  narrationDelivery,
  narrationVoice: z
    .object({
      providerConfigId: z.string(),
      voice: z.string(),
      speed: z.number().optional(),
      instructions: z.string().optional(),
      language: z.string().optional(),
    })
    .optional(),
  episodeOrder: z.array(z.string()),
  counters: z.object({
    episode: z.number(),
    scene: z.number(),
    shot: z.number(),
    asset: z.number(),
    material: z.number(),
  }),
  importedFrom: z
    .object({
      format: z.literal('dramai-backup'),
      version: z.number(),
      legacyProjectId: z.string(),
    })
    .optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
})
export type Project = z.infer<typeof project>

export const episodeStatus = z.enum([
  'planned',
  'storyboarding',
  'producing',
  'composed',
  'exported',
])

export const episode = z.object({
  schemaVersion: z.number(),
  id: z.string(),
  projectId: z.string(),
  number: z.number(),
  title: z.string(),
  summary: z.string().optional(),
  sourceRange: z
    .object({
      materialId: z.string().optional(),
      startLine: z.number().optional(),
      endLine: z.number().optional(),
    })
    .optional(),
  status: episodeStatus,
  /** 创作者给分镜拆解的额外要求；重新拆分时默认沿用。 */
  breakdownInstructions: z.string().optional(),
  sceneOrder: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Episode = z.infer<typeof episode>

export const scene = z.object({
  schemaVersion: z.number(),
  id: z.string(),
  projectId: z.string(),
  episodeId: z.string(),
  number: z.number(),
  title: z.string().optional(),
  locationAssetId: z.string().optional(),
  locationHint: z.string().optional(),
  timeOfDay: z.string().optional(),
  blocking: z.string().optional(),
  shotOrder: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Scene = z.infer<typeof scene>

export const cameraShot = z.enum(['ECU', 'CU', 'MCU', 'MS', 'MLS', 'LS', 'ELS'])
export const cameraAngle = z.enum([
  'eye_level',
  'high',
  'low',
  'dutch',
  'birds_eye',
  'over_shoulder',
])
export const cameraMovement = z.enum([
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
])
export const stageStatus = z.enum(['pending', 'queued', 'running', 'succeeded', 'failed'])

export const dialogueLine = z.object({
  speakerAssetId: z.string().optional(),
  speakerName: z.string().optional(),
  text: z.string(),
  emotion: z.string().optional(),
})

const imageSpec = z.object({
  subject: z.string().optional(),
  action: z.string().optional(),
  expression: z.string().optional(),
  spatial: z.string().optional(),
  shotSize: z.string().optional(),
  angle: z.string().optional(),
  lens: z.string().optional(),
  lighting: z.string().optional(),
  extra: z.string().optional(),
  fullEn: z.string().optional(),
  negative: z.array(z.string()).optional(),
})
const videoSpec = z.object({
  openingState: z.string().optional(),
  action: z.string().optional(),
  secondary: z.string().optional(),
  cameraMove: z.string().optional(),
  endState: z.string().optional(),
  lightingChange: z.string().optional(),
  soundIntent: z.string().optional(),
  extra: z.string().optional(),
  fullEn: z.string().optional(),
})

export const shot = z.object({
  schemaVersion: z.number(),
  id: z.string(),
  projectId: z.string(),
  sceneId: z.string(),
  number: z.number(),
  title: z.string(),
  scriptExcerpt: z.string(),
  cameraShot: cameraShot.optional(),
  angle: cameraAngle.optional(),
  movement: cameraMovement,
  durationSec: z.number(),
  aspectOverride: aspectRatio.optional(),
  moodTags: z.array(z.string()),
  atmosphere: z.string().optional(),
  dialogue: z.array(dialogueLine),
  narration: z.string().optional(),
  actionBeats: z.array(z.string()),
  prompts: z.object({
    firstFrame: z.string().optional(),
    keyFrame: z.string().optional(),
    lastFrame: z.string().optional(),
    video: z.string().optional(),
  }),
  promptSpec: z
    .object({
      image: imageSpec.optional(),
      video: videoSpec.optional(),
      changeMagnitude: z.enum(['small', 'medium', 'large']).optional(),
    })
    .optional(),
  entityHints: z
    .object({
      characters: z.array(z.string()),
      location: z.string().optional(),
      props: z.array(z.string()),
      costumes: z.array(z.string()),
    })
    .optional(),
  ready: z.boolean(),
  stages: z.object({ image: stageStatus, video: stageStatus, audio: stageStatus }),
  failedStage: z.enum(['image', 'video']).optional(),
  image: mediaSlot,
  video: mediaSlot,
  narrationAudio: mediaSlot,
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type Shot = z.infer<typeof shot>

export const shotRef = z.object({
  shotId: z.string(),
  assetId: z.string(),
  variantName: z.string().optional(),
})
export type ShotRef = z.infer<typeof shotRef>

// === 资产 / 候选 / 素材 ===

export const assetKind = z.enum(['character', 'location', 'prop', 'costume'])
export type AssetKind = z.infer<typeof assetKind>

export const assetVariant = z.object({
  name: z.string(),
  costumeAssetId: z.string().optional(),
  description: z.string(),
  origin: z.enum(['edit', 'upload']),
  editInstruction: z.string().optional(),
  sheet: mediaSlot,
})

export const asset = z.object({
  schemaVersion: z.number(),
  id: z.string(),
  projectId: z.string(),
  number: z.number(),
  kind: assetKind,
  name: z.string(),
  aliases: z.array(z.string()),
  appearance: z.string().optional(),
  styling: z.string().optional(),
  description: z.string().optional(),
  sheet: mediaSlot,
  sheetLayout: z.enum(['multi_view', 'per_angle']).optional(),
  sheetViews: z.object({ side: mediaSlot.optional(), back: mediaSlot.optional() }).optional(),
  originals: z.array(fileRef),
  voiceRef: fileRef.optional(),
  /** 角色的声线文字描述（只有角色有；创作备注，不参与生成依据）。 */
  voiceDescription: z.string().optional(),
  variants: z.array(assetVariant),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
})
export type Asset = z.infer<typeof asset>

export const matchBasis = z.object({
  type: z.enum(['exact_name', 'alias', 'name_contains', 'llm']),
  candidateText: z.string().optional(),
  assetText: z.string().optional(),
  note: z.string().optional(),
})

export const candidate = z.object({
  schemaVersion: z.number(),
  id: z.string(),
  projectId: z.string(),
  kind: assetKind,
  name: z.string(),
  aliases: z.array(z.string()),
  confidence: z.number().optional(),
  /** 服务端换算的高 / 中 / 低三档（阈值在 core 的 CONFIDENCE_THRESHOLDS）。 */
  confidenceBand: z.enum(['high', 'medium', 'low']),
  appearance: z.string().optional(),
  evidence: z.string().optional(),
  shotIds: z.array(z.string()),
  variants: z.array(
    z.object({
      variantKey: z.string(),
      description: z.string(),
      affectedShotIds: z.array(z.string()),
    }),
  ),
  status: z.enum(['pending', 'accepted_new', 'linked', 'ignored']),
  suggestedMatch: z
    .object({ assetId: z.string(), score: z.number(), basis: z.array(matchBasis) })
    .optional(),
  linkedAssetId: z.string().optional(),
  linkSource: z.enum(['auto', 'manual']).optional(),
  createdAssetId: z.string().optional(),
  handledAt: z.number().optional(),
  extractedAt: z.number(),
  createdAt: z.number(),
})
export type Candidate = z.infer<typeof candidate>

export const chapter = z.object({
  index: z.number(),
  title: z.string(),
  startOffset: z.number(),
  endOffset: z.number(),
  startLine: z.number(),
  endLine: z.number(),
  charCount: z.number(),
})

/** 素材（列表里不带全文；全文走 `materials.text`）。 */
export const material = z.object({
  schemaVersion: z.number(),
  id: z.string(),
  projectId: z.string(),
  number: z.number(),
  kind: z.enum(['doc', 'txt', 'md', 'image']),
  name: z.string(),
  charCount: z.number(),
  chapters: z.array(chapter),
  file: fileRef.optional(),
  size: z.object({ width: z.number(), height: z.number() }).optional(),
  createdAt: z.number(),
})
export type Material = z.infer<typeof material>

// === 任务 ===

export const jobType = z.enum(['text', 'image', 'video', 'audio', 'render'])
export const jobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export const jobError = z.object({
  category: z.enum([
    'generation_failed',
    'delivery_failed',
    'submission_unknown',
    'recovery_failed',
    'invalid_input',
    'internal',
  ]),
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
})

export const job = z.object({
  schemaVersion: z.number(),
  id: z.string(),
  type: jobType,
  operation: z.string(),
  projectId: z.string(),
  shotId: z.string().optional(),
  assetId: z.string().optional(),
  episodeId: z.string().optional(),
  batchId: z.string().optional(),
  dedupeKey: z.string().optional(),
  exclusiveKey: z.string().optional(),
  providerLabel: z.string().optional(),
  providerSnapshot: providerSnapshot.optional(),
  params: z.record(z.string(), z.unknown()),
  paid: z.boolean(),
  status: jobStatus,
  stage: z
    .enum(['submitting', 'polling', 'transferring', 'downloading', 'processing', 'completed'])
    .optional(),
  progress: z.number().optional(),
  attempt: z.number(),
  providerJobId: z.string().optional(),
  resultUrl: z.string().optional(),
  previousProviderJobIds: z.array(z.string()),
  result: z.record(z.string(), z.unknown()).optional(),
  resumeFrom: z.enum(['poll', 'download']).optional(),
  error: jobError.optional(),
  acknowledgedAt: z.number().optional(),
  /** 运行中的付费任务被标记“忽略结果”：照常跑完、产物进版本历史，但不自动成为当前版本。 */
  ignoreResult: z.boolean().optional(),
  ignoredAt: z.number().optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  updatedAt: z.number(),
})
export type Job = z.infer<typeof job>

/**
 * 任务作用在什么上（结构化，文案由前端按语言拼；名称是用户自己填的，原样返回）。
 * 目标已被删除时是 `removed`（任务历史还在，但对象没了）。
 */
export const jobTarget = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('shot'),
    shotId: z.string(),
    /** 在这一集里是第几个镜头（播出顺序，从 1 起）。 */
    shotIndex: z.number(),
    /** 项目内的镜头编号（单调发号，删除后不复用）。 */
    shotNumber: z.number(),
    shotTitle: z.string().optional(),
    sceneId: z.string(),
    episodeId: z.string(),
    episodeNumber: z.number(),
    episodeTitle: z.string(),
  }),
  z.object({
    kind: z.literal('asset'),
    assetId: z.string(),
    assetKind: assetKind,
    name: z.string(),
    /** 衍生形态的设定图 / 编辑任务：形态名。 */
    variantName: z.string().optional(),
    /** 是“用一句话修改现有设定图”的任务（不是重新生成）。 */
    edit: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('episode'),
    episodeId: z.string(),
    episodeNumber: z.number(),
    episodeTitle: z.string(),
  }),
  z.object({ kind: z.literal('project') }),
  z.object({
    kind: z.literal('removed'),
    entity: z.enum(['shot', 'asset', 'episode']),
    id: z.string(),
  }),
])
export type JobTarget = z.infer<typeof jobTarget>

/** 列表里的任务：带排队位置、目标、“需处理”标记（失败且未知悉），以及“结果被忽略”的实际状态。 */
export const jobListItem = job.extend({
  queuePosition: z.number().optional(),
  needsAttention: z.boolean(),
  target: jobTarget,
  /** 结果被忽略：运行中 = 已标记，会在结束时生效；结束后 = 实际没有成为当前版本（`result.ignored`）。 */
  resultIgnored: z.boolean(),
})
export type JobListItem = z.infer<typeof jobListItem>

// === 进度 / 产物 ===

const stepCount = z.object({ total: z.number(), done: z.number(), stale: z.number().optional() })
export const episodeProgress = z.object({
  episodeId: z.string(),
  split: z.object({ scenes: z.number(), shots: z.number(), shotsReady: z.number() }),
  candidates: z.object({
    total: z.number(),
    pending: z.number(),
    accepted_new: z.number(),
    linked: z.number(),
    ignored: z.number(),
    handled: z.number(),
  }),
  sheets: stepCount,
  images: stepCount,
  videos: stepCount,
  composition: z.object({ done: z.boolean(), stale: z.boolean().optional() }),
})
export type EpisodeProgress = z.infer<typeof episodeProgress>

export const artifactStatus = z.enum(['current', 'stale', 'missing', 'blocked'])
export const staleChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('input'), field: z.string() }),
  z.object({
    kind: z.literal('upstream'),
    key: z.string(),
    label: z.string().optional(),
    from: z.object({ versionId: z.string().optional(), contentHash: z.string() }).nullable(),
    to: z.object({ versionId: z.string().optional(), contentHash: z.string() }).nullable(),
  }),
])
export const artifactReport = z.object({
  key: z.string(),
  kind: z.enum([
    'asset_sheet',
    'variant_sheet',
    'shot_image',
    'shot_video',
    'shot_audio',
    'subtitles',
    'cut',
  ]),
  status: artifactStatus,
  reason: z
    .enum(['basis_changed', 'upstream_changed', 'no_record', 'upstream_missing', 'not_applicable'])
    .optional(),
  changes: z.array(staleChange),
  staleUpstream: z.array(z.string()),
  /** 产物文件（有记录时），用于下载 / 显示大小。 */
  file: fileRef.optional(),
  /**
   * 状态是 current，但是因为用户选了“保持现状”（时间）。界面可以标出“已按现状保留”；
   * 它的依据或上游再次变化时变回 stale，这个字段随之消失。
   */
  keptAt: z.number().optional(),
})
export type ArtifactReport = z.infer<typeof artifactReport>

export const projectListItem = project.extend({
  episodes: z.array(
    z.object({
      id: z.string(),
      number: z.number(),
      title: z.string(),
      status: episodeStatus,
      progress: episodeProgress,
    }),
  ),
  shotCounts: z.object({
    total: z.number(),
    withImage: z.number(),
    withVideo: z.number(),
    failed: z.number(),
  }),
  /** 前 6 个镜头的缩略图（当前图版本）。 */
  thumbnails: z.array(z.object({ shotId: z.string(), versionId: z.string(), path: z.string() })),
})
export type ProjectListItem = z.infer<typeof projectListItem>

// === 时间线 ===

const timelineClip = z.object({
  id: z.string(),
  shotId: z.string(),
  trim: z.object({ inUs: z.number(), outUs: z.number(), basisVersionId: z.string() }).optional(),
  sourceVolume: z.number(),
  holdUs: z.number(),
  carriesNarration: z.boolean(),
  reason: z.string().optional(),
  transitionToNext: z.object({ type: z.string(), durationUs: z.number() }).optional(),
})
const timelineBgm = z.object({
  id: z.string(),
  bgmId: z.string(),
  startUs: z.number(),
  inUs: z.number(),
  outUs: z.number(),
  volume: z.number(),
  fadeInUs: z.number(),
  fadeOutUs: z.number(),
})
export const timelineContent = z.object({ clips: z.array(timelineClip), bgm: z.array(timelineBgm) })
export type TimelineContent = z.infer<typeof timelineContent>

export const timelineRevision = z.object({
  number: z.number(),
  parent: z.number().optional(),
  author: z.object({
    kind: z.enum(['creator', 'agent', 'external']),
    userId: z.string().optional(),
  }),
  summary: z.string(),
  createdAt: z.number(),
  content: timelineContent,
  changedClipIds: z.array(z.string()).optional(),
  restoredFrom: z.number().optional(),
  /**
   * 系统追加的修订才有的原因码，界面据此显示本地化的说明（不要靠 `summary` 的中文文字，也不要靠 `author`）：
   * - `native_audio_default`：这个镜头第一次拿到生成的视频，模型无法关闭自带音频而镜头没有使用原生人声，
   *   所以这个片段的原声默认音量被设为 0（`changedClipIds` 是被改的片段）；
   * - `initial`：一集的第一份时间线；
   * - `sync_shots`：镜头新增 / 删除 / 重排后同步成当前的镜头顺序；
   * - `rollback`：回滚到旧修订（`restoredFrom` 是旧修订号）。
   * 用户自己的修改没有这个字段；这个字段加上之前创建的修订也没有，读取和显示照常。遇到不认识的值，退回显示 `summary`。
   */
  reason: z.enum(['native_audio_default', 'initial', 'sync_shots', 'rollback']).optional(),
})

export const timelineIssue = z.object({
  severity: z.enum(['blocking', 'warning', 'info']),
  code: z.string(),
  clipId: z.string().optional(),
  shotId: z.string().optional(),
  message: z.string(),
})

export const placement = z.object({
  totalUs: z.number(),
  clips: z.array(
    z.object({
      clipId: z.string(),
      shotId: z.string(),
      startUs: z.number(),
      endUs: z.number(),
      srcInUs: z.number(),
      srcOutUs: z.number(),
      holdUs: z.number(),
      sourceVolume: z.number(),
      videoVersionId: z.string().optional(),
      trimIgnored: z.boolean(),
      missingVideo: z.boolean(),
    }),
  ),
  narrations: z.array(
    z.object({
      clipId: z.string(),
      shotId: z.string(),
      startUs: z.number(),
      endUs: z.number(),
      fullDurationUs: z.number(),
      truncated: z.boolean(),
      versionId: z.string(),
    }),
  ),
  subtitles: z.array(
    z.object({
      shotId: z.string(),
      startUs: z.number(),
      endUs: z.number(),
      text: z.string(),
      source: z.enum(['narration', 'dialogue', 'narration_text']),
    }),
  ),
  bgm: z.array(
    z.object({
      clipId: z.string(),
      bgmId: z.string(),
      startUs: z.number(),
      endUs: z.number(),
      inUs: z.number(),
      outUs: z.number(),
      volume: z.number(),
      fadeInUs: z.number(),
      fadeOutUs: z.number(),
      truncated: z.boolean(),
    }),
  ),
  ignoredTransitions: z.array(z.string()),
})

export const timelineView = z.object({
  id: z.string(),
  episodeId: z.string(),
  name: z.string(),
  /** 最新修订号。 */
  head: z.number(),
  revisions: z.array(timelineRevision.omit({ content: true })),
  /** 要读取的修订（缺省为最新）。 */
  revision: timelineRevision,
  placement,
  issues: z.array(timelineIssue),
  hasBlockingIssues: z.boolean(),
})
export type TimelineView = z.infer<typeof timelineView>

// === 服务商 / 能力 / 价格 ===

export const providerKind = z.enum(['llm', 'image', 'video', 'tts'])
export const protocolId = z.enum([
  'openai-chat',
  'openai-images',
  'gemini-image',
  'aliyun-video',
  'volcengine-video',
  'kling-video',
  'generic-video',
  'ark-video',
  'kling-contents',
  'dashscope-video',
  'openai-tts',
  'minimax-t2a',
  'dashscope-cosyvoice',
  'openai-responses',
  'anthropic-messages',
  'gemini-chat',
  'volcengine-images',
  'dashscope-image',
  'siliconflow-images',
  'kling-image',
])
export const support = z.enum(['supported', 'unsupported', 'unverified'])

/** 账号登录通道（现在只有 OpenAI）。 */
export const loginChannelId = z.enum(['openai-chatgpt', 'openrouter'])
/** 服务商的鉴权方式；永远是推断后的结果（旧数据没有这个字段时：有 Key = api_key，否则 none）。 */
export const providerAuth = z.discriminatedUnion('type', [
  z.object({ type: z.literal('api_key') }),
  z.object({ type: z.literal('account_login'), channel: loginChannelId }),
  z.object({ type: z.literal('none') }),
])
/** 验证状态：已实测（带日期）或按官方文档接入、未实测（带出处）。 */
export const providerVerification = z.discriminatedUnion('status', [
  z.object({ status: z.literal('tested'), testedAt: z.string() }),
  z.object({ status: z.literal('documented'), source: z.string() }),
])
/**
 * 额外请求头（`providerDialect.extraHeaders`）里服务端自己管理、**悄悄忽略覆盖**的头名（小写，比较不分大小写）：
 * 鉴权头、内容类型头、传输层的头、`Cookie` 等。界面应直接引用这份名单做提示和校验，不要自己抄一份。
 * 服务端的实际名单在 `packages/core/src/util/merge.ts`，服务端的测试比较两份，改了一处不改另一处会红。
 * 个别协议另外必须设置的头（如百炼的 `X-DashScope-Async`）是协议自己声明的，不在这个全局名单里；
 * 用户填了它们也会被忽略。
 */
export const PROTECTED_REQUEST_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'x-goog-api-key',
  'x-key',
  'api-key',
  'content-type',
  'content-length',
  'transfer-encoding',
  'connection',
  'host',
  'anthropic-version',
] as const

/** 方言差异：额外请求体、输出长度字段名、JSON 模式（文本服务商）。预设预填，用户可以看、可以改。 */
export const providerDialect = z.object({
  extraBody: z.record(z.string(), z.unknown()).optional(),
  maxTokensField: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
  jsonMode: z.enum(['json_object', 'prompt_only']).optional(),
  /** 额外请求头（如 Anthropic 的 anthropic-workspace-id）；不能覆盖鉴权头和内容类型头。 */
  extraHeaders: z.record(z.string(), z.string()).optional(),
  /** 生图请求写法：auto（按模型名，认得 `openai/gpt-image-1` 这类带前缀的名字）/ openai 官方 / compat 兼容 / minimax。 */
  imageStyle: z.enum(['auto', 'openai', 'compat', 'minimax']).optional(),
})
export type ProviderDialectDto = z.infer<typeof providerDialect>

export const loginErrorCode = z.enum([
  'user_denied',
  'authorization_error',
  'state_mismatch',
  'no_code',
  'registration_incomplete',
  'client_mismatch',
  'invalid_grant',
  'exchange_failed',
  'bad_signature',
  'issuer_mismatch',
  'audience_mismatch',
  'expired',
  'nonce_mismatch',
  'bad_id_token',
  'account_mismatch',
  'timeout',
  'cancelled',
  'refresh_rejected',
])
/**
 * 账号登录的状态。**没有任何令牌**：只有登录与否、账号的显示标识（邮箱）、到期时间。
 * - `signed_out`：没登录（`account` 在时表示之前登录过的账号，可以重新登录）；
 * - `pending`：正在等浏览器里的授权；
 * - `signed_in`：已登录（`planUsage: false` = 登录了但没有授予使用 ChatGPT 用量的范围，不能调用）；
 * - `needs_relogin`：刷新令牌已失效，需要重新登录。
 */
export const loginStatus = z.object({
  channel: loginChannelId,
  state: z.enum(['signed_out', 'pending', 'signed_in', 'needs_relogin']),
  account: z.object({ label: z.string() }).optional(),
  expiresAt: z.string().optional(),
  planUsage: z.boolean().optional(),
  /** 登录换回的凭据：`access_token`（会刷新）或 `api_key`（登录得到的一把用户自己的 Key，不刷新）。`mask` 是掩码。 */
  credential: z
    .object({ kind: z.enum(['access_token', 'api_key']), mask: z.string().optional() })
    .optional(),
  /** 在厂商那里管理 / 作废这份授权的页面（OpenRouter 没有撤销接口，用户靠它）。 */
  manageUrl: z.string().optional(),
  pending: z.object({ expiresAt: z.string() }).optional(),
  lastError: z.object({ code: loginErrorCode, message: z.string(), at: z.string() }).optional(),
  /** 当前的访问方式下能不能发起登录（回调只到得了服务所在机器的 127.0.0.1）。 */
  availability: z.object({
    available: z.boolean(),
    reason: z.enum(['remote_access']).optional(),
    message: z.string().optional(),
  }),
})
export type LoginStatusDto = z.infer<typeof loginStatus>

const claim = <T extends z.ZodType>(v: T) =>
  z.object({ support, value: v.optional(), note: z.string().optional() })
export const modelCapability = z.object({
  media: z.enum(['image', 'video', 'audio']),
  verifiedAt: z.string().optional(),
  modes: z.record(z.string(), support),
  refImages: claim(z.number()),
  refVideos: claim(z.number()),
  refAudios: claim(z.number()),
  refAudioMaxTotalSec: z.number().optional(),
  firstFrame: support,
  lastFrame: support,
  nativeAudio: support,
  durations: claim(
    z.object({
      values: z.array(z.number()).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    }),
  ),
  resolutions: claim(z.array(z.string())),
  aspectRatios: claim(z.array(aspectRatio)),
  aspectFromSource: z.boolean().optional(),
  maxPromptChars: z.number().optional(),
  sizeStep: z.number().optional(),
  maxLongSide: z.number().optional(),
  maxPixels: z.number().optional(),
  minPixels: z.number().optional(),
  firstFrameWithRefs: support.optional(),
  audioToggle: support.optional(),
  refVideoMaxTotalSec: z.number().optional(),
  /** 语音：预置音色清单（`supported` = 封闭清单，`unverified` = 只列了一部分，可以手填别的）。 */
  voices: claim(
    z.array(
      z.object({ id: z.string(), label: z.string().optional(), lang: z.string().optional() }),
    ),
  ).optional(),
  /** 语音：项目没设置旁白音色时用的默认音色；没有 = 必须先设置音色。 */
  defaultVoice: z.string().optional(),
})

export const priceEntry = z.object({
  currency: z.string(),
  unit: z.enum(['per_image', 'per_second', 'per_call', 'per_1k_chars']),
  amount: z.number(),
  dimensions: z.record(z.string(), z.string()).optional(),
  range: z.tuple([z.number(), z.number()]).optional(),
  note: z.string().optional(),
})

/** 服务商配置（**永远不含 Key 明文**；`keyMask` 只给掩码）。 */
export const providerConfig = z.object({
  id: z.string(),
  label: z.string(),
  kind: providerKind,
  protocol: protocolId,
  baseUrl: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  auth: providerAuth,
  dialect: providerDialect.optional(),
  presetId: z.string().optional(),
  notes: z.string().optional(),
  verifiedAt: z.string().optional(),
  verification: providerVerification.optional(),
  knownLimitations: z.array(z.string()).optional(),
  acceptedUnverified: z.array(z.string()).optional(),
  capabilityOverrides: z.record(z.string(), z.unknown()).optional(),
  /** 只对 `api_key` 有意义；账号登录永远是 false（令牌不是 Key）。 */
  hasKey: z.boolean(),
  keyMask: z.string().optional(),
  /** 账号登录的服务商才有：登录状态（没有令牌）。 */
  login: loginStatus.optional(),
})
export type ProviderConfigDto = z.infer<typeof providerConfig>

/** `GET /providers/:id/models`：这个服务商当前能用的模型。 */
export const providerModel = z.object({ id: z.string(), label: z.string() })

export const providerCapabilityView = z.object({
  /** 模型画像是否存在；false = 用户自填型号，能力是保守默认。 */
  declared: z.boolean(),
  capability: modelCapability,
  pricing: z.array(priceEntry),
  quirks: z.array(z.string()),
  provenance: z.string().optional(),
})

export const testConnectionResult = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('ok'),
    modelCount: z.number().optional(),
    detectedModels: z.array(z.string()).optional(),
    modelListed: z.boolean().optional(),
  }),
  z.object({
    outcome: z.literal('failed'),
    /** 给人看的说明（原样保留，向后兼容）。 */
    error: z.string(),
    status: z.number().optional(),
    /**
     * 机器可读的错误码，和任务失败时的 `error.code` 是同一套：`HTTP_401` / `HTTP_429`、`TIMEOUT`、`NETWORK`、
     * `LOGIN_REQUIRED`、`UNREADABLE_RESPONSE`，以及上游错误体里的稳定码（Anthropic 的 `authentication_error` /
     * `overloaded_error`，Gemini 的 `PERMISSION_DENIED` 等）。前端按它显示和任务失败时同样的解释与下一步。
     */
    code: z.string().optional(),
  }),
  z.object({ outcome: z.literal('unverifiable'), reason: z.string() }),
])

export const providerPreset = z.object({
  id: z.string(),
  label: z.string(),
  kind: providerKind,
  protocol: protocolId,
  baseUrl: z.string(),
  /** 地址里要用户自己替换的 `{占位符}` 名，如 `WorkspaceId`。 */
  baseUrlPlaceholders: z.array(z.string()).optional(),
  suggestedModel: z.string(),
  auth: providerAuth,
  dialect: providerDialect.optional(),
  /** 厂商（设置页按厂商分组）；`label` 已按请求的语言翻译。 */
  vendor: z.object({ id: z.string(), label: z.string() }),
  /** `cn` 国内站 / `global` 国际站 / `local` 本机服务。 */
  region: z.enum(['cn', 'global', 'local']).optional(),
  notes: z.string(),
  /** 已实测（带日期）或按官方文档接入、未实测（带出处）。未实测的不会自动成为当前选择。 */
  verification: providerVerification,
  /** 只有已实测的预设才有。 */
  verifiedAt: z.string().optional(),
  knownLimitations: z.array(z.string()),
})

export const appSettings = z.object({
  /** 各类服务当前使用的服务商配置 id。 */
  activeProviders: z.object({
    llm: z.string().optional(),
    image: z.string().optional(),
    video: z.string().optional(),
    tts: z.string().optional(),
  }),
  /** 费用折算：用户可改，默认不折算。 */
  cost: z.object({
    conversion: z
      .object({ targetCurrency: z.string(), rates: z.record(z.string(), z.number()) })
      .optional(),
  }),
  locale: z.string().optional(),
  /** 成片字幕默认方式。 */
  defaultSubtitles: z.enum(['soft', 'burn', 'none']).optional(),
})
export type AppSettings = z.infer<typeof appSettings>

export const ffmpegInfo = z.object({
  found: z.boolean(),
  path: z.string().optional(),
  source: z.enum(['option', 'env', 'path']).optional(),
  version: z.string().optional(),
  videoEncoder: z.string().optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  missing: z.array(
    z.object({
      feature: z.string(),
      required: z.boolean(),
      reason: z.string(),
      remedy: z.string(),
    }),
  ),
  ok: z.boolean(),
  error: z.string().optional(),
})

export const systemInfo = z.object({
  version: z.string(),
  dataDir: z.string(),
  platform: z.string(),
  node: z.string(),
  desktop: z.boolean(),
  startedAt: z.number(),
  /** SSE 的纪元：变了就说明服务重启过，前端要整体刷新。 */
  epoch: z.string(),
  ffmpeg: ffmpegInfo,
  auth: z.object({ tokenRequired: z.boolean() }),
  /**
   * 演示模式：服务商指向本地模拟服务，不产生任何费用、生成的是占位内容。
   * 前端据此显示持续可见的提示（notice 是服务端给出的说明文字）。
   */
  demo: z.object({ active: z.boolean(), notice: z.string().optional() }),
})
export type SystemInfo = z.infer<typeof systemInfo>

export const stylePreset = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  imageKeywords: z.string(),
})
export const styleGroup = z.object({
  id: z.string(),
  label: z.string(),
  presets: z.array(stylePreset),
})

// === 准入 / 预检 ===

export const targetSpec = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('asset_sheet'),
    assetId: z.string(),
    variantName: z.string().optional(),
    /**
     * 有它 = 用一句话修改现有设定图（本体，或 `variantName` 指定的形态）：以当前图为唯一参考、
     * 这句增量指令为唯一提示词；新图成为当前版本，旧图留在版本历史；失败时什么都不改。
     * 和普通生成走同样的准入 / 预检：没有当前图（`SHEET_TO_EDIT_MISSING`）、没写指令（`EDIT_INSTRUCTION_EMPTY`）、
     * 模型没有图生图能力（能力检查的拒绝原因）都在入队前就被拦下。
     */
    editInstruction: z.string().min(1).max(1000).optional(),
  }),
  z.object({ kind: z.literal('shot_image'), shotId: z.string() }),
  z.object({ kind: z.literal('shot_video'), shotId: z.string() }),
  z.object({ kind: z.literal('shot_audio'), shotId: z.string() }),
])
export type TargetSpec = z.infer<typeof targetSpec>

export const generateItem = z.object({
  target: targetSpec,
  /** 服务商配置 id；缺省用应用设置里该类服务当前选中的那个。 */
  providerId: z.string().optional(),
  resolution: z.string().optional(),
  /**
   * 视频：开启参考图（默认关）——把镜头的角色 / 场景 / 道具设定图作为参考素材一起交给视频模型。
   * 对首帧与参考图互斥的模型（Seedance、万相 3.0），镜头图会降为第 1 张参考图，**放弃严格首帧**：
   * 预检结果的 `video` 字段说明会发生什么（`ifRefsOn` / `frame`），界面应在开关旁让用户知道。
   */
  videoRefs: z.boolean().optional(),
  sheetLayout: z.enum(['multi_view', 'per_angle', 'single']).optional(),
  /** 用户确认“上次失败且带上游任务号，仍要重新生成（可能再次计费）”。 */
  confirmResubmit: z.boolean().optional(),
  confirmUnverified: z.boolean().optional(),
})
export type GenerateItem = z.infer<typeof generateItem>

export const reason = z.object({
  code: z.string(),
  message: z.string(),
  assetId: z.string().optional(),
})
export const costEstimate = z.discriminatedUnion('priced', [
  z.object({
    priced: z.literal(true),
    currency: z.string(),
    amount: z.number(),
    range: z.tuple([z.number(), z.number()]).optional(),
    approx: z.boolean(),
  }),
  z.object({ priced: z.literal(false), reason: z.string() }),
])
/** 视频目标的参考图计划（只有 shot_video 有）：怎么处理镜头图、开启参考图会怎样。 */
export const videoPlan = z.object({
  mode: z.enum(['t2v', 'i2v', 'first_last', 'omni_ref']),
  refsRequested: z.boolean(),
  /** 这次实际怎么处理镜头图：严格首帧 / 降为第 1 张参考图（放弃严格首帧）/ 首帧和参考图同发。 */
  frame: z.enum(['strict_first_frame', 'as_reference', 'with_references']),
  /** 没开参考图时也给出"如果开启会怎样"，界面在开关旁边说明。 */
  ifRefsOn: z.enum(['frame_as_reference', 'frame_with_references', 'not_available']),
  referenceCount: z.number(),
  droppedReferences: z.number(),
  firstFrameWithRefs: support,
  refImages: support,
  /**
   * 开启参考图（且没被拦下）时才有：实际会带上的参考图，按发出的顺序，与生成后版本上的
   * `usedReferences.references` 逐项相同（同一个函数算出）。镜头图降为参考图时它是第 1 项（角色 `start_frame`）。
   * 没开参考图时这三个字段不出现。
   */
  references: z.array(usedReferenceItem).optional(),
  /** 因超过模型的参考图上限被舍弃的参考图（说话的人物优先保留）。 */
  dropped: z
    .array(
      z.object({
        role: referenceRole,
        assetId: z.string().optional(),
        assetName: z.string().optional(),
        variantName: z.string().optional(),
        reason: z.enum(['over_limit']),
      }),
    )
    .optional(),
  /** 镜头图的用法：严格首帧（与参考图同发），或第 1 张参考图。 */
  startFrame: z
    .object({
      use: z.enum(['first_frame', 'reference']),
      versionId: z.string().optional(),
      sha256: z.string().optional(),
    })
    .optional(),
})
export type VideoPlan = z.infer<typeof videoPlan>

export const verdict = z.object({
  targetId: z.string(),
  status: z.enum(['accepted', 'blocked', 'needs_confirmation', 'blocked_by_batch']),
  reasons: z.array(reason),
  warnings: z.array(reason),
  unverified: z.array(
    z.object({ key: z.string(), code: z.string(), message: z.string(), confirmed: z.boolean() }),
  ),
  blockedBy: z.array(z.string()).optional(),
  estimate: costEstimate.optional(),
  video: videoPlan.optional(),
})
export type Verdict = z.infer<typeof verdict>

const currencyTotal = z.object({
  amount: z.number(),
  range: z.tuple([z.number(), z.number()]).optional(),
  approx: z.boolean(),
})
export const costSummary = z.object({
  byCurrency: z.record(z.string(), currencyTotal),
  unpriced: z.number(),
  /** 用户设置了折算时才有；永远只是估算。 */
  converted: z
    .object({
      currency: z.string(),
      amount: z.number(),
      range: z.tuple([z.number(), z.number()]).optional(),
      approx: z.boolean(),
    })
    .optional(),
  /** 没有折算的币种（分开统计）。 */
  remaining: z.record(z.string(), currencyTotal),
  isEstimate: z.literal(true),
})

export const preflightResult = z.object({
  ok: z.boolean(),
  results: z.array(verdict),
  totals: costSummary,
})
export type PreflightResult = z.infer<typeof preflightResult>

export const generateResult = z.object({
  requested: z.array(z.string()),
  succeeded: z.array(z.object({ targetId: z.string(), jobId: z.string(), deduped: z.boolean() })),
  failed: z.array(z.object({ targetId: z.string(), reason })),
  blocked: z.array(
    z.object({
      targetId: z.string(),
      reasons: z.array(reason),
      blockedBy: z.array(z.string()).optional(),
    }),
  ),
  admission: preflightResult,
})
export type GenerateResult = z.infer<typeof generateResult>

export const episodePreflightPlan = z.object({
  assetSheets: z.string().optional(),
  shotImages: z.string().optional(),
  shotVideos: z.string().optional(),
  narration: z.string().optional(),
  textModel: z.string().optional(),
  resolution: z.string().optional(),
  /** 视频：开启参考图（默认关），含义见 `generateItem.videoRefs`。 */
  videoRefs: z.boolean().optional(),
  onlyMissing: z.boolean().optional(),
  sheetLayout: z.enum(['multi_view', 'per_angle', 'single']).optional(),
  confirmUnverified: z.boolean().optional(),
})
export const episodePreflightResult = preflightResult.extend({
  targets: z.array(z.object({ targetId: z.string(), target: targetSpec, providerId: z.string() })),
  textSteps: z.array(
    z.object({ step: z.string(), calls: z.number(), chars: z.number(), estimate: costEstimate }),
  ),
})

// === 导入 ===

export const legacyImportSummary = z.object({
  projects: z.array(
    z.object({
      legacyId: z.string(),
      projectId: z.string(),
      name: z.string(),
      episodes: z.number(),
      shots: z.number(),
      assets: z.number(),
      materials: z.number(),
      images: z.number(),
      videos: z.number(),
      artifactsRegistered: z.number(),
      artifactsSkipped: z.number(),
    }),
  ),
  skipped: z.array(z.object({ legacyId: z.string(), reason: z.string() })),
  droppedGenerations: z.number(),
  droppedPendingVideoTasks: z.number(),
})

export const apiErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
})
export type ApiErrorBody = z.infer<typeof apiErrorBody>
