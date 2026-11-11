import { describe, expect, it } from 'vitest'
import {
  buildExpectations,
  buildRecord,
  computeDigest,
  downstreamOf,
  evaluateArtifacts,
} from '../src/artifacts/index.ts'
import type { ArtifactKey, ArtifactStatus } from '../src/artifacts/index.ts'
import { appendVersion, createAsset, currentVersion, emptySlot } from '../src/domain/index.ts'
import type { Asset, Shot } from '../src/domain/index.ts'
import { digestOf } from '../src/util/canonical.ts'
import { makeWorld, putFile, slotWith } from './helpers.ts'
import type { World } from './helpers.ts'

/** 给 shot 一张图和一个视频，并把所有产物按“当前期望”登记（模拟一次完整生成之后）。 */
async function produceEverything(w: World) {
  for (const s of [w.shot, w.shot2]) {
    const shot = (await w.ports.store.shots.get(s.id))!
    const img = await putFile(w.ports, w.project.id, `images/${s.id}/v1.png`, `img-${s.id}`)
    const vid = await putFile(
      w.ports,
      w.project.id,
      `videos/${s.id}/v1.mp4`,
      `vid-${s.id}`,
      'video/mp4',
    )
    await w.ports.store.shots.put({
      ...shot,
      image: slotWith('image', `${s.id}_i1`, img),
      video: slotWith('video', `${s.id}_v1`, vid),
    })
  }
  for (const kind of ['asset_sheet', 'shot_image', 'shot_video', 'shot_audio'] as const)
    await registerKind(w, kind)
}

/** 按依赖顺序登记某一类产物（上游先于下游）。 */
async function registerKind(
  w: World,
  kind: 'asset_sheet' | 'variant_sheet' | 'shot_image' | 'shot_video' | 'shot_audio',
) {
  const p = await w.reload()
  const exps = buildExpectations(p)
  for (const exp of exps.values()) {
    if (exp.kind !== kind) continue
    await registerOne(w, exp.key)
  }
}

async function registerOne(
  w: World,
  key: ArtifactKey,
  origin: 'generated' | 'uploaded' = 'generated',
) {
  const p = await w.reload()
  const exp = buildExpectations(p).get(key)!
  const file = fileFor(p, key)
  const rec = buildRecord({
    projectId: w.project.id,
    expectation: exp,
    upstreamRecords: p.artifacts,
    file,
    versionId: versionIdFor(p, key),
    origin,
    now: 10,
  })
  await w.ports.store.artifacts.put(rec)
}

function versionIdFor(
  p: Awaited<ReturnType<World['reload']>>,
  key: ArtifactKey,
): string | undefined {
  const [kind, owner] = key.split(':') as [string, string]
  if (kind === 'asset_sheet') return p.assets.get(owner)!.sheet.currentVersionId ?? undefined
  if (kind === 'variant_sheet') {
    const [aid, vname] = owner.split('/')
    return (
      p.assets.get(aid)!.variants.find((v) => v.name === vname)!.sheet.currentVersionId ?? undefined
    )
  }
  const shot = p.shots.get(owner)
  if (kind === 'shot_image') return shot?.image.currentVersionId ?? undefined
  if (kind === 'shot_video') return shot?.video.currentVersionId ?? undefined
  return undefined
}

function fileFor(p: Awaited<ReturnType<World['reload']>>, key: ArtifactKey) {
  const [kind, owner] = key.split(':') as [string, string]
  if (kind === 'asset_sheet') return currentVersion(p.assets.get(owner)!.sheet)!.file
  if (kind === 'variant_sheet') {
    const [aid, vname] = owner.split('/')
    return currentVersion(p.assets.get(aid)!.variants.find((v) => v.name === vname)!.sheet)!.file
  }
  const shot = p.shots.get(owner)!
  if (kind === 'shot_image') return currentVersion(shot.image)!.file
  if (kind === 'shot_video') return currentVersion(shot.video)!.file
  return {
    path: `audio/${owner}/n1.mp3`,
    mime: 'audio/mpeg',
    bytes: 1,
    sha256: digestOf(`audio-${owner}`),
  }
}

