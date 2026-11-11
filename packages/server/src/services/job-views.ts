import type { JobListItem, JobTarget } from '@dramai/api'
import { episodeShots, needsAttention, queuePositions } from '@dramai/core'
import type { Job } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import type { ServerStore } from '../storage/sqlite-store.ts'

/**
 * 任务作用在什么上：结构化的字段（第几集、第几个镜头、资产名和类别……），文案由前端按语言拼。
 * 名称是用户自己填的，原样返回。一次查询里共用缓存，列表很长时也只查每个镜头 / 集一次。
 */
export interface TargetResolver {
  resolve(job: Job): Promise<JobTarget>
}

export function createTargetResolver(store: ServerStore): TargetResolver {
  return { resolve: (job) => resolveTarget(store, job, new Map()) }
}

type Cache = Map<string, Promise<unknown>>
const memo = <T>(cache: Cache, key: string, load: () => Promise<T>): Promise<T> => {
  let hit = cache.get(key) as Promise<T> | undefined
  if (!hit) {
    hit = load()
    cache.set(key, hit)
  }
  return hit
}

async function resolveTarget(store: ServerStore, job: Job, cache: Cache): Promise<JobTarget> {
  const episodeTarget = async (episodeId: string): Promise<JobTarget> => {
    const ep = await memo(cache, `ep:${episodeId}`, () => store.episodes.get(episodeId))
    if (!ep) return { kind: 'removed', entity: 'episode', id: episodeId }
    return { kind: 'episode', episodeId: ep.id, episodeNumber: ep.number, episodeTitle: ep.title }
  }

  if (job.shotId) {
    const shot = await memo(cache, `shot:${job.shotId}`, () => store.shots.get(job.shotId!))
    if (!shot) return { kind: 'removed', entity: 'shot', id: job.shotId }
    const scene = await memo(cache, `scene:${shot.sceneId}`, () => store.scenes.get(shot.sceneId))
    const episode = scene
      ? await memo(cache, `ep:${scene.episodeId}`, () => store.episodes.get(scene.episodeId))
      : undefined
    if (!scene || !episode) return { kind: 'removed', entity: 'shot', id: shot.id }
    const ordered = await memo(cache, `shots:${episode.id}`, () => episodeShots(store, episode.id))
    const index = ordered.findIndex((s) => s.id === shot.id)
    return {
      kind: 'shot',
      shotId: shot.id,
      shotIndex: index + 1,
      shotNumber: shot.number,
      ...(shot.title ? { shotTitle: shot.title } : {}),
      sceneId: scene.id,
      episodeId: episode.id,
      episodeNumber: episode.number,
      episodeTitle: episode.title,
    }
  }
  if (job.assetId) {
    const asset = await memo(cache, `asset:${job.assetId}`, () => store.assets.get(job.assetId!))
    if (!asset) return { kind: 'removed', entity: 'asset', id: job.assetId }
    const variantName = (job.params.target as { variantName?: unknown } | undefined)?.variantName
    return {
      kind: 'asset',
      assetId: asset.id,
      assetKind: asset.kind,
      name: asset.name,
      ...(typeof variantName === 'string' && variantName ? { variantName } : {}),
    }
  }
  if (job.episodeId) return episodeTarget(job.episodeId)
  return { kind: 'project' }
}

/** 结果被忽略：运行中 = 已标记（结束时生效）；结束后 = 实际没有成为当前版本。 */
function resultIgnored(job: Job): boolean {
  return job.status === 'running' || job.status === 'queued'
    ? job.ignoreResult === true
    : job.result?.ignored === true
}

export function toJobItem(job: Job, target: JobTarget, queuePosition?: number): JobListItem {
  return {
    ...job,
    ...(queuePosition === undefined ? {} : { queuePosition }),
    needsAttention: needsAttention(job),
    target,
    resultIgnored: resultIgnored(job),
  } as JobListItem
}

/** 一批任务的视图（共用查询缓存）。 */
export async function jobViews(
  ctx: ServerContext,
  jobs: Array<Job & { queuePosition?: number }>,
): Promise<JobListItem[]> {
  const cache: Cache = new Map()
  return Promise.all(
    jobs.map(async (j) => toJobItem(j, await resolveTarget(ctx.store, j, cache), j.queuePosition)),
  )
}

/** 单个任务的视图（排队中的带排队位置）。 */
export async function jobView(ctx: ServerContext, job: Job): Promise<JobListItem> {
  const target = await ctx.targets.resolve(job)
  if (job.status !== 'queued') return toJobItem(job, target)
  const queued = await ctx.store.jobs.list({ status: 'queued' })
  return toJobItem(job, target, queuePositions(queued).get(job.id))
}
