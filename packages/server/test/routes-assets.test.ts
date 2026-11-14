import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '@dramai/api'
import {
  appendRevision,
  createEpisode,
  createProject,
  createScene,
  createShot,
  headRevision,
  SCHEMA_VERSIONS,
} from '@dramai/core'
import type { EntityCandidate } from '@dramai/core'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'

afterEach(cleanupAll)

/** 只有文件头的最小 PNG（够 sniff 出尺寸）；seed 不同则字节不同。 */
function png(seed = 0, width = 64, height = 48): Uint8Array {
  const b = new Uint8Array(40)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const dv = new DataView(b.buffer)
  dv.setUint32(8, 13)
  b.set([0x49, 0x48, 0x44, 0x52], 12)
  dv.setUint32(16, width)
  dv.setUint32(20, height)
  b[32] = seed
  return b
}
const form = (
  name: string,
  bytes: Uint8Array,
  mime: string,
  extra: Record<string, string> = {},
) => {
  const f = new FormData()
  f.set('file', new File([bytes as never], name, { type: mime }))
  for (const [k, v] of Object.entries(extra)) f.set(k, v)
  return f
}
const fail = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return e as ApiError
  }
  throw new Error('expected the call to fail')
}

/** 一个项目、一集、一场、三个镜头。 */
async function seed(h: Harness) {
  const { store, clock } = h.server.ctx
  const now = clock.now()
  const project = createProject({ id: 'p1', name: '测试', aspectRatio: '9:16', now })
  const episode = createEpisode({ id: 'e1', projectId: 'p1', number: 1, title: '第一集', now })
  const scene = createScene({ id: 's1', projectId: 'p1', episodeId: 'e1', number: 1, now })
  const shots = [1, 2, 3].map((n) =>
    createShot({ id: `sh${n}`, projectId: 'p1', sceneId: 's1', number: n, now, durationSec: 4 }),
  )
  await store.projects.put({
    ...project,
    episodeOrder: ['e1'],
    counters: { ...project.counters, episode: 1, scene: 1, shot: 3 },
  })
  await store.episodes.put({ ...episode, sceneOrder: ['s1'] })
  await store.scenes.put({ ...scene, shotOrder: shots.map((s) => s.id) })
  for (const s of shots) await store.shots.put(s)
  return { project, episode, scene, shots }
}

const candidate = (
  over: Partial<EntityCandidate> & { id: string; name: string },
): EntityCandidate => ({
  schemaVersion: SCHEMA_VERSIONS.candidate,
  projectId: 'p1',
  kind: 'character',
  aliases: [],
  shotIds: ['sh1', 'sh2'],
  variants: [],
  status: 'pending',
  extractedAt: 1,
  createdAt: 1,
  ...over,
})