async function statuses(w: World, audio?: Parameters<typeof evaluateArtifacts>[1]) {
  const report = evaluateArtifacts(await w.reload(), audio)
  return {
    report,
    of: (key: ArtifactKey): ArtifactStatus => report.get(key)!.status,
  }
}

const sheet = (a: Asset) => `asset_sheet:${a.id}`
const img = (s: Shot) => `shot_image:${s.id}`
const vid = (s: Shot) => `shot_video:${s.id}`
const aud = (s: Shot) => `shot_audio:${s.id}`

describe('artifact manifest: status is derived, never stored', () => {
  it('everything is missing before anything is registered, and current right after registering', async () => {
    const w = await makeWorld()
    const before = await statuses(w)
    expect(before.of(sheet(w.hero))).toBe('missing')
    await produceEverything(w)
    const after = await statuses(w)
    for (const [key, r] of after.report) expect(r.status, key).toBe('current')
  })

  it('a registered record carries basis digest, content hash and the upstream hashes it was made from', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    const p = await w.reload()
    const rec = p.artifacts.get(img(w.shot))!
    expect(rec.basisDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(rec.contentHash).toBe(rec.file.sha256)
    expect(Object.keys(rec.upstream).sort()).toEqual([sheet(w.hero), sheet(w.place)].sort())
    expect(rec.upstream[sheet(w.hero)]).toBe(p.artifacts.get(sheet(w.hero))!.contentHash)
  })

  it('digests ignore key order', () => {
    expect(digestOf({ a: 1, b: { c: 2, d: [1, { x: 1, y: 2 }] } })).toBe(
      digestOf({ b: { d: [1, { y: 2, x: 1 }], c: 2 }, a: 1 }),
    )
    expect(digestOf({ a: 1, b: undefined })).toBe(digestOf({ a: 1 }))
  })

  it('refuses to register an artifact whose required upstream has no record', async () => {
    const w = await makeWorld()
    const p = await w.reload()
    const exp = buildExpectations(p).get(img(w.shot))!
    expect(computeDigest(exp, p.artifacts)).toBeUndefined()
    expect(() =>
      buildRecord({
        projectId: w.project.id,
        expectation: exp,
        upstreamRecords: p.artifacts,
        file: w.hero.sheet.versions[0].file,
        now: 1,
      }),
    ).toThrow(/required upstream/)
  })
})

