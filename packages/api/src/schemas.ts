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

export const mediaVersion = z.object({
  id: z.string(),
  kind: z.enum(['image', 'video', 'audio']),
  file: fileRef,
  source: z.enum(['generated', 'uploaded', 'image_edit']),
  createdAt: z.number(),
  jobId: z.string().optional(),
  prompt: z.string().optional(),
  provider: providerSnapshot.optional(),
  facts: mediaFacts.optional(),
  withNativeAudio: z.boolean().optional(),
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
    .object({ providerConfigId: z.string(), voice: z.string(), speed: z.number().optional() })
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
  'openai-tts',
])
export const support = z.enum(['supported', 'unsupported', 'unverified'])

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
  presetId: z.string().optional(),
  notes: z.string().optional(),
  verifiedAt: z.string().optional(),
  knownLimitations: z.array(z.string()).optional(),
  acceptedUnverified: z.array(z.string()).optional(),
  capabilityOverrides: z.record(z.string(), z.unknown()).optional(),
  hasKey: z.boolean(),
  keyMask: z.string().optional(),
})
export type ProviderConfigDto = z.infer<typeof providerConfig>

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
  z.object({ outcome: z.literal('failed'), error: z.string(), status: z.number().optional() }),
  z.object({ outcome: z.literal('unverifiable'), reason: z.string() }),
])

export const providerPreset = z.object({
  id: z.string(),
  label: z.string(),
  kind: providerKind,
  protocol: protocolId,
  baseUrl: z.string(),
  suggestedModel: z.string(),
  notes: z.string(),
  verifiedAt: z.string(),
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
