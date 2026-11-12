import type {
  ArtifactReport,
  CallOutput,
  JobListItem,
  Scene,
  Shot,
  ShotRef,
  Verdict,
} from '@dramai/api'

/**
 * 分镜页的数据整理：把一集的结构、产物清单、任务和只读预检，整理成镜头卡要显示的状态。
 * 全是纯函数，方便测试。
 */
export type EpisodeDetail = CallOutput<'episodes.get'>

export interface SceneGroup {
  scene: Scene
  /** 场号（从 1 起，按播出顺序）。 */
  index: number
  shots: { shot: Shot; /** 本集内的镜头序号（从 1 起）。 */ index: number }[]
  durationSec: number
}

/** 按场的顺序、场内镜头的顺序排好；序号是本集内的播出顺序。 */
export function groupScenes(
  detail: Pick<EpisodeDetail, 'episode' | 'scenes' | 'shots'>,
): SceneGroup[] {
  const sceneById = new Map(detail.scenes.map((s) => [s.id, s]))
  const shotById = new Map(detail.shots.map((s) => [s.id, s]))
  let n = 0
  const ordered = detail.episode.sceneOrder.flatMap((id) => {
    const s = sceneById.get(id)
    return s ? [s] : []
  })
  // 防御：场不在 sceneOrder 里也不能丢
  for (const s of detail.scenes) if (!ordered.includes(s)) ordered.push(s)
  return ordered.map((scene, i) => {
    const shots = scene.shotOrder.flatMap((id) => {
      const shot = shotById.get(id)
      return shot ? [shot] : []
    })
    for (const s of detail.shots) if (s.sceneId === scene.id && !shots.includes(s)) shots.push(s)
    return {
      scene,
      index: i + 1,
      shots: shots.map((shot) => ({ shot, index: ++n })),
      durationSec: shots.reduce((t, s) => t + s.durationSec, 0),
    }
  })
}

export type ShotPhase =
  | 'empty'
  | 'image_queued'
  | 'image_running'
  | 'image_ready'
  | 'video_queued'
  | 'video_running'
  | 'video_ready'

export interface ShotView {
  phase: ShotPhase
  hasImage: boolean
  hasVideo: boolean
  /** 下一步要做的：没有图就是出图，有图就是出视频。 */
  next: 'image' | 'video'
  /** 这个镜头最近一次失败的任务（用任务面板同一套操作处理）。 */
  failedJob?: JobListItem
  failedStage?: 'image' | 'video'
  /** 在途任务（排队或运行中）。 */
  inFlight?: JobListItem
  imageStale?: ArtifactReport
  videoStale?: ArtifactReport
  /** 下一步的只读预检结果里的“被拦下”（它本身的问题，不含被整批拦下）。 */
  blocked?: Verdict
}

const currentVersion = (slot: Shot['image']) =>
  slot.versions.find((v) => v.id === slot.currentVersionId)

export function currentImage(shot: Shot) {
  return currentVersion(shot.image)
}
export function currentVideo(shot: Shot) {
  return currentVersion(shot.video)
}

export const targetKey = (kind: 'shot_image' | 'shot_video', shotId: string) => `${kind}:${shotId}`

/**
 * 镜头现在是什么状态。阶段取自服务端写在镜头上的 stages（真相），失败 / 在途的任务从任务列表里找，
 * 过期取自产物清单，“不能生成”取自只读预检（点生成之前就知道）。
 */
