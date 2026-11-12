import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'

afterEach(cleanupAll)

async function world(h: Harness) {
  const p = await h.client.call('projects.create', { body: { name: 'p', aspectRatio: '9:16' } })
  const e1 = await h.client.call('episodes.create', { params: { projectId: p.id }, body: {} })
  const e2 = await h.client.call('episodes.create', { params: { projectId: p.id }, body: {} })
  const s1 = await h.client.call('scenes.create', { params: { episodeId: e1.id }, body: {} })
  const s2 = await h.client.call('scenes.create', { params: { episodeId: e1.id }, body: {} })
  const s3 = await h.client.call('scenes.create', { params: { episodeId: e2.id }, body: {} })
  const mk = (sceneId: string, title: string) =>
    h.client.call('shots.create', { params: { sceneId }, body: { title } })
  return { p, e1, e2, s1, s2, s3, mk }
}

describe('moving a shot to another scene (shots.move; shots.reorder is only within one scene)', () => {
  it('across scenes of one episode: lands at the requested position, source scene shrinks, shot keeps its identity and media', async () => {
    const h = await startServer({ startWorker: false })
    const { s1, s2, mk } = await world(h)
    const a = await mk(s1.id, 'A')
    const b = await mk(s1.id, 'B')
    const c = await mk(s2.id, 'C')
    const d = await mk(s2.id, 'D')
    const moved = await h.client.call('shots.move', {
      params: { shotId: b.id },
      body: { toSceneId: s2.id, index: 1 },
    })
    expect(moved).toMatchObject({ id: b.id, sceneId: s2.id, title: 'B', number: b.number })
    const { store } = h.server.ctx
    expect((await store.scenes.get(s1.id))!.shotOrder).toEqual([a.id])
    expect((await store.scenes.get(s2.id))!.shotOrder).toEqual([c.id, b.id, d.id])
    // 不给 index = 放到最后；index 超界也放到最后
    await h.client.call('shots.move', { params: { shotId: a.id }, body: { toSceneId: s2.id } })
    expect((await store.scenes.get(s2.id))!.shotOrder).toEqual([c.id, b.id, d.id, a.id])
    await h.client.call('shots.move', {
      params: { shotId: c.id },
      body: { toSceneId: s1.id, index: 99 },
    })
    expect((await store.scenes.get(s1.id))!.shotOrder).toEqual([c.id])
    // 移空的场还在（可以再往里放）
    expect((await store.scenes.get(s1.id))!.shotOrder).toHaveLength(1)
  })

  it('across episodes of one project: the episode ordering of shots follows, both episodes are refreshed', async () => {
    const h = await startServer({ startWorker: false })
    const { e1, e2, s1, s3, mk } = await world(h)
    const a = await mk(s1.id, 'A')
    const b = await mk(s1.id, 'B')
    await h.client.call('shots.move', { params: { shotId: a.id }, body: { toSceneId: s3.id } })
    const d1 = await h.client.call('episodes.get', { params: { episodeId: e1.id } })
    const d2 = await h.client.call('episodes.get', { params: { episodeId: e2.id } })
    expect(d1.shots.map((s) => s.id)).toEqual([b.id])
    expect(d2.shots.map((s) => s.id)).toEqual([a.id])
    // 任务面板里它现在属于第二集
    const { job } = await h.server.ctx.queue.enqueue({
      type: 'image',
      operation: 'shot_image',
      projectId: d2.episode.projectId,
      shotId: a.id,
    })
    expect((await h.client.call('jobs.get', { params: { jobId: job.id } })).target).toMatchObject({
      kind: 'shot',
      episodeId: e2.id,
      shotIndex: 1,
    })
  })

  it('refuses a scene of another project, an unknown scene or shot (with entity details); same scene is a plain reorder', async () => {
    const h = await startServer({ startWorker: false })
    const { s1, mk } = await world(h)
    const other = await h.client.call('projects.create', {
      body: { name: 'q', aspectRatio: '9:16' },
    })
    const oe = await h.client.call('episodes.create', { params: { projectId: other.id }, body: {} })
    const os = await h.client.call('scenes.create', { params: { episodeId: oe.id }, body: {} })
    const a = await mk(s1.id, 'A')
    const b = await mk(s1.id, 'B')
    const fail = (p: Promise<unknown>) =>
      p.catch((e) => e as { status: number; code: string; details?: unknown })
    expect(
      await fail(
        h.client.call('shots.move', { params: { shotId: a.id }, body: { toSceneId: os.id } }),
      ),
    ).toMatchObject({ status: 400 })
    expect(
      await fail(
        h.client.call('shots.move', { params: { shotId: a.id }, body: { toSceneId: 'sc_nope' } }),
      ),
    ).toMatchObject({ status: 404, details: { entity: 'scene', id: 'sc_nope' } })
    expect(
      await fail(
        h.client.call('shots.move', { params: { shotId: 'sh_nope' }, body: { toSceneId: s1.id } }),
      ),
    ).toMatchObject({ status: 404, details: { entity: 'shot' } })
    await h.client.call('shots.move', {
      params: { shotId: b.id },
      body: { toSceneId: s1.id, index: 0 },
    })
    expect((await h.server.ctx.store.scenes.get(s1.id))!.shotOrder).toEqual([b.id, a.id])
  })

  it('shots.reorder cannot move a shot between scenes, and its error says to use shots.move', async () => {
    const h = await startServer({ startWorker: false })
    const { s1, s2, mk } = await world(h)
    const a = await mk(s1.id, 'A')
    const c = await mk(s2.id, 'C')
    const err = await h.client
      .call('shots.reorder', { params: { sceneId: s1.id }, body: { order: [a.id, c.id] } })
      .catch((e) => e as { status: number; message: string; details?: { hint?: string } })
    expect(err).toMatchObject({ status: 400, details: { hint: 'shots.move', expected: 1 } })
    expect((err as { message: string }).message).toContain('shots.move')
  })
})
