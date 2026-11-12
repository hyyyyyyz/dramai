import {
  appendRevision,
  bgmPath,
  ensureTimeline,
  headRevision,
  hasBlockingIssues,
  readEpisodeTimeline,
  rollbackTo,
  syncTimelineWithShots,
  episodeShots,
  TIMELINE_TRANSITIONS,
} from '@dramai/core'
import type { Episode, RevisionContent, TimelineDocument } from '@dramai/core'
import type { TimelineView } from '@dramai/api'
import type { ServerContext } from '../context.ts'
import { badRequest, conflict, HttpError, notFound } from '../errors.ts'
import { formFile } from '../handle.ts'
import type { RouteRegistry } from '../handle.ts'
import { audioKind } from './assets-crud.ts'
import { must } from './common.ts'

const MAX_BGM_BYTES = 60 * 1024 * 1024

export function registerTimelineRoutes(r: RouteRegistry, ctx: ServerContext): void {
  const requireEpisode = async (id: string): Promise<Episode> => {
    const ep = must(await ctx.store.episodes.get(id), 'episode', id)
    const project = await ctx.store.projects.get(ep.projectId)
    if (!project || project.deletedAt !== undefined) throw notFound('episode', id)
    return ep
  }

  /** 时间线 + 摆放 + 问题检查 → 接口视图。`revision` 缺省为最新。 */
  const view = async (episodeId: string, revision?: number): Promise<TimelineView> => {
    const reading = await readEpisodeTimeline(ctx.deps, episodeId, revision)
    const { doc, placement, issues } = reading
    const rev = revision ? doc.revisions.find((x) => x.number === revision)! : headRevision(doc)
    return {
      id: doc.id,
      episodeId: doc.episodeId,
      name: doc.name,
      head: headRevision(doc).number,
      revisions: doc.revisions.map((r) => {
        const meta: Partial<typeof r> = { ...r }
        delete meta.content
        return meta
      }),
      revision: rev,
      placement,
      issues,
      hasBlockingIssues: hasBlockingIssues(issues),
    } as TimelineView
  }

  const notify = (ep: Episode) => {
    ctx.bus.changed('timeline', { projectId: ep.projectId, ids: [ep.id], op: 'updated' })
    ctx.bus.emit({ type: 'artifact.changed', projectId: ep.projectId, key: `cut:${ep.id}` })
  }

  r.handle('timeline.get', async ({ params, query }) => {
    await requireEpisode(params.episodeId)
    return view(params.episodeId, query.revision)
  })

  r.handle('timeline.update', async ({ params, body }) => {
    const ep = await requireEpisode(params.episodeId)
    const doc = await ensureTimeline(ctx.deps, ep.id)
    const head = headRevision(doc)
    if (body.baseRevision !== undefined && body.baseRevision !== head.number) {
      throw conflict(
        'REVISION_CONFLICT',
        `时间线已被修改（当前是修订 ${head.number}，你基于 ${body.baseRevision}）`,
        { head: head.number },
      )
    }
    const content = body.content as RevisionContent
    // 校验：片段 id 唯一、镜头属于这一集、时间是非负整数、截取区间有序。
    const shotIds = new Set((await episodeShots(ctx.store, ep.id)).map((s) => s.id))
    const clipIds = new Set<string>()
    const bad = (message: string) => new HttpError(400, 'INVALID_TIMELINE', message)
    const isUs = (n: number) => Number.isInteger(n) && n >= 0
    for (const c of content.clips) {
      if (clipIds.has(c.id)) throw bad(`片段 id 重复：${c.id}`)
      clipIds.add(c.id)
      if (!shotIds.has(c.shotId)) throw bad(`片段 ${c.id} 的镜头不属于这一集：${c.shotId}`)
      if (!isUs(c.holdUs)) throw bad(`片段 ${c.id} 的静帧延长必须是非负整数微秒`)
      if (!(c.sourceVolume >= 0 && c.sourceVolume <= 1))
        throw bad(`片段 ${c.id} 的原声音量应在 0..1`)
      if (c.trim && !(isUs(c.trim.inUs) && isUs(c.trim.outUs) && c.trim.outUs > c.trim.inUs)) {
        throw bad(`片段 ${c.id} 的截取区间不合法`)
      }
      if (c.transitionToNext) {
        if (!isUs(c.transitionToNext.durationUs)) {
          throw bad(`片段 ${c.id} 的转场时长必须是非负整数微秒`)
        }
        if (!(TIMELINE_TRANSITIONS as readonly string[]).includes(c.transitionToNext.type)) {
          throw bad(`片段 ${c.id} 的转场类型未知：${c.transitionToNext.type}`)
        }
      }
    }
    const narrating = new Map<string, number>()
    for (const c of content.clips) {
      if (c.carriesNarration) narrating.set(c.shotId, (narrating.get(c.shotId) ?? 0) + 1)
    }
    for (const [shotId, n] of narrating) {
      if (n > 1) throw bad(`镜头 ${shotId} 只能有一个片段承载旁白`)
    }
    const bgmIds = new Set<string>()
    for (const b of content.bgm) {
      if (bgmIds.has(b.id)) throw bad(`配乐 id 重复：${b.id}`)
      bgmIds.add(b.id)
      if (!(isUs(b.startUs) && isUs(b.inUs) && isUs(b.outUs) && b.outUs > b.inUs)) {
        throw bad(`配乐 ${b.id} 的时间不合法`)
      }
      if (!(b.volume >= 0 && b.volume <= 1)) throw bad(`配乐 ${b.id} 的音量应在 0..1`)
      if (!(isUs(b.fadeInUs) && isUs(b.fadeOutUs))) throw bad(`配乐 ${b.id} 的淡入淡出不合法`)
    }
    if (content.bgm.length > 1) throw bad('目前只支持一条配乐')

    const before = JSON.stringify(head.content)
    if (before === JSON.stringify(content)) return view(ep.id)

    // 新片段 id 形如 c<数字>：把发号器推到最大值之后，之后同步新增镜头时不会撞号。
    const maxNum = (ids: Iterable<string>, prefix: string) =>
      Math.max(
        0,
        ...[...ids].map((id) => {
          const m = new RegExp(`^${prefix}(\\d+)$`).exec(id)
          return m ? Number(m[1]) : 0
        }),
      )
    const oldClips = new Map(head.content.clips.map((c) => [c.id, JSON.stringify(c)]))
    const changedClipIds = content.clips
      .filter((c) => oldClips.get(c.id) !== JSON.stringify(c))
      .map((c) => c.id)
    const updated: TimelineDocument = appendRevision(doc, {
      content,
      summary: body.summary,
      author: { kind: 'creator' },
      now: ctx.clock.now(),
      changedClipIds,
      nextClipNumber: Math.max(doc.nextClipNumber, maxNum(clipIds, 'c') + 1),
      nextBgmNumber: Math.max(doc.nextBgmNumber, maxNum(bgmIds, 'b') + 1),
    })
    await ctx.store.timelines.put(updated)
    notify(ep)
    return view(ep.id)
  })

  r.handle('timeline.rollback', async ({ params, body }) => {
    const ep = await requireEpisode(params.episodeId)
    const doc = await ensureTimeline(ctx.deps, ep.id)
    if (!doc.revisions.some((x) => x.number === body.revision)) {
      throw notFound('timeline_revision', String(body.revision))
    }
    const rolled = rollbackTo(doc, body.revision, {
      author: { kind: 'creator' },
      now: ctx.clock.now(),
    })
    await ctx.store.timelines.put(rolled)
    notify(ep)
    return view(ep.id)
  })

  r.handle('timeline.sync', async ({ params }) => {
    const ep = await requireEpisode(params.episodeId)
    const before = headRevision(await ensureTimeline(ctx.deps, ep.id)).number
    const doc = await syncTimelineWithShots(ctx.deps, ep.id)
    if (headRevision(doc).number !== before) notify(ep)
    return view(ep.id)
  })

  r.handle('timeline.uploadBgm', async ({ params, form }) => {
    const ep = await requireEpisode(params.episodeId)
    const file = await formFile(form, 'file')
    if (!audioKind(file.name, file.mime))
      throw badRequest('不是支持的音频格式（mp3 / wav / m4a / aac / ogg）')
    if (file.bytes.byteLength === 0) throw badRequest('文件是空的')
    if (file.bytes.byteLength > MAX_BGM_BYTES) {
      throw badRequest(`配乐超过 ${MAX_BGM_BYTES / 1024 / 1024}MB 上限`)
    }
    const bgmId = ctx.ids.next('bgm')
    const info = await ctx.files.put(ep.projectId, bgmPath(bgmId), file.bytes)
    return { bgmId, bytes: info.bytes }
  })
}
