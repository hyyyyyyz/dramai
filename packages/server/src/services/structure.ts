import { isInFlight, refreshEpisodeStatus } from '@dramai/core'
import type { Episode, Scene, Shot, Store } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import { conflict, notFound } from '../errors.ts'

/** 作品结构（项目 / 集 / 场 / 镜）的共用操作。路由只做校验和编排，结构变更集中在这里。 */

/** 是否存在在途任务（queued / running）占用了这些对象；有就拒绝结构性删除。 */
export async function assertNotBusy(
  ctx: ServerContext,
  projectId: string,
  scope: { shotIds?: readonly string[]; episodeId?: string; what: string },
): Promise<void> {
  const shots = new Set(scope.shotIds ?? [])
  const jobs = (await ctx.store.jobs.list({ projectId })).filter((j) => isInFlight(j.status))
  const busy = jobs.filter(
    (j) =>
      (scope.episodeId !== undefined && j.episodeId === scope.episodeId) ||
      (j.shotId !== undefined && shots.has(j.shotId)),
  )
  if (busy.length > 0) {
    throw conflict(
      'BUSY',
      `${scope.what}还有 ${busy.length} 个任务在排队或运行，请等它们结束或先取消`,
      {
        jobIds: busy.map((j) => j.id),
      },
    )
  }
}

export function permutationOf(order: readonly string[], existing: readonly string[]): boolean {
  if (order.length !== existing.length) return false
  const a = new Set(order)
  if (a.size !== order.length) return false
  return existing.every((id) => a.has(id))
}

const SHOT_KEYS = ['shot_image', 'shot_video', 'shot_audio'] as const

/**
 * 在事务里删除一批镜头：镜头行、引用表、产物登记、候选里的镜头引用（空的待处理候选一并删掉）。
 * 返回要在提交后删除的文件路径（版本文件）。
 */
export async function deleteShotsTx(
  tx: Store,
  projectId: string,
  shots: readonly Shot[],
): Promise<string[]> {
  const files: string[] = []
  const ids = new Set(shots.map((s) => s.id))
  for (const shot of shots) {
    for (const slot of [shot.image, shot.video, shot.narrationAudio]) {
      for (const v of slot.versions) files.push(v.file.path)
    }
    await tx.shots.delete(shot.id)
    await tx.shotRefs.replaceForShot(shot.id, [])
    for (const kind of SHOT_KEYS) await tx.artifacts.delete(projectId, `${kind}:${shot.id}`)
  }
  for (const c of await tx.candidates.listByProject(projectId)) {
    if (!c.shotIds.some((id) => ids.has(id))) continue
    const left = c.shotIds.filter((id) => !ids.has(id))
    if (left.length === 0 && c.status === 'pending') await tx.candidates.delete(c.id)
    else await tx.candidates.put({ ...c, shotIds: left })
  }
  return files
}

export async function removeFiles(ctx: ServerContext, projectId: string, paths: readonly string[]) {
  for (const p of paths) await ctx.files.remove(projectId, p).catch(() => {})
}

/** 一集下的所有场与镜头（按场序 / 镜序）。 */
export async function episodeStructure(
  store: Store,
  episode: Episode,
): Promise<{ scenes: Scene[]; shots: Shot[] }> {
  const allScenes = new Map(
    (await store.scenes.listByProject(episode.projectId)).map((s) => [s.id, s]),
  )
  const allShots = new Map(
    (await store.shots.listByProject(episode.projectId)).map((s) => [s.id, s]),
  )
  const scenes = episode.sceneOrder.map((id) => allScenes.get(id)).filter((s): s is Scene => !!s)
  const shots = scenes.flatMap((s) =>
    s.shotOrder.map((id) => allShots.get(id)).filter((x): x is Shot => !!x),
  )
  return { scenes, shots }
}

export async function requireEpisode(ctx: ServerContext, id: string): Promise<Episode> {
  const ep = await ctx.store.episodes.get(id)
  if (!ep) throw notFound('分集', id)
  const project = await ctx.store.projects.get(ep.projectId)
  if (!project || project.deletedAt !== undefined) throw notFound('分集', id)
  return ep
}

export async function requireScene(ctx: ServerContext, id: string): Promise<Scene> {
  const scene = await ctx.store.scenes.get(id)
  if (!scene) throw notFound('场', id)
  return scene
}

export async function requireShot(ctx: ServerContext, id: string): Promise<Shot> {
  const shot = await ctx.store.shots.get(id)
  if (!shot) throw notFound('镜头', id)
  return shot
}

/** 结构变更之后：集的状态按现状重新推导，并发出变更通知。 */
export async function afterStructureChange(
  ctx: ServerContext,
  episodeIds: readonly string[],
  projectId: string,
): Promise<void> {
  for (const id of new Set(episodeIds)) {
    const ep = await ctx.store.episodes.get(id)
    if (ep) await refreshEpisodeStatus(ctx.deps, ep)
  }
  ctx.bus.changed('episode', { projectId, ids: [...new Set(episodeIds)], op: 'updated' })
}

export const touch = <T extends { updatedAt: number }>(ctx: ServerContext, v: T): T => ({
  ...v,
  updatedAt: ctx.clock.now(),
})