describe('staleness propagation: an upstream change marks downstream stale, nothing regenerates', () => {
  it('editing an asset description makes its sheet stale and flags the shots that use it', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    await w.ports.store.assets.put({ ...w.hero, appearance: '短发，红色外套' })
    const s = await statuses(w)
    expect(s.of(sheet(w.hero))).toBe('stale')
    expect(s.report.get(sheet(w.hero))).toMatchObject({ reason: 'basis_changed' })
    // 其他资产的图不受影响
    expect(s.of(sheet(w.place))).toBe('current')
    // 用到它的镜头图：自身依据没变（还没重生资产图），但被标出“上游已过期”
    expect(s.of(img(w.shot))).toBe('current')
    expect(s.report.get(img(w.shot))!.staleUpstream).toEqual([sheet(w.hero)])
    expect(s.report.get(img(w.shot2))!.staleUpstream).toEqual([sheet(w.hero)])
    expect(s.report.get(vid(w.shot))!.staleUpstream).toEqual([]) // 视频直接上游是镜头图，镜头图本身仍是 current
  })

  it('regenerating the sheet (new file) makes every shot image that used it stale, then their videos once the images are regenerated', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    // 重生资产图：追加新版本（旧版本保留）并重新登记
    const f2 = await putFile(w.ports, w.project.id, `images/${w.hero.id}/v2.png`, 'sheet-林夏-v2')
    await w.ports.store.assets.put({
      ...w.hero,
      sheet: appendVersion(w.hero.sheet, {
        id: `${w.hero.id}_v2`,
        kind: 'image',
        file: f2,
        source: 'generated',
        createdAt: 2,
      }),
    })
    await registerOne(w, sheet(w.hero))
    let s = await statuses(w)
    expect(s.of(sheet(w.hero))).toBe('current')
    expect(s.of(img(w.shot))).toBe('stale')
    expect(s.report.get(img(w.shot))).toMatchObject({ reason: 'upstream_changed' })
    expect(s.of(img(w.shot2))).toBe('stale')
    expect(s.of(vid(w.shot))).toBe('current') // 镜头图还没重生，视频仍对得上它所依据的那张图
    expect(s.report.get(vid(w.shot))!.staleUpstream).toEqual([img(w.shot)])

    // 重生镜头图 → 视频过期；另一个镜头不受影响（它不用那个角色之外的东西？它也用 hero，所以也 stale）
    const shot = (await w.ports.store.shots.get(w.shot.id))!
    const f3 = await putFile(w.ports, w.project.id, `images/${shot.id}/v2.png`, 'img-new')
    await w.ports.store.shots.put({
      ...shot,
      image: appendVersion(shot.image, {
        id: `${shot.id}_i2`,
        kind: 'image',
        file: f3,
        source: 'generated',
        createdAt: 3,
      }),
    })
    await registerOne(w, img(w.shot))
    s = await statuses(w)
    expect(s.of(img(w.shot))).toBe('current')
    expect(s.of(vid(w.shot))).toBe('stale')
    expect(s.report.get(vid(w.shot))).toMatchObject({ reason: 'upstream_changed' })
    expect(s.of(vid(w.shot2))).toBe('current')
  })

  it('stale artifacts are only reported — evaluating never writes anything or creates jobs', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    await w.ports.store.assets.put({ ...w.hero, appearance: 'changed' })
    const before = JSON.stringify(await w.ports.store.artifacts.listByProject(w.project.id))
    await statuses(w)
    expect(JSON.stringify(await w.ports.store.artifacts.listByProject(w.project.id))).toBe(before)
    expect(await w.ports.store.jobs.list()).toEqual([])
    expect(w.ports.events.events).toEqual([])
  })

  it('editing a shot prompt makes that shot image stale (and not the other shot)', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    const shot = (await w.ports.store.shots.get(w.shot.id))!
    await w.ports.store.shots.put({
      ...shot,
      prompts: { ...shot.prompts, keyFrame: shot.prompts.keyFrame + ', rain' },
    })
    const s = await statuses(w)
    expect(s.of(img(w.shot))).toBe('stale')
    expect(s.report.get(img(w.shot))).toMatchObject({ reason: 'basis_changed' })
    expect(s.of(img(w.shot2))).toBe('current')
  })

  it('changing the project style makes generated sheets and shot images stale', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    await w.ports.store.projects.put({
      ...w.project,
      style: { ...w.project.style, source: 'custom', imageKeywords: 'ink wash painting' },
    })
    const s = await statuses(w)
    expect(s.of(sheet(w.hero))).toBe('stale')
    expect(s.of(img(w.shot))).toBe('stale')
  })

  it('changing the project aspect ratio makes images and videos stale', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    await w.ports.store.projects.put({ ...w.project, aspectRatio: '16:9' })
    const s = await statuses(w)
    expect(s.of(img(w.shot))).toBe('stale')
    expect(s.of(vid(w.shot))).toBe('stale')
  })
})

