import { beforeAll, describe, expect, it } from 'vitest'
import { evaluateTarget } from '../src/admission/index.ts'
import type { AdmissionContext, AdmissionTarget } from '../src/admission/index.ts'
import { loadCatalog } from '../src/data-dir.ts'
import type { ModelRegistry } from '../src/providers/catalog.ts'
import { frameWithRefsMode } from '../src/providers/catalog.ts'
import { makeWorld, putFile, slotWith, videoProvider } from './helpers.ts'
import type { World } from './helpers.ts'

let models: ModelRegistry
beforeAll(() => {
  models = loadCatalog().models
})

const ctxFor = async (w: World): Promise<AdmissionContext> => ({
  projection: await w.reload(),
  models,
  jobs: [],
  fileExists: (pid, path) => w.ports.files.exists(pid, path),
})
async function readyWorld() {
  const w = await makeWorld()
  const f = await putFile(w.ports, w.project.id, 'images/s1.png', 'frame')
  await w.ports.store.shots.put({
    ...(await w.ports.store.shots.get(w.shot.id))!,
    image: slotWith('image', 's1_v1', f),
  })
  return w
}
const ARK = videoProvider({
  id: 'p-ark',
  protocol: 'ark-video',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seedance-2-0-260128',
})
const KLING = videoProvider({
  id: 'p-kling',
  protocol: 'kling-contents',
  baseUrl: 'https://api-singapore.klingai.com',
  model: 'kling-4.0',
})
const WAN3 = videoProvider({
  id: 'p-wan3',
  protocol: 'dashscope-video',
  baseUrl: 'https://ws1.cn-beijing.maas.aliyuncs.com',
  model: 'wan3.0-video',
})
const OLD = videoProvider() // the tested 302.AI Wan Flash
const target = (
  w: World,
  provider = OLD,
  extra: Partial<AdmissionTarget> = {},
): AdmissionTarget => ({
  target: { kind: 'shot_video', shotId: w.shot.id },
  provider,
  ...extra,
})
const codes = (v: { reasons: Array<{ code: string }> }) => v.reasons.map((r) => r.code)
const warns = (v: { warnings: Array<{ code: string }> }) => v.warnings.map((r) => r.code)
const unverifiedKeys = (v: { unverified: Array<{ key: string }> }) =>
  v.unverified.map((u) => u.key).sort()

describe('default path (videoRefs off): nothing changes for the existing providers', () => {
  it('the tested Wan Flash preset is accepted exactly as before, with a strict first frame', async () => {
    const w = await readyWorld()
    const v = await evaluateTarget(await ctxFor(w), target(w))
    expect(v.status).toBe('accepted')
    expect(v.reasons).toEqual([])
    expect(v.warnings.map((x) => x.code)).toEqual([]) // 5 s shot on a 5 s model
    expect(v.unverified).toEqual([])
    expect(v.inputs?.references).toEqual([])
    expect(v.video).toMatchObject({
      mode: 'i2v',
      refsRequested: false,
      frame: 'strict_first_frame',
      referenceCount: 0,
      ifRefsOn: 'not_available', // the tested model takes no reference images
    })
  })

  it('a new model without refs: image to video needs the usual confirmation of unverified items only', async () => {
    const w = await readyWorld()
    const v = await evaluateTarget(await ctxFor(w), target(w, ARK))
    expect(v.status).toBe('needs_confirmation')
    expect(unverifiedKeys(v)).toEqual(['aspectRatio', 'duration', 'firstFrame', 'mode:i2v'])
    expect(v.video).toMatchObject({ frame: 'strict_first_frame', ifRefsOn: 'frame_as_reference' })
  })
})

