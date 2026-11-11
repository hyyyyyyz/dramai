import { z } from 'zod'
import * as S from './schemas.ts'

/**
 * 路由契约：每条路由的方法、路径、查询 / 请求体 / 响应的 schema。服务端按它校验请求，客户端按它调用。
 * 路径里的 `:name` 是路径参数（客户端自动编码）。上传用 multipart（`body: 'multipart'`），
 * 文件下载 / 导出不是 JSON，见 `fileRoutes`。
 */

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RouteDef<
  P extends string = string,
  Q extends z.ZodType | undefined = z.ZodType | undefined,
  B extends z.ZodType | 'multipart' | undefined = z.ZodType | 'multipart' | undefined,
  R extends z.ZodType = z.ZodType,
> {
  method: Method
  path: P
  query: Q
  body: B
  response: R
}

function route<
  P extends string,
  R extends z.ZodType,
  Q extends z.ZodType | undefined = undefined,
  B extends z.ZodType | 'multipart' | undefined = undefined,
>(method: Method, path: P, spec: { response: R; query?: Q; body?: B }): RouteDef<P, Q, B, R> {
  return { method, path, response: spec.response, query: spec.query as Q, body: spec.body as B }
}

const ok = z.object({ ok: z.literal(true) })
const items = <T extends z.ZodType>(t: T) => z.object({ items: z.array(t) })
const jobOut = z.object({ job: S.job, deduped: z.boolean() })

// === 请求体 ===

export const styleChoice = z.discriminatedUnion('source', [
  z.object({ source: z.literal('none') }),
  z.object({ source: z.literal('template'), templateId: z.string() }),
  z.object({
    source: z.literal('custom'),
    description: z.string().min(1),
    imageKeywords: z.string().optional(),
  }),
  /**
   * 参考图风格：先用 `projects.setStyleReference` 上传图片。这里只用于“已经上传过”的项目更新名称（label）；
   * 创建项目时不能直接选（还没有图）——先创建，再上传。
   */
  z.object({ source: z.literal('reference_image'), label: z.string().min(1).max(40).optional() }),
])
export type StyleChoice = z.infer<typeof styleChoice>

const narrationVoice = z.object({
  providerConfigId: z.string(),
  voice: z.string(),
  speed: z.number().positive().optional(),
})

export const projectCreate = z.object({
  name: z.string().min(1).max(120),
  summary: z.string().max(2000).optional(),
  aspectRatio: S.aspectRatio,
  style: styleChoice.optional(),
  narrationDelivery: S.narrationDelivery.optional(),
  narrationVoice: narrationVoice.optional(),
})
export const projectUpdate = z.object({
  name: z.string().min(1).max(120).optional(),
  summary: z.string().max(2000).nullable().optional(),
  aspectRatio: S.aspectRatio.optional(),
  style: styleChoice.optional(),
  narrationDelivery: S.narrationDelivery.optional(),
  narrationVoice: narrationVoice.nullable().optional(),
})

const providerWritable = z.object({
  label: z.string().min(1).max(120),
  kind: S.providerKind,
  protocol: S.protocolId,
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  enabled: z.boolean().optional(),
  notes: z.string().optional(),
  capabilityOverrides: z.record(z.string(), z.unknown()).optional(),
})
export const providerCreate = providerWritable.extend({ apiKey: z.string().min(1).optional() })
export const providerUpdate = providerWritable.partial()

export const shotUpdate = z.object({
  title: z.string().optional(),
  scriptExcerpt: z.string().optional(),
  cameraShot: S.cameraShot.nullable().optional(),
  angle: S.cameraAngle.nullable().optional(),
  movement: S.cameraMovement.optional(),
  durationSec: z.number().min(1).max(60).optional(),
  aspectOverride: S.aspectRatio.nullable().optional(),
  moodTags: z.array(z.string()).optional(),
  atmosphere: z.string().nullable().optional(),
  dialogue: z.array(S.dialogueLine).optional(),
  narration: z.string().nullable().optional(),
  actionBeats: z.array(z.string()).optional(),
  prompts: z
    .object({
      firstFrame: z.string().nullable().optional(),
      keyFrame: z.string().nullable().optional(),
      lastFrame: z.string().nullable().optional(),
      video: z.string().nullable().optional(),
    })
    .optional(),
})