describe('assets', () => {
  it('creates, lists, updates, and soft-deletes; enforces unique names', async () => {
    const h = await startServer()
    await seed(h)
    const a = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'character', name: '林夏', aliases: ['小夏'], appearance: '短发' },
    })
    expect(a.number).toBe(1)
    const b = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'location', name: '咖啡馆' },
    })
    expect(b.number).toBe(2)
    // 同类同名（规范化后）冲突
    const dup = await fail(
      h.client.call('assets.create', {
        params: { projectId: 'p1' },
        body: { kind: 'character', name: ' 林 夏 ' },
      }),
    )
    expect(dup.status).toBe(409)
    expect(dup.code).toBe('ASSET_NAME_TAKEN')
    // 不同类同名可以
    await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'prop', name: '林夏' },
    })
    const bad = await fail(
      h.client.call('assets.create', {
        params: { projectId: 'p1' },
        body: { kind: 'prop', name: 'a/b' },
      }),
    )
    expect(bad.status).toBe(400)
    expect(
      (
        await fail(
          h.client.call('assets.create', {
            params: { projectId: 'nope' },
            body: { kind: 'prop', name: 'x' },
          }),
        )
      ).status,
    ).toBe(404)

    const upd = await h.client.call('assets.update', {
      params: { assetId: a.id },
      body: { name: '林夏夏', appearance: null, styling: '风衣' },
    })
    expect(upd).toMatchObject({ name: '林夏夏', styling: '风衣' })
    expect(upd.appearance).toBeUndefined()
    expect(upd.aliases).toEqual(['小夏'])
    // 改成自己现有的名字不算冲突
    await h.client.call('assets.update', { params: { assetId: b.id }, body: { name: '咖啡馆' } })

    expect(
      (await h.client.call('assets.list', { params: { projectId: 'p1' } })).items,
    ).toHaveLength(3)
    await h.client.call('assets.delete', { params: { assetId: b.id } })
    expect(
      (await h.client.call('assets.list', { params: { projectId: 'p1' } })).items,
    ).toHaveLength(2)
    expect((await fail(h.client.call('assets.get', { params: { assetId: b.id } }))).status).toBe(
      404,
    )
  })

  it('refuses to delete an asset that shots still reference, and reports which', async () => {
    const h = await startServer()
    await seed(h)
    const a = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'character', name: '林夏' },
    })
    await h.server.ctx.store.shotRefs.replaceForShot('sh2', [{ shotId: 'sh2', assetId: a.id }])
    await h.server.ctx.store.shotRefs.replaceForShot('sh1', [{ shotId: 'sh1', assetId: a.id }])
    const got = await h.client.call('assets.get', { params: { assetId: a.id } })
    expect(got.usedByShotIds.sort()).toEqual(['sh1', 'sh2'])
    const err = await fail(h.client.call('assets.delete', { params: { assetId: a.id } }))
    expect(err.status).toBe(409)
    expect(err.code).toBe('ASSET_IN_USE')
    expect((err.details as { shotIds: string[] }).shotIds.sort()).toEqual(['sh1', 'sh2'])
    await h.server.ctx.store.shotRefs.replaceForShot('sh1', [])
    await h.server.ctx.store.shotRefs.replaceForShot('sh2', [])
    await h.client.call('assets.delete', { params: { assetId: a.id } })
  })

  it('uploads originals, sheets (registered as uploaded artifacts) and switches versions', async () => {
    const h = await startServer()
    await seed(h)
    const a = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'character', name: '林夏' },
    })
    const withOrig = await h.client.call('assets.uploadOriginal', {
      params: { assetId: a.id },
      form: form('o.png', png(1), 'image/png'),
    })
    expect(withOrig.originals).toHaveLength(1)
    expect(withOrig.originals[0]!.path).toMatch(/^originals\//)
    expect(
      (
        await fail(
          h.client.call('assets.uploadOriginal', {
            params: { assetId: a.id },
            form: form(
              'x.txt',
              new TextEncoder().encode('hello world, not an image at all, nope'),
              'image/png',
            ),
          }),
        )
      ).status,
    ).toBe(400)

    const s1 = await h.client.call('assets.uploadSheet', {
      params: { assetId: a.id },
      form: form('s1.png', png(2), 'image/png'),
    })
    expect(s1.sheet.versions).toHaveLength(1)
    expect(s1.sheet.versions[0]).toMatchObject({ source: 'uploaded', kind: 'image' })
    expect(s1.sheet.currentVersionId).toBe(s1.sheet.versions[0]!.id)
    const rec1 = await h.server.ctx.store.artifacts.get('p1', `asset_sheet:${a.id}`)
    expect(rec1).toMatchObject({ origin: 'uploaded', versionId: s1.sheet.currentVersionId })

    const s2 = await h.client.call('assets.uploadSheet', {
      params: { assetId: a.id },
      form: form('s2.png', png(3), 'image/png'),
    })
    expect(s2.sheet.versions).toHaveLength(2)
    const v1 = s2.sheet.versions[0]!.id
    const v2 = s2.sheet.versions[1]!.id
    expect(s2.sheet.currentVersionId).toBe(v2)
    // 文件按版本存放，旧版本仍可下载
    const res = await h.raw(`/api/projects/p1/files/${s2.sheet.versions[0]!.file.path}`)
    expect(res.status).toBe(200)

    const back = await h.client.call('assets.setCurrentSheet', {
      params: { assetId: a.id },
      body: { versionId: v1 },
    })
    expect(back.sheet.currentVersionId).toBe(v1)
    expect((await h.server.ctx.store.artifacts.get('p1', `asset_sheet:${a.id}`))?.versionId).toBe(
      v1,
    )
    expect(
      (
        await fail(
          h.client.call('assets.setCurrentSheet', {
            params: { assetId: a.id },
            body: { versionId: 'ver_nope' },
          }),
        )
      ).status,
    ).toBe(404)
  })

  it('stores a voice reference only for characters, and only audio', async () => {
    const h = await startServer()
    await seed(h)
    const c = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'character', name: '林夏' },
    })
    const loc = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'location', name: '咖啡馆' },
    })
    const audio = new Uint8Array([1, 2, 3, 4, 5, 6])
    const ok = await h.client.call('assets.uploadVoice', {
      params: { assetId: c.id },
      form: form('v.mp3', audio, 'audio/mpeg'),
    })
    expect(ok.voiceRef).toMatchObject({ mime: 'audio/mpeg', bytes: 6 })
    expect((await h.raw(`/api/projects/p1/files/${ok.voiceRef!.path}`)).status).toBe(200)
    expect(
      (
        await fail(
          h.client.call('assets.uploadVoice', {
            params: { assetId: c.id },
            form: form('v.exe', audio, 'application/octet-stream'),
          }),
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await fail(
          h.client.call('assets.uploadVoice', {
            params: { assetId: loc.id },
            form: form('v.mp3', audio, 'audio/mpeg'),
          }),
        )
      ).code,
    ).toBe('VOICE_NOT_ALLOWED')
  })
})