describe('what does NOT go into the basis (changing it must not cause repeat spending)', () => {
  it('video/image bases hold content only: no provider, model, credentials, resolution, seed or audio toggle', async () => {
    const w = await makeWorld()
    const exps = buildExpectations(await w.reload())
    const basisKeys = (k: ArtifactKey) => Object.keys(exps.get(k)!.basis as object).sort()
    expect(basisKeys(vid(w.shot))).toEqual(['aspect', 'durationSec', 'movement', 'prompt'])
    expect(basisKeys(img(w.shot))).toEqual(['aspect', 'prompt', 'refs', 'style'])
    const text = JSON.stringify(
      [...exps.values()].filter((e) => e.kind !== 'shot_audio').map((e) => e.basis),
    )
    for (const word of [
      'provider',
      'model',
      'apiKey',
      'seed',
      'resolution',
      'withAudio',
      'renderer',
    ]) {
      expect(text).not.toContain(word)
    }
  })

  it('narration audio is the opposite: voice, speed and provider ARE in the basis', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    const a1 = { provider: 'p', model: 'tts-1', voice: 'alloy', speed: 1 }
    // 以 a1 登记旁白音频
    const p = await w.reload()
    const exp = buildExpectations(p, { audio: a1 }).get(aud(w.shot))!
    await w.ports.store.artifacts.put(
      buildRecord({
        projectId: w.project.id,
        expectation: exp,
        upstreamRecords: p.artifacts,
        file: fileFor(p, aud(w.shot)),
        now: 1,
      }),
    )
    expect((await statuses(w, { audio: a1 })).of(aud(w.shot))).toBe('current')
    expect((await statuses(w, { audio: { ...a1, voice: 'nova' } })).of(aud(w.shot))).toBe('stale')
    expect((await statuses(w, { audio: { ...a1, speed: 1.2 } })).of(aud(w.shot))).toBe('stale')
    expect((await statuses(w, { audio: { ...a1, provider: 'other' } })).of(aud(w.shot))).toBe(
      'stale',
    )
    // 旁白文字变了
    const shot = (await w.ports.store.shots.get(w.shot.id))!
    await w.ports.store.shots.put({ ...shot, narration: '全新的旁白' })
    expect((await statuses(w, { audio: a1 })).of(aud(w.shot))).toBe('stale')
  })

  it('shots without narration have no audio artifact to track', async () => {
    const w = await makeWorld()
    await w.ports.store.shots.put({ ...w.shot, narration: undefined })
    const exps = buildExpectations(await w.reload())
    expect(exps.has(aud(w.shot))).toBe(false)
    expect(exps.has(aud(w.shot2))).toBe(true)
  })
})

describe('uploaded artifacts are taken as finished work', () => {
  it('an uploaded sheet does not go stale when the description or style changes', async () => {
    const w = await makeWorld()
    const uploaded = await putFile(
      w.ports,
      w.project.id,
      `images/${w.hero.id}/up.png`,
      'my own drawing',
    )
    await w.ports.store.assets.put({
      ...w.hero,
      sheet: slotWith('image', 'up1', uploaded, 'uploaded'),
    })
    await registerOne(w, sheet(w.hero), 'uploaded')
    await w.ports.store.assets.put({
      ...(await w.ports.store.assets.get(w.hero.id))!,
      appearance: 'totally different',
    })
    await w.ports.store.projects.put({
      ...w.project,
      style: { ...w.project.style, imageKeywords: 'neon' },
    })
    expect((await statuses(w)).of(sheet(w.hero))).toBe('current')
  })
})

