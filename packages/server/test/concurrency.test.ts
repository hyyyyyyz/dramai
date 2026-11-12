import { createEpisode } from '@dramai/core'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

/** 把读拉长：没有串行保护时，并发请求必然都读到旧值，后写覆盖前写。 */
function slowReads(store: { assets: { get: unknown }; shots: { get: unknown } }, ms = 15) {
  const patch = <T extends { get: (id: string) => Promise<unknown> }>(repo: T) => {
    const orig = repo.get.bind(repo)
    repo.get = async (id: string) => {
      const v = await orig(id)
      await new Promise((r) => setTimeout(r, ms))
      return v
    }
  }
  patch(store.assets as never)
  patch(store.shots as never)
}

/**
 * 读-改-写类的路由并发执行时不丢更新：每个修改类路由整体在一个事务里，彼此串行。
 * 做法：对同一个实体同时发很多条“各改不同字段”的请求，最后每个字段的值都必须在。
 */
describe('concurrent edits do not lose updates', () => {
  it('assets.update: many parallel PATCHes to different fields all survive', async () => {
    const h = await startServer({ startWorker: false })
    const p = await h.client.call('projects.create', { body: { name: 'p', aspectRatio: '9:16' } })
    const asset = await h.client.call('assets.create', {
      params: { projectId: p.id },
      body: { kind: 'character', name: '林夏' },
    })
    slowReads(h.server.ctx.store)
    const fields = ['appearance', 'styling', 'description'] as const
    for (let round = 0; round < 8; round++) {
      await Promise.all(
        fields.map((f) =>
          h.client.call('assets.update', {
            params: { assetId: asset.id },
            body: { [f]: `${f}-${round}` },
          }),
        ),
      )
      const { asset: now } = await h.client.call('assets.get', { params: { assetId: asset.id } })
      for (const f of fields) expect(now[f], `round ${round} lost ${f}`).toBe(`${f}-${round}`)
    }
  })

  it('shots.update + shots.setRefs + scenes edits interleave without clobbering each other', async () => {
    const h = await startServer({ startWorker: false })
    const p = await h.client.call('projects.create', { body: { name: 'p', aspectRatio: '9:16' } })
    const e = createEpisode({ id: 'ep_c', projectId: p.id, number: 1, title: '第一集', now: 1 })
    await h.server.ctx.store.episodes.put(e)
    await h.server.ctx.store.projects.put({
      ...p,
      episodeOrder: [e.id],
      counters: { ...p.counters, episode: 1 },
    } as never)
    const scene = await h.client.call('scenes.create', { params: { episodeId: e.id }, body: {} })
    const shot = await h.client.call('shots.create', { params: { sceneId: scene.id }, body: {} })
    slowReads(h.server.ctx.store)
    const a1 = await h.client.call('assets.create', {
      params: { projectId: p.id },
      body: { kind: 'character', name: '甲' },
    })

    for (let round = 0; round < 8; round++) {
      await Promise.all([
        h.client.call('shots.update', {
          params: { shotId: shot.id },
          body: { title: `t-${round}` },
        }),
        h.client.call('shots.update', {
          params: { shotId: shot.id },
          body: { scriptExcerpt: `s-${round}` },
        }),
        h.client.call('shots.update', {
          params: { shotId: shot.id },
          body: { atmosphere: `a-${round}` },
        }),
        h.client.call('shots.setRefs', {
          params: { shotId: shot.id },
          body: { refs: round % 2 === 0 ? [{ assetId: a1.id }] : [] },
        }),
      ])
      const got = await h.client.call('shots.get', { params: { shotId: shot.id } })
      expect(got.shot).toMatchObject({
        title: `t-${round}`,
        scriptExcerpt: `s-${round}`,
        atmosphere: `a-${round}`,
      })
      expect(got.refs).toHaveLength(round % 2 === 0 ? 1 : 0)
    }
  })

  it('a failing mutation leaves nothing half-written', async () => {
    const h = await startServer({ startWorker: false })
    const p = await h.client.call('projects.create', { body: { name: 'p', aspectRatio: '9:16' } })
    const before = await h.server.ctx.store.assets.listByProject(p.id)
    const dup = await h.client
      .call('assets.create', {
        params: { projectId: p.id },
        body: { kind: 'character', name: '甲' },
      })
      .then(() =>
        h.client.call('assets.create', {
          params: { projectId: p.id },
          body: { kind: 'character', name: '甲' },
        }),
      )
      .catch((e) => e)
    expect(dup).toMatchObject({ status: 409, code: 'ASSET_NAME_TAKEN' })
    // 第二次失败不应该多占一个编号 / 多一条资产
    const after = await h.server.ctx.store.assets.listByProject(p.id)
    expect(after.length - before.length).toBe(1)
    const project = await h.server.ctx.store.projects.get(p.id)
    expect(project!.counters.asset).toBe(1)
  })
})