describe('variants', () => {
  it('creates variants only on characters, optionally tied to a costume asset', async () => {
    const h = await startServer()
    await seed(h)
    const c = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'character', name: '林夏' },
    })
    const prop = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'prop', name: '剑' },
    })
    const costume = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'costume', name: '红斗篷' },
    })

    const made = await h.client.call('variants.create', {
      params: { assetId: c.id },
      body: { name: '战斗装', description: '披着斗篷', costumeAssetId: costume.id },
    })
    expect(made.variants).toHaveLength(1)
    expect(made.variants[0]).toMatchObject({
      name: '战斗装',
      origin: 'edit',
      costumeAssetId: costume.id,
      editInstruction: '披着斗篷',
    })
    expect(
      (
        await fail(
          h.client.call('variants.create', {
            params: { assetId: c.id },
            body: { name: '战斗装', description: 'x' },
          }),
        )
      ).code,
    ).toBe('VARIANT_NAME_TAKEN')
    expect(
      (
        await fail(
          h.client.call('variants.create', {
            params: { assetId: prop.id },
            body: { name: '旧的', description: 'x' },
          }),
        )
      ).code,
    ).toBe('VARIANTS_ON_NON_CHARACTER')
    expect(
      (
        await fail(
          h.client.call('variants.create', {
            params: { assetId: c.id },
            body: { name: '错的', description: 'x', costumeAssetId: prop.id },
          }),
        )
      ).code,
    ).toBe('COSTUME_NOT_COSTUME_KIND')
    expect(
      (
        await fail(
          h.client.call('variants.create', {
            params: { assetId: c.id },
            body: { name: 'a/b', description: 'x' },
          }),
        )
      ).status,
    ).toBe(400)

    const upd = await h.client.call('variants.update', {
      params: { assetId: c.id, variantName: '战斗装' },
      body: { description: '换了描述', costumeAssetId: null },
    })
    expect(upd.variants[0]!.description).toBe('换了描述')
    expect(upd.variants[0]!.costumeAssetId).toBeUndefined()
    // 服装被变体关联时不能删
    await h.client.call('variants.update', {
      params: { assetId: c.id, variantName: '战斗装' },
      body: { costumeAssetId: costume.id },
    })
    expect(
      (await fail(h.client.call('assets.delete', { params: { assetId: costume.id } }))).code,
    ).toBe('ASSET_IN_USE')
  })

  it('renames a variant: shot refs and the sheet artifact follow; deleting an in-use variant is refused', async () => {
    const h = await startServer()
    await seed(h)
    const c = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'character', name: '林夏' },
    })
    await h.client.call('variants.create', {
      params: { assetId: c.id },
      body: { name: '冬装', description: '大衣' },
    })
    await h.client.call('assets.uploadSheet', {
      params: { assetId: c.id },
      form: form('w.png', png(9), 'image/png', { variantName: '冬装' }),
    })
    const store = h.server.ctx.store
    expect(await store.artifacts.get('p1', `variant_sheet:${c.id}/冬装`)).toMatchObject({
      origin: 'uploaded',
    })
    await store.shotRefs.replaceForShot('sh1', [
      { shotId: 'sh1', assetId: c.id, variantName: '冬装' },
    ])

    const renamed = await h.client.call('variants.update', {
      params: { assetId: c.id, variantName: '冬装' },
      body: { name: '冬季装' },
    })
    expect(renamed.variants.map((v) => v.name)).toEqual(['冬季装'])
    expect(renamed.variants[0]!.origin).toBe('upload')
    expect(await store.shotRefs.listByShot('sh1')).toEqual([
      { shotId: 'sh1', assetId: c.id, variantName: '冬季装' },
    ])
    expect(await store.artifacts.get('p1', `variant_sheet:${c.id}/冬装`)).toBeUndefined()
    expect(await store.artifacts.get('p1', `variant_sheet:${c.id}/冬季装`)).toBeDefined()

    const inUse = await fail(
      h.client.call('variants.delete', { params: { assetId: c.id, variantName: '冬季装' } }),
    )
    expect(inUse.code).toBe('VARIANT_IN_USE')
    await store.shotRefs.replaceForShot('sh1', [])
    const gone = await h.client.call('variants.delete', {
      params: { assetId: c.id, variantName: '冬季装' },
    })
    expect(gone.variants).toHaveLength(0)
    expect(await store.artifacts.get('p1', `variant_sheet:${c.id}/冬季装`)).toBeUndefined()
    expect(
      (
        await fail(
          h.client.call('variants.delete', { params: { assetId: c.id, variantName: '冬季装' } }),
        )
      ).status,
    ).toBe(404)
  })
})