describe('variants (A3 layer 5 / A7)', () => {
  const withVariants = async (w: World, origin: 'edit' | 'upload') => {
    const f = await putFile(w.ports, w.project.id, `images/${w.hero.id}/var.png`, 'variant image')
    await w.ports.store.assets.put({
      ...w.hero,
      variants: [
        {
          name: '婚纱',
          description: '白色婚纱',
          origin,
          editInstruction: '换成白色婚纱',
          sheet: slotWith('image', 'var1', f, origin === 'upload' ? 'uploaded' : 'generated'),
        },
      ],
    })
    await registerOne(w, sheet(w.hero))
    await registerOne(
      w,
      `variant_sheet:${w.hero.id}/婚纱`,
      origin === 'upload' ? 'uploaded' : 'generated',
    )
  }
  const regenBase = async (w: World) => {
    const hero = (await w.ports.store.assets.get(w.hero.id))!
    const f2 = await putFile(w.ports, w.project.id, `images/${w.hero.id}/v2.png`, 'sheet-v2')
    await w.ports.store.assets.put({
      ...hero,
      sheet: appendVersion(hero.sheet, {
        id: 'v2',
        kind: 'image',
        file: f2,
        source: 'generated',
        createdAt: 2,
      }),
    })
    await registerOne(w, sheet(w.hero))
  }

  it('an edit-derived variant goes stale when the base sheet is regenerated — and is not regenerated', async () => {
    const w = await makeWorld()
    await withVariants(w, 'edit')
    expect((await statuses(w)).of(`variant_sheet:${w.hero.id}/婚纱`)).toBe('current')
    await regenBase(w)
    const s = await statuses(w)
    expect(s.of(`variant_sheet:${w.hero.id}/婚纱`)).toBe('stale')
    expect(s.report.get(`variant_sheet:${w.hero.id}/婚纱`)).toMatchObject({
      reason: 'upstream_changed',
    })
    expect(await w.ports.store.jobs.list()).toEqual([])
  })

  it('an uploaded variant is finished work and never goes stale with the base', async () => {
    const w = await makeWorld()
    await withVariants(w, 'upload')
    await regenBase(w)
    expect((await statuses(w)).of(`variant_sheet:${w.hero.id}/婚纱`)).toBe('current')
  })

  it('a shot that mentions a variant depends on the variant sheet, not the base', async () => {
    const w = await makeWorld()
    await withVariants(w, 'edit')
    const shot = (await w.ports.store.shots.get(w.shot.id))!
    await w.ports.store.shots.put({
      ...shot,
      prompts: { keyFrame: `@{${w.hero.id}/婚纱} 在 @{${w.place.id}}` },
    })
    await w.ports.store.shotRefs.replaceForShot(shot.id, [
      { shotId: shot.id, assetId: w.hero.id, variantName: '婚纱' },
      { shotId: shot.id, assetId: w.place.id },
    ])
    const exp = buildExpectations(await w.reload()).get(img(w.shot))!
    expect(exp.upstream).toEqual([`variant_sheet:${w.hero.id}/婚纱`, sheet(w.place)])
  })
})

describe('blocked', () => {
  it('shot image is blocked when an asset it needs was deleted or has no sheet — same verdict as admission', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    await w.ports.store.assets.put({ ...w.place, deletedAt: 9 })
    const s = await statuses(w)
    expect(s.of(img(w.shot))).toBe('blocked')
    expect(s.of(img(w.shot2))).toBe('current')
  })

  it('shot video is blocked without a shot image', async () => {
    const w = await makeWorld()
    expect((await statuses(w)).of(vid(w.shot))).toBe('blocked')
  })
})

describe('downstreamOf', () => {
  it('lists the transitive downstream of an artifact', async () => {
    const w = await makeWorld()
    const exps = buildExpectations(await w.reload())
    expect(downstreamOf(exps, sheet(w.hero)).sort()).toEqual(
      [img(w.shot), vid(w.shot), img(w.shot2), vid(w.shot2)].sort(),
    )
    expect(downstreamOf(exps, sheet(w.prop)).sort()).toEqual([img(w.shot2), vid(w.shot2)].sort())
    expect(downstreamOf(exps, vid(w.shot))).toEqual([])
  })

  it('emptySlot assets have no sheet to depend on', () => {
    expect(emptySlot().currentVersionId).toBeNull()
  })
})

