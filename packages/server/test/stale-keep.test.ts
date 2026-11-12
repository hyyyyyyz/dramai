import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'

afterEach(cleanupAll)

async function world(h: Harness) {
  const p = await h.client.call('projects.create', { body: { name: 'p', aspectRatio: '9:16' } })
  const e = await h.client.call('episodes.create', { params: { projectId: p.id }, body: {} })
  const sc = await h.client.call('scenes.create', { params: { episodeId: e.id }, body: {} })
  const shot = await h.client.call('shots.create', {
    params: { sceneId: sc.id },
    body: { title: '甲' },
  })
  // 先给一个“生成出来的”分镜图记录（直接写入，模拟一次生成之后）
  const { store } = h.server.ctx
  const s = (await store.shots.get(shot.id))!
  const versionId = 'ver_x'
  const file = {
    path: `images/${shot.id}/${versionId}.png`,
    mime: 'image/png',
    bytes: 3,
    sha256: 'a'.repeat(64),
  }
  await h.server.ctx.files.put(p.id, file.path, new Uint8Array([1, 2, 3]))
  await store.shots.put({
    ...s,
    prompts: { ...s.prompts, keyFrame: '第一版首帧提示词', firstFrame: '第一版首帧提示词' },
    image: {
      currentVersionId: versionId,
      versions: [{ id: versionId, kind: 'image', file, source: 'generated', createdAt: 1 }],
    },
  })
  return { p, e, shot, key: `shot_image:${shot.id}`, file, versionId }
}

/** 登记一条与“现在”一致的记录，再改依据让它过期。 */
async function makeStale(h: Harness, w: Awaited<ReturnType<typeof world>>) {
  const { buildExpectations, buildRecord, loadProjection } = await import('@dramai/core')
  const projection = await loadProjection(h.server.ctx.store, w.p.id)
  const exp = buildExpectations(projection).get(w.key)!
  await h.server.ctx.store.artifacts.put(
    buildRecord({
      projectId: w.p.id,
      expectation: { ...exp, blockedBy: undefined, requiredUpstream: [] },
      upstreamRecords: projection.artifacts,
      file: w.file,
      versionId: w.versionId,
      now: 1,
    }),
  )
  await h.client.call('shots.update', {
    params: { shotId: w.shot.id },
    body: { prompts: { keyFrame: '改过的首帧提示词' } },
  })
}

const report = async (h: Harness, w: { e: { id: string }; key: string }) =>
  (await h.client.call('episodes.artifacts', { params: { episodeId: w.e.id } })).items.find(
    (a) => a.key === w.key,
  )!

describe("keeping a stale artifact as it is (server-side state, not the browser's)", () => {
  it('stale → keep → current with keptAt; stale again when its basis changes again', async () => {
    const h = await startServer({ startWorker: false })
    const w = await world(h)
    await makeStale(h, w)
    expect(await report(h, w)).toMatchObject({ status: 'stale', reason: 'basis_changed' })

    const kept = await h.client.call('artifacts.keep', {
      params: { projectId: w.p.id },
      body: { key: w.key },
    })
    expect(kept).toMatchObject({ key: w.key, status: 'current', file: { path: w.file.path } })
    expect(kept.keptAt).toBeTypeOf('number')
    // 状态是服务端记着的：重新查询（也就是换个浏览器）仍然是“已保留”
    expect(await report(h, w)).toMatchObject({ status: 'current', keptAt: kept.keptAt })
    expect(
      (await h.client.call('projects.artifacts', { params: { projectId: w.p.id } })).items.find(
        (a) => a.key === w.key,
      ),
    ).toMatchObject({ status: 'current', keptAt: kept.keptAt })

    await h.client.call('shots.update', {
      params: { shotId: w.shot.id },
      body: { prompts: { keyFrame: '再改一次' } },
    })
    const again = await report(h, w)
    expect(again.status).toBe('stale')
    expect(again.keptAt).toBeUndefined()
    // 可以再次保持现状
    expect(
      (
        await h.client.call('artifacts.keep', {
          params: { projectId: w.p.id },
          body: { key: w.key },
        })
      ).status,
    ).toBe('current')
  })

  it('refuses artifacts that are not stale, or do not exist (stable codes)', async () => {
    const h = await startServer({ startWorker: false })
    const w = await world(h)
    const keep = (key: string) =>
      h.client
        .call('artifacts.keep', { params: { projectId: w.p.id }, body: { key } })
        .catch((e) => e as { status: number; code: string; details?: unknown })
    expect(await keep(w.key)).toMatchObject({
      status: 409,
      code: 'ARTIFACT_NOT_STALE',
      details: { status: 'missing' },
    }) // 没记录
    await makeStale(h, w)
    await h.client.call('artifacts.keep', { params: { projectId: w.p.id }, body: { key: w.key } })
    expect(await keep(w.key)).toMatchObject({
      status: 409,
      code: 'ARTIFACT_NOT_STALE',
      details: { status: 'current' },
    }) // 已经是当前
    expect(await keep('shot_image:nope')).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      details: { entity: 'artifact', id: 'shot_image:nope' },
    })
    expect(
      await h.client
        .call('artifacts.keep', { params: { projectId: 'p_nope' }, body: { key: w.key } })
        .catch((e) => e),
    ).toMatchObject({ status: 404, details: { entity: 'project' } })
  })

  it('regenerating or switching version afterwards replaces the kept record normally', async () => {
    const h = await startServer({ startWorker: false })
    const w = await world(h)
    await makeStale(h, w)
    await h.client.call('artifacts.keep', { params: { projectId: w.p.id }, body: { key: w.key } })
    // 选用这个版本自己：登记用它自己的依据摘要（生成时没有 → 取当前），keptAt 不再保留
    await h.client.call('shots.setCurrentVersion', {
      params: { shotId: w.shot.id },
      body: { slot: 'image', versionId: w.versionId },
    })
    expect((await report(h, w)).keptAt).toBeUndefined()
  })
})