describe('candidates', () => {
  it('lists with progress and confidence bands; accepts, links and ignores', async () => {
    const h = await startServer()
    await seed(h)
    const store = h.server.ctx.store
    const existing = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'character', name: '林夏' },
    })
    await store.candidates.put(
      candidate({ id: 'c1', name: '陈默', confidence: 0.95, appearance: '高个' }),
    )
    await store.candidates.put(
      candidate({ id: 'c2', name: '夏夏', aliases: ['小夏'], confidence: 0.6, shotIds: ['sh2'] }),
    )
    await store.candidates.put(
      candidate({ id: 'c3', name: '路人', confidence: 0.1, shotIds: ['sh3'] }),
    )
    await store.candidates.put(candidate({ id: 'c4', name: '林夏', shotIds: ['sh3'] }))

    const list = await h.client.call('candidates.list', { params: { projectId: 'p1' } })
    expect(list.items.map((c) => [c.id, c.confidenceBand])).toEqual([
      ['c1', 'high'],
      ['c2', 'medium'],
      ['c3', 'low'],
      ['c4', 'low'],
    ])
    expect(list.progress).toMatchObject({ total: 4, pending: 4, handled: 0 })
    const byEpisode = await h.client.call('candidates.list', {
      params: { projectId: 'p1' },
      query: { episodeId: 'e1' },
    })
    expect(byEpisode.items).toHaveLength(4)

    const acc = await h.client.call('candidates.accept', {
      params: { candidateId: 'c1' },
      body: {},
    })
    expect(acc.candidate).toMatchObject({ status: 'accepted_new', confidenceBand: 'high' })
    expect(acc.asset).toMatchObject({ name: '陈默', kind: 'character', appearance: '高个' })
    expect((await store.shotRefs.listByShot('sh1')).map((r) => r.assetId)).toContain(acc.asset!.id)
    expect(
      (await fail(h.client.call('candidates.accept', { params: { candidateId: 'c1' }, body: {} })))
        .code,
    ).toBe('CANDIDATE_ALREADY_HANDLED')
    // 同名资产已存在：要关联，不能再建一个
    expect(
      (await fail(h.client.call('candidates.accept', { params: { candidateId: 'c4' }, body: {} })))
        .code,
    ).toBe('ASSET_NAME_TAKEN')

    const linked = await h.client.call('candidates.link', {
      params: { candidateId: 'c2' },
      body: { assetId: existing.id },
    })
    expect(linked.candidate).toMatchObject({
      status: 'linked',
      linkedAssetId: existing.id,
      linkSource: 'manual',
    })
    expect(linked.asset!.aliases).toEqual(expect.arrayContaining(['夏夏', '小夏']))
    expect(
      (
        await fail(
          h.client.call('candidates.link', {
            params: { candidateId: 'c4' },
            body: { assetId: 'asset_nope' },
          }),
        )
      ).status,
    ).toBe(404)

    const ign = await h.client.call('candidates.ignore', { params: { candidateId: 'c3' } })
    expect(ign.candidate.status).toBe('ignored')

    const after = await h.client.call('candidates.list', {
      params: { projectId: 'p1' },
      query: { status: 'pending' },
    })
    expect(after.items.map((c) => c.id)).toEqual(['c4'])
    expect(after.progress).toMatchObject({
      total: 4,
      pending: 1,
      accepted_new: 1,
      linked: 1,
      ignored: 1,
      handled: 3,
    })
    // sh1 只涉及 c1（已处理）→ ready；sh3 还有待处理的 c4 → 不 ready
    expect((await store.shots.get('sh1'))!.ready).toBe(true)
    expect((await store.shots.get('sh3'))!.ready).toBe(false)
    expect(
      (
        await fail(
          h.client.call('candidates.accept', { params: { candidateId: 'nope' }, body: {} }),
        )
      ).status,
    ).toBe(404)
  })

  it('creates the selected variants when accepting', async () => {
    const h = await startServer()
    await seed(h)
    await h.server.ctx.store.candidates.put(
      candidate({
        id: 'c1',
        name: '陈默',
        variants: [
          { variantKey: '受伤', description: '额头流血', affectedShotIds: ['sh2'] },
          { variantKey: '西装', description: '正装', affectedShotIds: ['sh1'] },
        ],
      }),
    )
    const acc = await h.client.call('candidates.accept', {
      params: { candidateId: 'c1' },
      body: { createVariants: ['受伤'] },
    })
    expect(acc.asset!.variants.map((v) => v.name)).toEqual(['受伤'])
    expect((await h.server.ctx.store.shotRefs.listByShot('sh2'))[0]).toMatchObject({
      variantName: '受伤',
    })
  })

  it('undoes a link (auto or manual) and re-decides in one call', async () => {
    const h = await startServer()
    await seed(h)
    const store = h.server.ctx.store
    const a = await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'character', name: '林夏' },
    })
    // 模拟抽取时的自动关联：同名，linkSource=auto
    await store.candidates.put(
      candidate({
        id: 'c1',
        name: '林夏',
        aliases: ['夏'],
        status: 'linked',
        linkedAssetId: a.id,
        linkSource: 'auto',
        aliasesAdded: ['夏'],
        handledAt: 5,
      }),
    )
    await store.assets.put({ ...(await store.assets.get(a.id))!, aliases: ['夏'] })
    await store.shotRefs.replaceForShot('sh1', [{ shotId: 'sh1', assetId: a.id }])

    const listed = await h.client.call('candidates.list', { params: { projectId: 'p1' } })
    expect(listed.items[0]).toMatchObject({ status: 'linked', linkSource: 'auto' })

    const undone = await h.client.call('candidates.undoLink', {
      params: { candidateId: 'c1' },
      body: { then: { action: 'accept_new', name: '另一个林夏' } },
    })
    expect(undone.removedVariants).toEqual([])
    expect(undone.next?.candidate).toMatchObject({ status: 'accepted_new' })
    expect(undone.next?.asset).toMatchObject({ name: '另一个林夏' })
    expect(undone.candidate.status).toBe('accepted_new')
    // 原资产：别名还回去，引用没了
    expect((await store.assets.get(a.id))!.aliases).toEqual([])
    expect((await store.shotRefs.listByShot('sh1')).map((r) => r.assetId)).toEqual([
      undone.next!.asset!.id,
    ])

    // 没有 then：回到 pending
    await store.candidates.put(
      candidate({
        id: 'c2',
        name: '林夏',
        status: 'linked',
        linkedAssetId: a.id,
        linkSource: 'manual',
      }),
    )
    const reopened = await h.client.call('candidates.undoLink', {
      params: { candidateId: 'c2' },
      body: {},
    })
    expect(reopened.candidate.status).toBe('pending')
    expect(reopened.next).toBeUndefined()
    // 不是 linked 的不能撤销
    expect(
      (
        await fail(
          h.client.call('candidates.undoLink', { params: { candidateId: 'c2' }, body: {} }),
        )
      ).code,
    ).toBe('CANDIDATE_NOT_LINKED')
  })
})