describe('stale reasons: which input or upstream changed, from which version to which', () => {
  it('names the changed input field when the artifact itself was edited', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    await w.ports.store.assets.put({ ...w.hero, appearance: '短发，红色外套' })
    const r = (await statuses(w)).report.get(sheet(w.hero))!
    expect(r.status).toBe('stale')
    expect(r.changes).toEqual([{ kind: 'input', field: 'appearance' }])
  })

  it('reports every changed input field, not just the first', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    const shot = (await w.ports.store.shots.get(w.shot.id))!
    await w.ports.store.shots.put({ ...shot, prompts: { keyFrame: 'a totally new prompt' } })
    await w.ports.store.projects.put({ ...w.project, aspectRatio: '16:9' })
    const r = (await statuses(w)).report.get(img(w.shot))!
    expect(
      r.changes
        .filter((c) => c.kind === 'input')
        .map((c) => (c as { field: string }).field)
        .sort(),
    ).toEqual(['aspect', 'prompt'])
  })

  it('names the upstream asset and the version it moved from and to', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    const before = (await w.reload()).artifacts.get(sheet(w.hero))!
    const f2 = await putFile(w.ports, w.project.id, `images/${w.hero.id}/v2.png`, 'sheet-林夏-v2')
    await w.ports.store.assets.put({
      ...w.hero,
      sheet: appendVersion(w.hero.sheet, {
        id: `${w.hero.id}_v2`,
        kind: 'image',
        file: f2,
        source: 'generated',
        createdAt: 2,
      }),
    })
    await registerOne(w, sheet(w.hero))
    const after = (await w.reload()).artifacts.get(sheet(w.hero))!
    const r = (await statuses(w)).report.get(img(w.shot))!
    expect(r.status).toBe('stale')
    expect(r.reason).toBe('upstream_changed')
    expect(r.changes).toEqual([
      {
        kind: 'upstream',
        key: sheet(w.hero),
        label: '林夏',
        from: { versionId: `${w.hero.id}_v1`, contentHash: before.contentHash },
        to: { versionId: `${w.hero.id}_v2`, contentHash: after.contentHash },
      },
    ])
  })

  it('reports a dependency that was added or removed (from/to = null)', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    // 去掉对地点的引用、新增对道具的引用
    const shot = (await w.ports.store.shots.get(w.shot.id))!
    await w.ports.store.shots.put({
      ...shot,
      prompts: { keyFrame: `@{${w.hero.id}} 拿着 @{${w.prop.id}}` },
    })
    await w.ports.store.shotRefs.replaceForShot(shot.id, [
      { shotId: shot.id, assetId: w.hero.id },
      { shotId: shot.id, assetId: w.prop.id },
    ])
    await registerOne(w, sheet(w.prop))
    const r = (await statuses(w)).report.get(img(w.shot))!
    const ups = r.changes.filter((c) => c.kind === 'upstream') as Array<
      Extract<(typeof r.changes)[number], { kind: 'upstream' }>
    >
    expect(ups.find((c) => c.key === sheet(w.place))).toMatchObject({ label: '老茶馆', to: null })
    expect(ups.find((c) => c.key === sheet(w.place))?.from).not.toBeNull()
    expect(ups.find((c) => c.key === sheet(w.prop))).toMatchObject({ label: '青瓷杯', from: null })
    expect(r.changes.some((c) => c.kind === 'input' && c.field === 'prompt')).toBe(true)
  })

  it('has no changes unless the artifact is stale', async () => {
    const w = await makeWorld()
    expect([...(await statuses(w)).report.values()].every((r) => r.changes.length === 0)).toBe(true)
    await produceEverything(w)
    expect([...(await statuses(w)).report.values()].every((r) => r.changes.length === 0)).toBe(true)
  })

  it('labels shots by title or number', async () => {
    const w = await makeWorld()
    await produceEverything(w)
    const s1 = (await w.ports.store.shots.get(w.shot.id))!
    const f = await putFile(w.ports, w.project.id, `images/${s1.id}/v2.png`, 'new')
    await w.ports.store.shots.put({
      ...s1,
      title: '雨中相遇',
      image: appendVersion(s1.image, {
        id: 'i2',
        kind: 'image',
        file: f,
        source: 'generated',
        createdAt: 5,
      }),
    })
    await registerOne(w, img(w.shot))
    const r = (await statuses(w)).report.get(vid(w.shot))!
    expect(r.changes).toMatchObject([
      {
        kind: 'upstream',
        key: img(w.shot),
        label: '雨中相遇',
        from: { versionId: `${w.shot.id}_i1` },
        to: { versionId: 'i2' },
      },
    ])
    // 没标题 → “镜头 N”
    const r2 = (await statuses(w)).report.get(vid(w.shot2))!
    expect(r2.changes).toEqual([])
  })
})

