import {
  candidateProgress,
  confidenceBand,
  confirmCandidate,
  episodeShots,
  undoCandidateLink,
} from '@dramai/core'
import type { EntityCandidate } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import { conflict, notFound } from '../errors.ts'
import type { RouteRegistry } from '../handle.ts'
import { must, requireProject } from './common.ts'

export function registerCandidateRoutes(r: RouteRegistry, ctx: ServerContext): void {
  const view = (c: EntityCandidate) => ({ ...c, confidenceBand: confidenceBand(c.confidence) })

  const requireCandidate = async (id: string): Promise<EntityCandidate> => {
    const c = must(await ctx.store.candidates.get(id), '候选', id)
    await requireProject(ctx, c.projectId)
    return c
  }

  const requirePending = async (id: string): Promise<EntityCandidate> => {
    const c = await requireCandidate(id)
    if (c.status !== 'pending') {
      throw conflict('CANDIDATE_ALREADY_HANDLED', `候选「${c.name}」已处理（${c.status}）`, {
        status: c.status,
      })
    }
    return c
  }

  const notify = (cand: EntityCandidate, assetId?: string, extra: { assetIds?: string[] } = {}) => {
    ctx.bus.changed('candidate', { projectId: cand.projectId, ids: [cand.id], op: 'updated' })
    const ids = [...new Set([...(assetId ? [assetId] : []), ...(extra.assetIds ?? [])])]
    if (ids.length > 0) ctx.bus.changed('asset', { projectId: cand.projectId, ids })
    // 确认 / 撤销会改动镜头引用与 ready
    ctx.bus.changed('shot', { projectId: cand.projectId, ids: cand.shotIds })
  }

  const out = (res: { candidate: EntityCandidate; asset?: unknown }) => ({
    candidate: view(res.candidate),
    ...(res.asset ? { asset: res.asset as never } : {}),
  })

  r.handle('candidates.list', async ({ params, query }) => {
    await requireProject(ctx, params.projectId)
    let list = await ctx.store.candidates.listByProject(params.projectId)
    if (query.episodeId) {
      const ep = must(await ctx.store.episodes.get(query.episodeId), '分集', query.episodeId)
      if (ep.projectId !== params.projectId) throw notFound('分集', query.episodeId)
      const inEpisode = new Set((await episodeShots(ctx.store, ep.id)).map((s) => s.id))
      list = list.filter((c) => c.shotIds.some((id) => inEpisode.has(id)))
    }
    // 进度反映整个范围，不受 status 过滤影响。
    const progress = candidateProgress(list)
    const items = (query.status ? list.filter((c) => c.status === query.status) : list).map(view)
    return { items, progress }
  })

  r.handle('candidates.accept', async ({ params, body }) => {
    await requirePending(params.candidateId)
    const res = await confirmCandidate(
      ctx.deps,
      params.candidateId,
      { action: 'accept_new' },
      { name: body.name, createVariants: body.createVariants },
    )
    notify(res.candidate, res.asset?.id)
    return out(res)
  })

  r.handle('candidates.link', async ({ params, body }) => {
    await requirePending(params.candidateId)
    const res = await confirmCandidate(
      ctx.deps,
      params.candidateId,
      { action: 'link', assetId: body.assetId },
      { createVariants: body.createVariants },
    )
    notify(res.candidate, res.asset?.id)
    return out(res)
  })

  r.handle('candidates.ignore', async ({ params }) => {
    await requirePending(params.candidateId)
    const res = await confirmCandidate(ctx.deps, params.candidateId, { action: 'ignore' })
    notify(res.candidate)
    return { candidate: view(res.candidate) }
  })

  r.handle('candidates.undoLink', async ({ params, body }) => {
    const cand = await requireCandidate(params.candidateId)
    if (cand.status !== 'linked') {
      throw conflict('CANDIDATE_NOT_LINKED', `候选「${cand.name}」当前不是“已关联”状态`, {
        status: cand.status,
      })
    }
    const then = body.then
    const res = await undoCandidateLink(
      ctx.deps,
      params.candidateId,
      then
        ? then.action === 'link'
          ? { action: 'link', assetId: then.assetId }
          : { action: then.action }
        : undefined,
      then && then.action !== 'ignore'
        ? {
            createVariants: then.createVariants,
            ...(then.action === 'accept_new' ? { name: then.name } : {}),
          }
        : {},
    )
    notify(res.candidate, res.next?.asset?.id, {
      assetIds: cand.linkedAssetId ? [cand.linkedAssetId] : [],
    })
    return {
      candidate: view(res.candidate),
      removedVariants: res.removedVariants,
      keptVariants: res.keptVariants,
      ...(res.next ? { next: out(res.next) } : {}),
    }
  })
}