export const assetCreate = z.object({
  kind: S.assetKind,
  name: z.string().min(1).max(60),
  aliases: z.array(z.string()).optional(),
  appearance: z.string().optional(),
  styling: z.string().optional(),
  description: z.string().optional(),
})
export const assetUpdate = z.object({
  name: z.string().min(1).max(60).optional(),
  aliases: z.array(z.string()).optional(),
  appearance: z.string().nullable().optional(),
  styling: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
})
export const variantWrite = z.object({
  name: z.string().min(1).max(40),
  description: z.string(),
  costumeAssetId: z.string().nullable().optional(),
  editInstruction: z.string().optional(),
})

const confirmOptions = z.object({ createVariants: z.array(z.string()).optional() })
export const candidateAccept = confirmOptions.extend({ name: z.string().min(1).optional() })
export const candidateLink = confirmOptions.extend({ assetId: z.string() })
export const candidateUndo = z.object({
  then: z
    .discriminatedUnion('action', [
      z.object({
        action: z.literal('accept_new'),
        name: z.string().optional(),
        createVariants: z.array(z.string()).optional(),
      }),
      z.object({
        action: z.literal('link'),
        assetId: z.string(),
        createVariants: z.array(z.string()).optional(),
      }),
      z.object({ action: z.literal('ignore') }),
    ])
    .optional(),
})

const episodeWithProgress = S.episode.extend({ progress: S.episodeProgress })

// === 路由表 ===