describe('costume linked to a variant (A1: costume = reusable garment; variant = a character look)', () => {
  const setup = async (w: World, opts: { costumeSheet: boolean }) => {
    let costume = createAsset({
      id: 'asset_cos',
      projectId: w.project.id,
      number: 8,
      kind: 'costume',
      name: '红嫁衣',
      now: 1,
      description: '红色织锦嫁衣，金线刺绣',
    })
    if (opts.costumeSheet) {
      const f = await putFile(w.ports, w.project.id, 'images/asset_cos/v1.png', 'costume-sheet')
      costume = { ...costume, sheet: slotWith('image', 'cos_v1', f) }
    }
    await w.ports.store.assets.put(costume)
    const vf = await putFile(w.ports, w.project.id, `images/${w.hero.id}/var.png`, 'variant image')
    await w.ports.store.assets.put({
      ...w.hero,
      variants: [
        {
          name: '新娘',
          description: '新娘装扮',
          origin: 'edit',
          editInstruction: '换上嫁衣',
          costumeAssetId: 'asset_cos',
          sheet: slotWith('image', 'var1', vf),
        },
      ],
    })
    return costume
  }

  it('a variant depends on the base sheet (required) and the linked costume sheet (optional); the costume text is part of its basis', async () => {
    const w = await makeWorld()
    await setup(w, { costumeSheet: true })
    const exp = buildExpectations(await w.reload()).get(`variant_sheet:${w.hero.id}/新娘`)!
    expect(exp.upstream).toEqual([sheet(w.hero), 'asset_sheet:asset_cos'])
    expect(exp.requiredUpstream).toEqual([sheet(w.hero)])
    expect(JSON.stringify(exp.basis)).toContain('红色织锦嫁衣')
  })

  it('editing the costume makes the variant stale, and says it was the costume that changed', async () => {
    const w = await makeWorld()
    await setup(w, { costumeSheet: true })
    await registerOne(w, sheet(w.hero))
    await registerOne(w, 'asset_sheet:asset_cos')
    await registerOne(w, `variant_sheet:${w.hero.id}/新娘`)
    expect((await statuses(w)).of(`variant_sheet:${w.hero.id}/新娘`)).toBe('current')
    const cos = (await w.ports.store.assets.get('asset_cos'))!
    await w.ports.store.assets.put({ ...cos, description: '蓝色长裙' })
    const r = (await statuses(w)).report.get(`variant_sheet:${w.hero.id}/新娘`)!
    expect(r.status).toBe('stale')
    expect(r.changes).toEqual([{ kind: 'input', field: 'instruction' }])
  })

  it('a variant that is not linked to a costume is unaffected by costumes', async () => {
    const w = await makeWorld()
    await setup(w, { costumeSheet: true })
    const hero = (await w.ports.store.assets.get(w.hero.id))!
    await w.ports.store.assets.put({
      ...hero,
      variants: [{ ...hero.variants[0], costumeAssetId: undefined }],
    })
    const exp = buildExpectations(await w.reload()).get(`variant_sheet:${w.hero.id}/新娘`)!
    expect(exp.upstream).toEqual([sheet(w.hero)])
  })
})

describe('project narration voice (project-level setting)', () => {
  it('changing the project narration voice makes the generated narration audio stale', async () => {
    const w = await makeWorld()
    await w.ports.store.projects.put({
      ...w.project,
      narrationVoice: { providerConfigId: 'tts-1', voice: 'alloy', speed: 1 },
    })
    await produceEverything(w)
    expect((await statuses(w)).of(aud(w.shot))).toBe('current')
    const p = (await w.ports.store.projects.get(w.project.id))!
    await w.ports.store.projects.put({
      ...p,
      narrationVoice: { providerConfigId: 'tts-1', voice: 'nova', speed: 1 },
    })
    const r = (await statuses(w)).report.get(aud(w.shot))!
    expect(r.status).toBe('stale')
    expect(r.changes).toEqual([{ kind: 'input', field: 'audio' }])
    // 视频和图不受影响
    expect((await statuses(w)).of(vid(w.shot))).toBe('current')
  })
})
