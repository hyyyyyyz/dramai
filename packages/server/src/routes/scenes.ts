import { allocateNumber, createScene } from '@dramai/core'
import type { Scene } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import { badRequest } from '../errors.ts'
import type { RouteRegistry } from '../handle.ts'
import {
  afterStructureChange,
  assertNotBusy,
  deleteShotsTx,
  permutationOf,
  removeFiles,
  requireEpisode,
  requireScene,
} from '../services/structure.ts'
import { OK } from './common.ts'

export function registerSceneRoutes(r: RouteRegistry, ctx: ServerContext): void {
  r.handle('scenes.create', async ({ params, body }) => {
    const episode = await requireEpisode(ctx, params.episodeId)
    const scene = await ctx.store.transaction(async (tx) => {
      const project = (await tx.projects.get(episode.projectId))!
      const alloc = allocateNumber(project, 'scene')
      const now = ctx.clock.now()
      const created: Scene = {
        ...createScene({
          id: ctx.ids.next('scene'),
          projectId: episode.projectId,
          episodeId: episode.id,
          number: alloc.number,
          title: body.title?.trim() || undefined,
          now,
        }),
        ...(body.timeOfDay ? { timeOfDay: body.timeOfDay } : {}),
        ...(body.blocking ? { blocking: body.blocking } : {}),
      }
      await tx.scenes.put(created)
      const fresh = (await tx.episodes.get(episode.id))!
      await tx.episodes.put({
        ...fresh,
        sceneOrder: [...fresh.sceneOrder, created.id],
        updatedAt: now,
      })
      await tx.projects.put({ ...alloc.project, updatedAt: now })
      return created
    })
    ctx.bus.changed('scene', { projectId: scene.projectId, ids: [scene.id], op: 'created' })
    ctx.bus.changed('episode', { projectId: scene.projectId, ids: [episode.id], op: 'updated' })
    return scene
  })

  r.handle('scenes.update', async ({ params, body }) => {
    const cur = await requireScene(ctx, params.sceneId)
    const next: Scene = { ...cur, updatedAt: ctx.clock.now() }
    if (body.title !== undefined) next.title = body.title?.trim() || undefined
    if (body.timeOfDay !== undefined) next.timeOfDay = body.timeOfDay || undefined
    if (body.blocking !== undefined) next.blocking = body.blocking || undefined
    if (body.locationAssetId !== undefined) {
      if (body.locationAssetId === null) {
        delete next.locationAssetId
      } else {
        const asset = await ctx.store.assets.get(body.locationAssetId)
        if (!asset || asset.projectId !== cur.projectId || asset.deletedAt !== undefined) {
          throw badRequest(`地点资产不存在或不属于这个项目：${body.locationAssetId}`)
        }
        if (asset.kind !== 'location') throw badRequest(`${asset.name} 不是场景（location）类资产`)
        next.locationAssetId = asset.id
      }
    }
    await ctx.store.scenes.put(next)
    ctx.bus.changed('scene', { projectId: next.projectId, ids: [next.id], op: 'updated' })
    return next
  })

  r.handle('scenes.delete', async ({ params }) => {
    const scene = await requireScene(ctx, params.sceneId)
    const shots = (await Promise.all(scene.shotOrder.map((id) => ctx.store.shots.get(id)))).filter(
      (s) => s !== undefined,
    )
    await assertNotBusy(ctx, scene.projectId, {
      shotIds: shots.map((s) => s.id),
      what: '这一场',
    })
    const files: string[] = []
    await ctx.store.transaction(async (tx) => {
      files.push(...(await deleteShotsTx(tx, scene.projectId, shots)))
      await tx.scenes.delete(scene.id)
      const ep = await tx.episodes.get(scene.episodeId)
      if (ep) {
        await tx.episodes.put({
          ...ep,
          sceneOrder: ep.sceneOrder.filter((id) => id !== scene.id),
          updatedAt: ctx.clock.now(),
        })
      }
    })
    await removeFiles(ctx, scene.projectId, files)
    ctx.bus.changed('scene', { projectId: scene.projectId, ids: [scene.id], op: 'deleted' })
    await afterStructureChange(ctx, [scene.episodeId], scene.projectId)
    return OK
  })

  r.handle('scenes.reorder', async ({ params, body }) => {
    const episode = await requireEpisode(ctx, params.episodeId)
    if (!permutationOf(body.order, episode.sceneOrder)) {
      throw badRequest('order 必须恰好包含这一集现有的全部场（不多不少、不重复）')
    }
    const next = { ...episode, sceneOrder: body.order, updatedAt: ctx.clock.now() }
    await ctx.store.episodes.put(next)
    ctx.bus.changed('episode', { projectId: next.projectId, ids: [next.id], op: 'updated' })
    return next
  })
}