export function deriveShotView(
  shot: Shot,
  ctx: {
    jobs: readonly JobListItem[]
    artifacts: ReadonlyMap<string, ArtifactReport>
    verdicts: ReadonlyMap<string, Verdict>
  },
): ShotView {
  const hasImage = Boolean(currentImage(shot))
  const hasVideo = Boolean(currentVideo(shot))
  const mine = ctx.jobs.filter((j) => j.shotId === shot.id)
  const inFlight = mine
    .filter(
      (j) =>
        (j.status === 'queued' || j.status === 'running') &&
        (j.operation === 'shot_image' || j.operation === 'shot_video'),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  const failedJob = mine
    .filter(
      (j) =>
        j.status === 'failed' && (j.operation === 'shot_image' || j.operation === 'shot_video'),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]

  let phase: ShotPhase
  if (shot.stages.video === 'running') phase = 'video_running'
  else if (shot.stages.video === 'queued') phase = 'video_queued'
  else if (hasVideo) phase = 'video_ready'
  else if (shot.stages.image === 'running') phase = 'image_running'
  else if (shot.stages.image === 'queued') phase = 'image_queued'
  else if (hasImage) phase = 'image_ready'
  else phase = 'empty'

  const next = hasImage ? 'video' : 'image'
  const verdict = ctx.verdicts.get(
    targetKey(next === 'video' ? 'shot_video' : 'shot_image', shot.id),
  )
  const stale = (kind: 'shot_image' | 'shot_video') => {
    const r = ctx.artifacts.get(targetKey(kind, shot.id))
    return r?.status === 'stale' ? r : undefined
  }
  const failedStage =
    shot.failedStage ??
    (shot.stages.video === 'failed'
      ? 'video'
      : shot.stages.image === 'failed'
        ? 'image'
        : undefined)
  return {
    phase,
    hasImage,
    hasVideo,
    next,
    failedJob: failedStage || failedJob?.needsAttention ? failedJob : undefined,
    failedStage,
    inFlight,
    imageStale: hasImage ? stale('shot_image') : undefined,
    videoStale: hasVideo ? stale('shot_video') : undefined,
    // 只在“下一步还没做”的镜头上提示不能生成：排队 / 运行中的（预检会因为它自己的在途任务拦下它）和已经完成的都不提示
    blocked:
      verdict?.status === 'blocked' &&
      !failedStage &&
      (phase === 'empty' || phase === 'image_ready')
        ? verdict
        : undefined,
  }
}

/** 一集的状态条：镜头数、视频已生成、生成中、已过期、失败、不能生成。 */
export interface EpisodeCounts {
  shots: number
  videos: number
  running: number
  stale: number
  failed: number
  blocked: number
}
export function countViews(views: readonly ShotView[]): EpisodeCounts {
  const c: EpisodeCounts = {
    shots: views.length,
    videos: 0,
    running: 0,
    stale: 0,
    failed: 0,
    blocked: 0,
  }
  for (const v of views) {
    if (v.hasVideo) c.videos++
    if (
      v.phase === 'image_running' ||
      v.phase === 'video_running' ||
      v.phase === 'image_queued' ||
      v.phase === 'video_queued'
    )
      c.running++
    if (v.imageStale || v.videoStale) c.stale++
    if (v.failedStage) c.failed++
    if (v.blocked) c.blocked++
  }
  return c
}

/** 镜头引用的资产（按镜头分组）。 */
export function refsByShot(refs: readonly ShotRef[]): Map<string, ShotRef[]> {
  const out = new Map<string, ShotRef[]>()
  for (const r of refs) out.set(r.shotId, [...(out.get(r.shotId) ?? []), r])
  return out
}

/** 声音归属（由台词和旁白派生，不是可编辑字段）：画外音（TTS）/ 台词（视频模型原生人声）/ 无人声。 */
export type SoundKind = 'narration' | 'dialogue' | 'silent'
export function soundOf(shot: Pick<Shot, 'dialogue' | 'narration'>): SoundKind {
  if (shot.dialogue.some((d) => d.text.trim())) return 'dialogue'
  if (shot.narration?.trim()) return 'narration'
  return 'silent'
}

/** 预检要问的目标：每个镜头的出图和出视频。服务端一次最多 500 项，超过就分块。 */
export function preflightItems(shotIds: readonly string[]) {
  return shotIds.flatMap((shotId) => [
    { target: { kind: 'shot_image' as const, shotId } },
    { target: { kind: 'shot_video' as const, shotId } },
  ])
}
export const PREFLIGHT_MAX = 500

export type MovePlan =
  | { kind: 'reorder'; sceneId: string; order: string[] }
  | { kind: 'move'; toSceneId: string; index?: number }

/**
 * 镜头上移 / 下移一格：场内就是调序；已经在场的头（尾）再往前（后）移，就跨场——
 * 到上一场的末尾，或下一场的开头。整集的第一个镜头不能再上移，最后一个不能再下移（跨集不在这里做）。
 */
export function planMove(
  groups: readonly SceneGroup[],
  shotId: string,
  dir: -1 | 1,
): MovePlan | undefined {
  const gi = groups.findIndex((g) => g.shots.some((s) => s.shot.id === shotId))
  if (gi < 0) return undefined
  const g = groups[gi]!
  const i = g.shots.findIndex((s) => s.shot.id === shotId)
  const j = i + dir
  if (j >= 0 && j < g.shots.length) {
    const order = g.shots.map((s) => s.shot.id)
    ;[order[i], order[j]] = [order[j]!, order[i]!]
    return { kind: 'reorder', sceneId: g.scene.id, order }
  }
  const next = groups[gi + dir]
  if (!next) return undefined
  return dir === -1
    ? { kind: 'move', toSceneId: next.scene.id }
    : { kind: 'move', toSceneId: next.scene.id, index: 0 }
}