describe('timeline', () => {
  it('creates the timeline on first read and appends revisions on update, with conflict detection', async () => {
    const h = await startServer()
    await seed(h)
    const v1 = await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    expect(v1.head).toBe(1)
    expect(v1.revision.content.clips.map((c) => c.shotId)).toEqual(['sh1', 'sh2', 'sh3'])
    expect(v1.revisions).toHaveLength(1)
    expect(v1.revisions[0]).not.toHaveProperty('content')
    // 没有视频：缺视频是阻断问题
    expect(v1.hasBlockingIssues).toBe(true)
    expect(v1.issues.some((i) => i.severity === 'blocking')).toBe(true)

    const [c1, c2, c3] = v1.revision.content.clips
    const v2 = await h.client.call('timeline.update', {
      params: { episodeId: 'e1' },
      body: {
        content: { clips: [c3!, c1!, { ...c2!, sourceVolume: 0.5, holdUs: 500_000 }], bgm: [] },
        summary: '调整顺序',
        baseRevision: 1,
      },
    })
    expect(v2.head).toBe(2)
    expect(v2.revision.number).toBe(2)
    expect(v2.revision.content.clips.map((c) => c.shotId)).toEqual(['sh3', 'sh1', 'sh2'])
    expect(v2.revision.summary).toBe('调整顺序')
    expect(v2.revision.changedClipIds).toEqual([c2!.id])
    expect(v2.revisions.map((r) => r.number)).toEqual([1, 2])

    // 读取旧修订
    const old = await h.client.call('timeline.get', {
      params: { episodeId: 'e1' },
      query: { revision: 1 },
    })
    expect(old.revision.number).toBe(1)
    expect(old.head).toBe(2)
    expect(
      (
        await fail(
          h.client.call('timeline.get', { params: { episodeId: 'e1' }, query: { revision: 99 } }),
        )
      ).status,
    ).toBe(404)

    // 基于过期修订 → 冲突
    const conflict = await fail(
      h.client.call('timeline.update', {
        params: { episodeId: 'e1' },
        body: { content: v1.revision.content, summary: 'x', baseRevision: 1 },
      }),
    )
    expect(conflict.status).toBe(409)
    expect(conflict.code).toBe('REVISION_CONFLICT')

    // 内容没变：不追加修订
    const same = await h.client.call('timeline.update', {
      params: { episodeId: 'e1' },
      body: { content: v2.revision.content, summary: '无变化' },
    })
    expect(same.head).toBe(2)

    // 回滚 = 追加新修订
    const rolled = await h.client.call('timeline.rollback', {
      params: { episodeId: 'e1' },
      body: { revision: 1 },
    })
    expect(rolled.head).toBe(3)
    expect(rolled.revision.restoredFrom).toBe(1)
    expect(rolled.revision.content.clips.map((c) => c.shotId)).toEqual(['sh1', 'sh2', 'sh3'])
    expect(
      (
        await fail(
          h.client.call('timeline.rollback', {
            params: { episodeId: 'e1' },
            body: { revision: 42 },
          }),
        )
      ).status,
    ).toBe(404)
  })

  it('exec 21: an automatic revision carries a machine-readable reason in the list and on the revision; others never do', async () => {
    const h = await startServer()
    await seed(h)
    const v1 = await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    const store = h.server.ctx.store
    const doc = (await store.timelines.listByProject('p1')).find((d) => d.episodeId === 'e1')!
    const clip = v1.revision.content.clips[0]!
    // what the pipeline appends when a shot first gets a video it cannot mute
    await store.timelines.put(
      appendRevision(doc, {
        content: {
          ...headRevision(doc).content,
          clips: headRevision(doc).content.clips.map((c) =>
            c.id === clip.id ? { ...c, sourceVolume: 0 } : c,
          ),
        },
        summary: '默认音量：测试',
        author: { kind: 'agent' },
        now: 5,
        changedClipIds: [clip.id],
        reason: 'native_audio_default',
      }),
    )
    const v2 = await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    expect(v2.head).toBe(2)
    expect(v2.revision.reason).toBe('native_audio_default')
    expect(v2.revision.author.kind).toBe('agent')
    expect(v2.revisions.map((r) => r.reason)).toEqual(['initial', 'native_audio_default'])
    // the user's own edit on top has no reason; the rollback is a system revision with its own
    const c = v2.revision.content.clips
    const v3 = await h.client.call('timeline.update', {
      params: { episodeId: 'e1' },
      body: {
        content: { clips: [{ ...c[0]!, sourceVolume: 0.7 }, ...c.slice(1)], bgm: [] },
        summary: '调音量',
        baseRevision: 2,
      },
    })
    expect(v3.revision).not.toHaveProperty('reason')
    const rolled = await h.client.call('timeline.rollback', {
      params: { episodeId: 'e1' },
      body: { revision: 2 },
    })
    expect(rolled.revision).toMatchObject({ reason: 'rollback', restoredFrom: 2 })
    expect(rolled.revisions.map((r) => r.reason)).toEqual([
      'initial',
      'native_audio_default',
      undefined,
      'rollback',
    ])
  })

  it('a timeline stored before the reason codes existed reads as before: no reason on any revision', async () => {
    const h = await startServer()
    await seed(h)
    const store = h.server.ctx.store
    await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    const doc = (await store.timelines.listByProject('p1')).find((d) => d.episodeId === 'e1')!
    // what the old code stored: the same revisions without the reason key
    const legacy = {
      ...doc,
      revisions: doc.revisions.map((r) => {
        const rest = { ...r }
        delete rest.reason
        return rest
      }),
    }
    await store.timelines.put(legacy)
    const v = await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    expect(v.revisions).toHaveLength(1)
    expect(v.revisions[0]).not.toHaveProperty('reason')
    expect(v.revision).not.toHaveProperty('reason')
    expect(v.revision.summary).toBe('初始时间线')
  })

  it('validates updates', async () => {
    const h = await startServer()
    await seed(h)
    const v = await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    const clips = v.revision.content.clips
    const put = (content: unknown) =>
      fail(
        h.client.call('timeline.update', {
          params: { episodeId: 'e1' },
          body: { content: content as never, summary: 's' },
        }),
      )
    expect((await put({ clips: [clips[0], clips[0]], bgm: [] })).code).toBe('INVALID_TIMELINE')
    expect((await put({ clips: [{ ...clips[0], shotId: 'other' }], bgm: [] })).code).toBe(
      'INVALID_TIMELINE',
    )
    expect((await put({ clips: [{ ...clips[0], holdUs: 1.5 }], bgm: [] })).code).toBe(
      'INVALID_TIMELINE',
    )
    expect(
      (
        await put({
          clips: [{ ...clips[0], trim: { inUs: 5, outUs: 5, basisVersionId: 'v' } }],
          bgm: [],
        })
      ).code,
    ).toBe('INVALID_TIMELINE')
    expect(
      (
        await put({
          clips: [{ ...clips[0], transitionToNext: { type: 'spin', durationUs: 1 } }],
          bgm: [],
        })
      ).code,
    ).toBe('INVALID_TIMELINE')
    expect(
      (
        await put({
          clips: [clips[0]],
          bgm: [
            {
              id: 'b1',
              bgmId: 'x',
              startUs: 0,
              inUs: 0,
              outUs: 0,
              volume: 0.2,
              fadeInUs: 0,
              fadeOutUs: 0,
            },
          ],
        })
      ).code,
    ).toBe('INVALID_TIMELINE')
    expect(
      (await fail(h.client.call('timeline.get', { params: { episodeId: 'nope' } }))).status,
    ).toBe(404)
  })

  it('syncs with the current shot order and uploads background music', async () => {
    const h = await startServer()
    const { shots } = await seed(h)
    const store = h.server.ctx.store
    const base = await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    // 新增一个镜头、删掉一个镜头
    const extra = createShot({ id: 'sh4', projectId: 'p1', sceneId: 's1', number: 4, now: 1 })
    await store.shots.put(extra)
    const scene = (await store.scenes.get('s1'))!
    await store.scenes.put({ ...scene, shotOrder: ['sh3', 'sh1', 'sh4'] })
    await store.shots.delete(shots[1]!.id)
    const synced = await h.client.call('timeline.sync', { params: { episodeId: 'e1' } })
    expect(synced.head).toBe(2)
    expect(synced.revision).toMatchObject({ reason: 'sync_shots', summary: '同步镜头顺序' })
    expect(synced.revisions.map((r) => r.reason)).toEqual(['initial', 'sync_shots'])
    expect(synced.revision.content.clips.map((c) => c.shotId)).toEqual(['sh3', 'sh1', 'sh4'])
    // 已有片段 id 保留，新增的不撞号
    const ids = synced.revision.content.clips.map((c) => c.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids).toContain(base.revision.content.clips[0]!.id)
    // 没变化时再同步不追加修订
    expect((await h.client.call('timeline.sync', { params: { episodeId: 'e1' } })).head).toBe(2)

    const up = await h.client.call('timeline.uploadBgm', {
      params: { episodeId: 'e1' },
      form: form('bgm.mp3', new Uint8Array(2048), 'audio/mpeg'),
    })
    expect(up.bytes).toBe(2048)
    expect(await h.server.ctx.files.exists('p1', `audio/bgm/${up.bgmId}`)).toBe(true)
    expect(
      (
        await fail(
          h.client.call('timeline.uploadBgm', {
            params: { episodeId: 'e1' },
            form: form('x.txt', new Uint8Array(10), 'text/plain'),
          }),
        )
      ).status,
    ).toBe(400)

    const withBgm = await h.client.call('timeline.update', {
      params: { episodeId: 'e1' },
      body: {
        content: {
          clips: synced.revision.content.clips,
          bgm: [
            {
              id: 'b1',
              bgmId: up.bgmId,
              startUs: 0,
              inUs: 0,
              outUs: 3_000_000,
              volume: 0.25,
              fadeInUs: 1_000_000,
              fadeOutUs: 1_000_000,
            },
          ],
        },
        summary: '加配乐',
      },
    })
    expect(withBgm.head).toBe(3)
    expect(withBgm.placement.bgm).toHaveLength(1)
    expect(withBgm.issues.some((i) => i.code === 'BGM_MISSING')).toBe(false)
    // 引用一个没上传过的配乐 → 读取时报缺失
    const ghost = await h.client.call('timeline.update', {
      params: { episodeId: 'e1' },
      body: {
        content: {
          clips: synced.revision.content.clips,
          bgm: [
            {
              id: 'b1',
              bgmId: 'bgm_ghost',
              startUs: 0,
              inUs: 0,
              outUs: 3_000_000,
              volume: 0.25,
              fadeInUs: 0,
              fadeOutUs: 0,
            },
          ],
        },
        summary: '幽灵配乐',
      },
    })
    expect(ghost.issues.some((i) => i.code === 'BGM_MISSING')).toBe(true)
  })

  it('announces changes on the event channel', async () => {
    const h = await startServer()
    await seed(h)
    const seen: string[] = []
    h.server.ctx.bus.subscribe((e) =>
      seen.push(
        e.event.type === 'data.changed' ? `${e.event.type}:${e.event.entity}` : e.event.type,
      ),
    )
    await h.client.call('assets.create', {
      params: { projectId: 'p1' },
      body: { kind: 'prop', name: '剑' },
    })
    await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    await h.client.call('timeline.sync', { params: { episodeId: 'e1' } })
    expect(seen).toContain('data.changed:asset')
  })
})