export const routes = {
  // 系统与设置
  'system.get': route('GET', '/api/system', { response: S.systemInfo }),
  'settings.get': route('GET', '/api/settings', { response: S.appSettings }),
  'settings.update': route('PUT', '/api/settings', {
    body: S.appSettings,
    response: S.appSettings,
  }),
  'styles.list': route('GET', '/api/styles', {
    response: z.object({ groups: z.array(S.styleGroup) }),
  }),
  'presets.list': route('GET', '/api/presets', { response: items(S.providerPreset) }),

  // 服务商
  'providers.list': route('GET', '/api/providers', { response: items(S.providerConfig) }),
  'providers.create': route('POST', '/api/providers', {
    body: providerCreate,
    response: S.providerConfig,
  }),
  'providers.fromPreset': route('POST', '/api/providers/from-preset', {
    body: z.object({
      presetId: z.string(),
      apiKey: z.string().min(1).optional(),
      label: z.string().optional(),
    }),
    response: S.providerConfig,
  }),
  'providers.get': route('GET', '/api/providers/:providerId', { response: S.providerConfig }),
  'providers.update': route('PATCH', '/api/providers/:providerId', {
    body: providerUpdate,
    response: S.providerConfig,
  }),
  'providers.delete': route('DELETE', '/api/providers/:providerId', { response: ok }),
  'providers.setKey': route('PUT', '/api/providers/:providerId/key', {
    body: z.object({ apiKey: z.string().min(1) }),
    response: S.providerConfig,
  }),
  'providers.clearKey': route('DELETE', '/api/providers/:providerId/key', {
    response: S.providerConfig,
  }),
  'providers.test': route('POST', '/api/providers/:providerId/test', {
    response: S.testConnectionResult,
  }),
  'providers.capability': route('GET', '/api/providers/:providerId/capability', {
    response: S.providerCapabilityView,
  }),
  'providers.acceptUnverified': route('PUT', '/api/providers/:providerId/accepted-unverified', {
    body: z.object({ keys: z.array(z.string()) }),
    response: S.providerConfig,
  }),

  // 项目
  'projects.list': route('GET', '/api/projects', {
    query: z.object({ includeDeleted: z.coerce.boolean().optional() }),
    response: items(S.projectListItem),
  }),
  'projects.create': route('POST', '/api/projects', { body: projectCreate, response: S.project }),
  'projects.get': route('GET', '/api/projects/:projectId', { response: S.project }),
  'projects.update': route('PATCH', '/api/projects/:projectId', {
    body: projectUpdate,
    response: S.project,
  }),
  'projects.delete': route('DELETE', '/api/projects/:projectId', { response: ok }),
  'projects.restore': route('POST', '/api/projects/:projectId/restore', { response: S.project }),
  'projects.purge': route('DELETE', '/api/projects/:projectId/purge', { response: ok }),
  'projects.setStyleReference': route('POST', '/api/projects/:projectId/style-reference', {
    body: 'multipart',
    response: S.project,
  }),
  'projects.artifacts': route('GET', '/api/projects/:projectId/artifacts', {
    response: items(S.artifactReport),
  }),

  // 素材
  'materials.list': route('GET', '/api/projects/:projectId/materials', {
    response: items(S.material),
  }),
  'materials.upload': route('POST', '/api/projects/:projectId/materials', {
    body: 'multipart',
    response: z.object({
      material: S.material,
      summary: z.object({
        chapterCount: z.number(),
        charCount: z.number(),
        truncated: z.literal(false),
      }),
    }),
  }),
  'materials.text': route('GET', '/api/materials/:materialId/text', {
    response: z.object({ text: z.string() }),
  }),
  'materials.delete': route('DELETE', '/api/materials/:materialId', { response: ok }),

  // 集
  'episodes.list': route('GET', '/api/projects/:projectId/episodes', {
    response: items(episodeWithProgress),
  }),
  'episodes.create': route('POST', '/api/projects/:projectId/episodes', {
    body: z.object({
      title: z.string().max(60).optional(),
      summary: z.string().max(2000).optional(),
      /** 插在这一集之前；缺省加在最后。 */
      beforeEpisodeId: z.string().optional(),
    }),
    response: episodeWithProgress,
  }),
  'episodes.get': route('GET', '/api/episodes/:episodeId', {
    response: z.object({
      episode: S.episode,
      scenes: z.array(S.scene),
      shots: z.array(S.shot),
      refs: z.array(S.shotRef),
      progress: S.episodeProgress,
    }),
  }),
  'episodes.update': route('PATCH', '/api/episodes/:episodeId', {
    body: z.object({
      title: z.string().min(1).max(120).optional(),
      summary: z.string().nullable().optional(),
    }),
    response: S.episode,
  }),
  'episodes.delete': route('DELETE', '/api/episodes/:episodeId', { response: ok }),
  'episodes.reorder': route('PUT', '/api/projects/:projectId/episode-order', {
    body: z.object({ order: z.array(z.string()) }),
    response: S.project,
  }),
  'episodes.plan': route('POST', '/api/projects/:projectId/episodes/plan', {
    body: z.object({ targetChars: z.number().int().min(300).max(20000).optional() }),
    response: jobOut,
  }),
  'episodes.breakdown': route('POST', '/api/episodes/:episodeId/breakdown', {
    body: z.object({ mode: z.enum(['replace', 'append']).optional() }),
    response: jobOut,
  }),
  'episodes.extractEntities': route('POST', '/api/episodes/:episodeId/entities', {
    body: z.object({ autoLink: z.enum(['exact', 'none']).optional() }),
    response: jobOut,
  }),
  'episodes.generatePrompts': route('POST', '/api/episodes/:episodeId/shot-prompts', {
    body: z.object({ onlyMissing: z.boolean().optional() }),
    response: jobOut,
  }),
  'episodes.preflight': route('POST', '/api/episodes/:episodeId/preflight', {
    body: S.episodePreflightPlan,
    response: S.episodePreflightResult,
  }),
  'episodes.compose': route('POST', '/api/episodes/:episodeId/compose', {
    body: z.object({
      subtitles: z.enum(['soft', 'burn', 'none']).optional(),
      shortSide: z.number().int().min(120).max(2160).optional(),
    }),
    response: jobOut,
  }),
  'episodes.artifacts': route('GET', '/api/episodes/:episodeId/artifacts', {
    response: items(S.artifactReport),
  }),

  // 场
  'scenes.create': route('POST', '/api/episodes/:episodeId/scenes', {
    body: z.object({
      title: z.string().optional(),
      timeOfDay: z.string().optional(),
      blocking: z.string().optional(),
    }),
    response: S.scene,
  }),
  'scenes.update': route('PATCH', '/api/scenes/:sceneId', {
    body: z.object({
      title: z.string().nullable().optional(),
      timeOfDay: z.string().nullable().optional(),
      blocking: z.string().nullable().optional(),
      locationAssetId: z.string().nullable().optional(),
    }),
    response: S.scene,
  }),
  'scenes.delete': route('DELETE', '/api/scenes/:sceneId', { response: ok }),
  'scenes.reorder': route('PUT', '/api/episodes/:episodeId/scene-order', {
    body: z.object({ order: z.array(z.string()) }),
    response: S.episode,
  }),

  // 镜头
  'shots.create': route('POST', '/api/scenes/:sceneId/shots', {
    body: z.object({
      title: z.string().optional(),
      scriptExcerpt: z.string().optional(),
      durationSec: z.number().min(1).max(60).optional(),
      afterShotId: z.string().optional(),
    }),
    response: S.shot,
  }),
  'shots.get': route('GET', '/api/shots/:shotId', {
    response: z.object({ shot: S.shot, refs: z.array(S.shotRef) }),
  }),
  'shots.update': route('PATCH', '/api/shots/:shotId', { body: shotUpdate, response: S.shot }),
  'shots.delete': route('DELETE', '/api/shots/:shotId', { response: ok }),
  'shots.setRefs': route('PUT', '/api/shots/:shotId/refs', {
    body: z.object({
      refs: z.array(z.object({ assetId: z.string(), variantName: z.string().optional() })),
    }),
    response: z.object({ refs: z.array(S.shotRef) }),
  }),
  'shots.reorder': route('PUT', '/api/scenes/:sceneId/shot-order', {
    body: z.object({ order: z.array(z.string()) }),
    response: S.scene,
  }),
  'shots.move': route('POST', '/api/shots/:shotId/move', {
    body: z.object({ toSceneId: z.string(), index: z.number().int().min(0).optional() }),
    response: S.shot,
  }),
  'shots.setCurrentVersion': route('PUT', '/api/shots/:shotId/current-version', {
    body: z.object({ slot: z.enum(['image', 'video', 'audio']), versionId: z.string() }),
    response: S.shot,
  }),
  'shots.uploadImage': route('POST', '/api/shots/:shotId/image', {
    body: 'multipart',
    response: S.shot,
  }),

  // 资产
  'assets.list': route('GET', '/api/projects/:projectId/assets', { response: items(S.asset) }),
  'assets.create': route('POST', '/api/projects/:projectId/assets', {
    body: assetCreate,
    response: S.asset,
  }),
  'assets.get': route('GET', '/api/assets/:assetId', {
    response: z.object({ asset: S.asset, usedByShotIds: z.array(z.string()) }),
  }),
  'assets.update': route('PATCH', '/api/assets/:assetId', { body: assetUpdate, response: S.asset }),
  'assets.delete': route('DELETE', '/api/assets/:assetId', { response: ok }),
  'assets.uploadOriginal': route('POST', '/api/assets/:assetId/originals', {
    body: 'multipart',
    response: S.asset,
  }),
  'assets.uploadSheet': route('POST', '/api/assets/:assetId/sheet', {
    body: 'multipart',
    response: S.asset,
  }),
  'assets.setCurrentSheet': route('PUT', '/api/assets/:assetId/sheet/current', {
    body: z.object({ versionId: z.string(), variantName: z.string().optional() }),
    response: S.asset,
  }),
  'assets.uploadVoice': route('POST', '/api/assets/:assetId/voice', {
    body: 'multipart',
    response: S.asset,
  }),
  'variants.create': route('POST', '/api/assets/:assetId/variants', {
    body: variantWrite,
    response: S.asset,
  }),
  'variants.update': route('PATCH', '/api/assets/:assetId/variants/:variantName', {
    body: variantWrite.partial(),
    response: S.asset,
  }),
  'variants.delete': route('DELETE', '/api/assets/:assetId/variants/:variantName', {
    response: S.asset,
  }),

  // 候选
  'candidates.list': route('GET', '/api/projects/:projectId/candidates', {
    query: z.object({
      episodeId: z.string().optional(),
      status: z.enum(['pending', 'accepted_new', 'linked', 'ignored']).optional(),
    }),
    response: z.object({
      items: z.array(S.candidate),
      progress: z.object({
        total: z.number(),
        pending: z.number(),
        accepted_new: z.number(),
        linked: z.number(),
        ignored: z.number(),
        handled: z.number(),
      }),
    }),
  }),
  'candidates.accept': route('POST', '/api/candidates/:candidateId/accept', {
    body: candidateAccept,
    response: z.object({ candidate: S.candidate, asset: S.asset.optional() }),
  }),
  'candidates.link': route('POST', '/api/candidates/:candidateId/link', {
    body: candidateLink,
    response: z.object({ candidate: S.candidate, asset: S.asset.optional() }),
  }),
  'candidates.ignore': route('POST', '/api/candidates/:candidateId/ignore', {
    response: z.object({ candidate: S.candidate }),
  }),
  'candidates.undoLink': route('POST', '/api/candidates/:candidateId/undo-link', {
    body: candidateUndo,
    response: z.object({
      candidate: S.candidate,
      removedVariants: z.array(z.string()),
      keptVariants: z.array(z.string()),
      next: z.object({ candidate: S.candidate, asset: S.asset.optional() }).optional(),
    }),
  }),

  // 时间线
  'timeline.get': route('GET', '/api/episodes/:episodeId/timeline', {
    query: z.object({ revision: z.coerce.number().int().optional() }),
    response: S.timelineView,
  }),
  'timeline.update': route('PUT', '/api/episodes/:episodeId/timeline', {
    body: z.object({
      content: S.timelineContent,
      summary: z.string().min(1).max(200),
      baseRevision: z.number().int().optional(),
    }),
    response: S.timelineView,
  }),
  'timeline.rollback': route('POST', '/api/episodes/:episodeId/timeline/rollback', {
    body: z.object({ revision: z.number().int() }),
    response: S.timelineView,
  }),
  'timeline.sync': route('POST', '/api/episodes/:episodeId/timeline/sync', {
    response: S.timelineView,
  }),
  'timeline.uploadBgm': route('POST', '/api/episodes/:episodeId/timeline/bgm', {
    body: 'multipart',
    response: z.object({ bgmId: z.string(), bytes: z.number() }),
  }),

  // 生成（花钱）
  'generate.preflight': route('POST', '/api/projects/:projectId/preflight', {
    body: z.object({
      items: z.array(S.generateItem).min(1).max(500),
      confirmUnverified: z.boolean().optional(),
    }),
    response: S.preflightResult,
  }),
  'generate.submit': route('POST', '/api/projects/:projectId/generate', {
    body: z.object({
      items: z.array(S.generateItem).min(1).max(500),
      confirmUnverified: z.boolean().optional(),
    }),
    response: S.generateResult,
  }),

  // 任务
  'jobs.list': route('GET', '/api/jobs', {
    query: z.object({
      projectId: z.string().optional(),
      status: z.string().optional(),
      needsAttention: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
    response: items(S.jobListItem),
  }),
  'jobs.get': route('GET', '/api/jobs/:jobId', { response: S.jobListItem }),
  'jobs.cancel': route('POST', '/api/jobs/:jobId/cancel', { response: S.jobListItem }),
  'jobs.retry': route('POST', '/api/jobs/:jobId/retry', {
    body: z.object({ confirmRecharge: z.boolean().optional() }),
    response: S.jobListItem,
  }),
  'jobs.resume': route('POST', '/api/jobs/:jobId/resume', { response: S.jobListItem }),
  'jobs.acknowledge': route('POST', '/api/jobs/:jobId/acknowledge', { response: S.jobListItem }),
  'jobs.ignoreResult': route('POST', '/api/jobs/:jobId/ignore-result', {
    body: z.object({ ignore: z.boolean().optional() }),
    response: S.jobListItem,
  }),

  // 导入
  'import.legacy': route('POST', '/api/import/legacy', {
    body: 'multipart',
    response: S.legacyImportSummary,
  }),
} as const

export type Routes = typeof routes
export type RouteName = keyof Routes

/**
 * 文件类路由（非 JSON，不走 `client.call`）：用 `client.fileUrl()` / `client.exportUrl()` 拼地址，
 * 交给 <img> / <video> / <audio> / <a download>。图片、视频、音频支持 Range 分段请求。
 */
export const fileRoutes = {
  file: '/api/projects/:projectId/files/*',
  srt: '/api/episodes/:episodeId/export/srt',
  vtt: '/api/episodes/:episodeId/export/vtt',
  package: '/api/episodes/:episodeId/export/package',
  cut: '/api/episodes/:episodeId/export/cut',
  events: '/api/events',
} as const