describe('videoRefs on: the model decides what happens to the first frame', () => {
  it('Seedance / Wan 3.0 (mutually exclusive): the shot image becomes reference no. 1 and says so', async () => {
    const w = await readyWorld()
    for (const p of [ARK, WAN3]) {
      const v = await evaluateTarget(
        await ctxFor(w),
        target(w, p, { videoRefs: true, confirmUnverified: true }),
      )
      expect(v.status, p.model).toBe('accepted')
      expect(
        v.inputs?.references.map((r) => r.assetName),
        p.model,
      ).toEqual(['林夏', '老茶馆'])
      expect(warns(v), p.model).toContain('FIRST_FRAME_REPLACED_BY_REFERENCE')
      expect(v.video, p.model).toMatchObject({
        mode: 'omni_ref',
        refsRequested: true,
        frame: 'as_reference',
        ifRefsOn: 'frame_as_reference',
        referenceCount: 3, // two assets + the shot image
        droppedReferences: 0,
        firstFrameWithRefs: 'unsupported',
        refImages: 'unverified',
      })
    }
    // unconfirmed: the refs and mode are among the unverified items, but no first frame is needed
    const pending = await evaluateTarget(await ctxFor(w), target(w, ARK, { videoRefs: true }))
    expect(pending.status).toBe('needs_confirmation')
    expect(unverifiedKeys(pending)).toContain('mode:omni_ref')
    expect(unverifiedKeys(pending)).toContain('refImages')
    expect(unverifiedKeys(pending)).not.toContain('firstFrame')
    expect(unverifiedKeys(pending)).not.toContain('firstFrameWithRefs')
  })

  it('Kling (frame and references together): the frame is kept; the unverified combination needs confirmation', async () => {
    const w = await readyWorld()
    const pending = await evaluateTarget(await ctxFor(w), target(w, KLING, { videoRefs: true }))
    expect(pending.status).toBe('needs_confirmation')
    expect(unverifiedKeys(pending)).toEqual(
      expect.arrayContaining(['firstFrame', 'firstFrameWithRefs', 'refImages', 'mode:omni_ref']),
    )
    const ok = await evaluateTarget(
      await ctxFor(w),
      target(w, KLING, { videoRefs: true, confirmUnverified: true }),
    )
    expect(ok.status).toBe('accepted')
    expect(warns(ok)).not.toContain('FIRST_FRAME_REPLACED_BY_REFERENCE')
    expect(ok.video).toMatchObject({
      frame: 'with_references',
      referenceCount: 2,
      ifRefsOn: 'frame_with_references',
    })
  })

  it('a model that takes no reference images blocks the request, with the usual code', async () => {
    const w = await readyWorld()
    const v = await evaluateTarget(await ctxFor(w), target(w, OLD, { videoRefs: true }))
    expect(v.status).toBe('blocked')
    expect(codes(v)).toContain('REFERENCE_NOT_SUPPORTED')
  })

  it('references over the model limit are trimmed (the shot image takes one of the slots on mutually exclusive models)', async () => {
    const w = await readyWorld()
    const tiny = videoProvider({
      id: 'p-tiny',
      protocol: 'ark-video',
      model: 'doubao-seedance-2-0-260128',
      capabilityOverrides: { refImages: { support: 'unverified', value: 2 } },
    })
    const v = await evaluateTarget(
      await ctxFor(w),
      target(w, tiny, { videoRefs: true, confirmUnverified: true }),
    )
    expect(v.inputs?.references.map((r) => r.assetName)).toEqual(['林夏']) // 2 slots - 1 for the shot image
    expect(v.inputs?.trimmed.map((r) => r.assetName)).toEqual(['老茶馆'])
    expect(warns(v)).toContain('REFS_TRIMMED')
    expect(v.video).toMatchObject({ referenceCount: 2, droppedReferences: 1 })
  })

  it('a shot with no registered assets: refs "on" falls back to the first frame and says so', async () => {
    const w = await readyWorld()
    await w.ports.store.shotRefs.replaceForShot(w.shot.id, [])
    await w.ports.store.shots.put({
      ...(await w.ports.store.shots.get(w.shot.id))!,
      prompts: { keyFrame: 'x', video: '镜头缓慢推近' },
    })
    const v = await evaluateTarget(
      await ctxFor(w),
      target(w, ARK, { videoRefs: true, confirmUnverified: true }),
    )
    expect(v.status).toBe('accepted')
    expect(warns(v)).toContain('VIDEO_REFS_EMPTY')
    expect(v.video).toMatchObject({
      mode: 'i2v',
      refsRequested: true,
      frame: 'strict_first_frame',
      referenceCount: 0,
    })
  })

  it('an asset without a sheet blocks the request only when references are on', async () => {
    const w = await makeWorld({ sheets: false })
    const f = await putFile(w.ports, w.project.id, 'images/s1.png', 'frame')
    await w.ports.store.shots.put({
      ...(await w.ports.store.shots.get(w.shot.id))!,
      image: slotWith('image', 's1_v1', f),
    })
    const on = await evaluateTarget(
      await ctxFor(w),
      target(w, ARK, { videoRefs: true, confirmUnverified: true }),
    )
    expect(codes(on)).toContain('ASSET_SHEET_MISSING')
    const off = await evaluateTarget(await ctxFor(w), target(w, ARK, { confirmUnverified: true }))
    expect(codes(off)).not.toContain('ASSET_SHEET_MISSING')
  })
})

describe('the audio that cannot be switched off', () => {
  async function worldWith(narration: string | undefined, dialogue: boolean) {
    const w = await readyWorld()
    const shot = (await w.ports.store.shots.get(w.shot.id))!
    await w.ports.store.shots.put({
      ...shot,
      narration,
      dialogue: dialogue ? [{ speakerAssetId: w.hero.id, text: '你来了。' } as never] : [],
    })
    return w
  }

  it('warns for a shot that does not want native voice (narration by TTS)', async () => {
    const w = await worldWith('旁白', false)
    const v = await evaluateTarget(await ctxFor(w), target(w, KLING, { confirmUnverified: true }))
    expect(warns(v)).toContain('AUDIO_NOT_DISABLEABLE')
    expect(v.status).toBe('accepted') // a warning, not a block
  })

  it('does not warn when the shot wants native voice, nor for models that can switch it off', async () => {
    const dialogue = await worldWith(undefined, true)
    expect(
      warns(
        await evaluateTarget(
          await ctxFor(dialogue),
          target(dialogue, KLING, { confirmUnverified: true }),
        ),
      ),
    ).not.toContain('AUDIO_NOT_DISABLEABLE')
    const narr = await worldWith('旁白', false)
    expect(
      warns(
        await evaluateTarget(await ctxFor(narr), target(narr, ARK, { confirmUnverified: true })),
      ),
    ).not.toContain('AUDIO_NOT_DISABLEABLE')
    expect(warns(await evaluateTarget(await ctxFor(narr), target(narr, OLD)))).not.toContain(
      'AUDIO_NOT_DISABLEABLE',
    )
  })
})

describe('frameWithRefsMode', () => {
  it('only "unsupported" (also the default) means the shot image becomes a reference', () => {
    const base = models.lookup({
      protocol: 'ark-video',
      model: 'doubao-seedance-2-0-260128',
    }).capability
    expect(frameWithRefsMode(base)).toBe('as_reference')
    expect(frameWithRefsMode({ ...base, firstFrameWithRefs: undefined })).toBe('as_reference')
    expect(frameWithRefsMode({ ...base, firstFrameWithRefs: 'unverified' })).toBe('with_references')
    expect(frameWithRefsMode({ ...base, firstFrameWithRefs: 'supported' })).toBe('with_references')
  })
})
