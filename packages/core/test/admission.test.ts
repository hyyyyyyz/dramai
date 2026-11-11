import { beforeAll, describe, expect, it } from 'vitest'
import { admitBatch, evaluateTarget, preflight, submitBatch } from '../src/admission/index.ts'
import type { AdmissionContext, AdmissionTarget } from '../src/admission/index.ts'
import { loadCatalog } from '../src/data-dir.ts'
import { createAsset, currentVersion } from '../src/domain/index.ts'
import { resolveInputs } from '../src/generation/inputs.ts'
import { JobQueue } from '../src/jobs/index.ts'
import type { Job } from '../src/jobs/index.ts'
import type { ModelRegistry } from '../src/providers/catalog.ts'
import { imageProvider, makeWorld, putFile, slotWith, videoProvider } from './helpers.ts'
import type { World } from './helpers.ts'

let models: ModelRegistry
beforeAll(() => {
  models = loadCatalog().models
})

async function ctxFor(w: World, jobs: Job[] = []): Promise<AdmissionContext> {
  return {
    projection: await w.reload(),
    models,
    jobs,
    fileExists: (pid, path) => w.ports.files.exists(pid, path),
  }
}

const shotImage = (
  w: World,
  provider = imageProvider(),
  extra: Partial<AdmissionTarget> = {},
): AdmissionTarget => ({
  target: { kind: 'shot_image', shotId: w.shot.id },
  provider,
  ...extra,
})

async function giveShotAnImage(w: World, shotId = w.shot.id) {
  const shot = (await w.ports.store.shots.get(shotId))!
  const f = await putFile(w.ports, w.project.id, `images/${shotId}/v1.png`, `img-${shotId}`)
  await w.ports.store.shots.put({ ...shot, image: slotWith('image', `${shotId}_v1`, f) })
}

const codes = (v: { reasons: Array<{ code: string }> }) => v.reasons.map((r) => r.code)

describe('single-target admission (A2)', () => {
  it('accepts a complete shot and resolves references in order of first mention', async () => {
    const w = await makeWorld()
    const v = await evaluateTarget(await ctxFor(w), shotImage(w))
    expect(v.status).toBe('accepted')
    expect(v.reasons).toEqual([])
    expect(v.inputs?.references.map((r) => [r.index, r.assetName, r.role])).toEqual([
      [1, '林夏', 'character'],
      [2, '老茶馆', 'location'],
    ])
    expect(v.inputs?.aspectRatio).toBe('9:16')
  })

  it('blocks a reference to an asset that is not registered (or was deleted)', async () => {
    const w = await makeWorld()
    await w.ports.store.assets.put({ ...w.place, deletedAt: 5 })
    const v = await evaluateTarget(await ctxFor(w), shotImage(w))
    expect(v.status).toBe('blocked')
    expect(v.reasons).toContainEqual(
      expect.objectContaining({ code: 'ASSET_NOT_REGISTERED', assetId: w.place.id }),
    )
  })

  it('blocks a mention in the prompt of an id that was never registered', async () => {
    const w = await makeWorld()
    await w.ports.store.shots.put({ ...w.shot, prompts: { keyFrame: '@{ghost} 出现' } })
    const v = await evaluateTarget(await ctxFor(w), shotImage(w))
    expect(codes(v)).toContain('ASSET_NOT_REGISTERED')
  })

  it('blocks an asset without a sheet — user originals do NOT stand in for the sheet', async () => {
    const w = await makeWorld()
    const original = await putFile(w.ports, w.project.id, 'materials/hero.png', 'user-photo')
    const noSheet = createAsset({
      id: 'asset_x',
      projectId: w.project.id,
      number: 9,
      kind: 'character',
      name: '无图',
      now: 1,
    })
    await w.ports.store.assets.put({ ...noSheet, originals: [original] })
    await w.ports.store.shotRefs.replaceForShot(w.shot.id, [
      { shotId: w.shot.id, assetId: 'asset_x' },
    ])
    await w.ports.store.shots.put({ ...w.shot, prompts: { keyFrame: '@{asset_x}' } })
    const v = await evaluateTarget(await ctxFor(w), shotImage(w))
    expect(v.status).toBe('blocked')
    expect(codes(v)).toContain('ASSET_SHEET_MISSING')
    expect(v.inputs?.references).toEqual([])
  })

  it('rejects when a declared input cannot be read (sheet file lost)', async () => {
    const w = await makeWorld()
    const sheet = currentVersion(w.hero.sheet)!
    w.ports.files.lose(w.project.id, sheet.file.path)
    const v = await evaluateTarget(await ctxFor(w), shotImage(w))
    expect(v.status).toBe('blocked')
    expect(v.reasons).toContainEqual(
      expect.objectContaining({ code: 'FILE_UNREADABLE', assetId: w.hero.id }),
    )
  })

  it('blocks an empty prompt (editing is never blocked, spending is)', async () => {
    const w = await makeWorld()
    await w.ports.store.shots.put({ ...w.shot, prompts: {} })
    expect(codes(await evaluateTarget(await ctxFor(w), shotImage(w)))).toContain('PROMPT_EMPTY')
  })

  it('fails explicitly — no silent downgrade to text-to-image — when the model cannot take references', async () => {
    const w = await makeWorld()
    const seedream = imageProvider({
      id: 'seedream',
      protocol: 'openai-images',
      model: 'doubao-seedream-5-0-260128',
      baseUrl: 'https://api.302.ai/doubao',
    })
    const v = await evaluateTarget(await ctxFor(w), shotImage(w, seedream))
    expect(v.status).toBe('blocked')
    const reason = v.reasons.find((r) => r.code === 'REFERENCE_NOT_SUPPORTED')
    expect(reason?.message).toContain('doubao-seedream-5-0-260128')
    // 没有角色/资产引用的镜头在同一个模型上不受影响
    await w.ports.store.shots.put({ ...w.shot2, prompts: { keyFrame: 'an empty teahouse' } })
    await w.ports.store.shotRefs.replaceForShot(w.shot2.id, [])
    const v2 = await evaluateTarget(await ctxFor(w), {
      target: { kind: 'shot_image', shotId: w.shot2.id },
      provider: { ...seedream, acceptedUnverified: ['aspectRatio'] },
    })
    expect(v2.status).toBe('accepted')
  })

  it('an unknown model: primary mode is assumed, everything else is "unverified" and needs confirmation — never silently allowed or borrowed from a similar model', async () => {
    const w = await makeWorld()
    const custom = imageProvider({ model: 'my-custom-model', acceptedUnverified: [] })
    const v = await evaluateTarget(await ctxFor(w), shotImage(w, custom))
    expect(v.status).toBe('needs_confirmation')
    expect(codes(v)).toEqual(['UNVERIFIED_NEEDS_CONFIRMATION'])
    expect(v.unverified.map((u) => u.key).sort()).toEqual(['aspectRatio', 'mode:i2i', 'refImages'])
    expect(v.unverified[0].message).toContain('没有能力画像')
    // 一次性确认 → 放行，警告保留
    const confirmed = await evaluateTarget(await ctxFor(w), {
      ...shotImage(w, custom),
      confirmUnverified: true,
    })
    expect(confirmed.status).toBe('accepted')
    expect(confirmed.warnings.map((x) => x.code)).toContain('CAPABILITY_UNVERIFIED')
    // 用户显式声明能力后不再需要确认
    const declared = imageProvider({
      model: 'my-custom-model',
      acceptedUnverified: [],
      capabilityOverrides: {
        modes: { t2i: 'supported', i2i: 'supported' },
        refImages: { support: 'supported', value: 4 },
        aspectRatios: { support: 'supported', value: ['9:16', '16:9', '1:1'] },
      },
    })
    expect((await evaluateTarget(await ctxFor(w), shotImage(w, declared))).status).toBe('accepted')
  })

  it('trims references over the model limit by priority and warns', async () => {
    const w = await makeWorld()
    // 4 个引用，nano banana 上限 3：说话的角色 > 道具 > 地点 > 其余
    const extra = createAsset({
      id: 'asset_e',
      projectId: w.project.id,
      number: 7,
      kind: 'character',
      name: '路人',
      now: 1,
    })
    const f = await putFile(w.ports, w.project.id, 'images/asset_e/v1.png', 'e')
    await w.ports.store.assets.put({ ...extra, sheet: slotWith('image', 'e_v1', f) })
    await w.ports.store.shots.put({
      ...w.shot,
      dialogue: [{ speakerAssetId: 'asset_e', text: '你好' }],
      prompts: { keyFrame: `@{${w.hero.id}} @{${w.place.id}} @{${w.prop.id}} @{asset_e}` },
    })
    const v = await evaluateTarget(await ctxFor(w), shotImage(w))
    expect(v.status).toBe('accepted')
    expect(v.warnings.map((x) => x.code)).toContain('REFS_TRIMMED')
    expect(v.inputs?.references).toHaveLength(3)
    expect(v.inputs?.trimmed.map((r) => r.role)).toEqual(['location']) // 地点优先级最低（说话人 > 其余人物 > 道具 > 地点）
    // 保留下来的仍按提示词里首次出现的顺序编号
    expect(v.inputs?.references.map((r) => [r.index, r.assetName])).toEqual([
      [1, '林夏'],
      [2, '青瓷杯'],
      [3, '路人'],
    ])
  })

  it('rejects disabled providers and providers of the wrong kind', async () => {
    const w = await makeWorld()
    const off = await evaluateTarget(
      await ctxFor(w),
      shotImage(w, imageProvider({ enabled: false })),
    )
    expect(codes(off)).toContain('PROVIDER_DISABLED')
    const wrong = await evaluateTarget(await ctxFor(w), shotImage(w, videoProvider()))
    expect(codes(wrong)).toContain('PROVIDER_KIND_MISMATCH')
  })

  it('checks the aspect ratio against the model unless it follows the source image', async () => {
    const w = await makeWorld()
    const narrow = imageProvider({
      capabilityOverrides: {
        modes: { t2i: 'supported', i2i: 'supported' },
        refImages: { support: 'supported', value: 3 },
        aspectRatios: { support: 'supported', value: ['16:9'] },
      },
    })
    expect(codes(await evaluateTarget(await ctxFor(w), shotImage(w, narrow)))).toContain(
      'ASPECT_UNSUPPORTED',
    )
  })

  it('provides a cost estimate from the price table, and "unpriced" when unknown', async () => {
    const w = await makeWorld()
    await giveShotAnImage(w)
    const priced = await evaluateTarget(await ctxFor(w), shotImage(w))
    expect(priced.estimate).toMatchObject({ priced: true, currency: 'PTC', approx: true })
    const video = await evaluateTarget(await ctxFor(w), {
      target: { kind: 'shot_video', shotId: w.shot.id },
      provider: videoProvider(),
      resolution: '720P',
    })
    expect(video.status).toBe('accepted')
    expect(video.estimate).toMatchObject({ priced: true, amount: 0.2 }) // 0.04 PTC/s × 5 s
    const seedance = videoProvider({
      protocol: 'volcengine-video',
      model: 'doubao-seedance-2-0-fast-260128',
    })
    const unpriced = await evaluateTarget(await ctxFor(w), {
      target: { kind: 'shot_video', shotId: w.shot.id },
      provider: seedance,
      resolution: '720p',
    })
    expect(unpriced.estimate).toMatchObject({ priced: false })
  })
})

describe('video and audio targets', () => {
  it('blocks video without a start frame, accepts with one', async () => {
    const w = await makeWorld()
    const target: AdmissionTarget = {
      target: { kind: 'shot_video', shotId: w.shot.id },
      provider: videoProvider(),
    }
    expect(codes(await evaluateTarget(await ctxFor(w), target))).toContain('START_FRAME_MISSING')
    await giveShotAnImage(w)
    const ok = await evaluateTarget(await ctxFor(w), target)
    expect(ok.status).toBe('accepted')
    expect(ok.inputs?.startFrame?.role).toBe('start_frame')
  })

  it('rejects a lost start-frame file', async () => {
    const w = await makeWorld()
    await giveShotAnImage(w)
    w.ports.files.lose(w.project.id, `images/${w.shot.id}/v1.png`)
    const v = await evaluateTarget(await ctxFor(w), {
      target: { kind: 'shot_video', shotId: w.shot.id },
      provider: videoProvider(),
    })
    expect(codes(v)).toContain('FILE_UNREADABLE')
  })

  it('warns when the shot duration is not a supported step; the executor will snap it', async () => {
    const w = await makeWorld()
    await giveShotAnImage(w)
    await w.ports.store.shots.put({
      ...(await w.ports.store.shots.get(w.shot.id))!,
      durationSec: 8,
    })
    const v = await evaluateTarget(await ctxFor(w), {
      target: { kind: 'shot_video', shotId: w.shot.id },
      provider: videoProvider(),
    })
    expect(v.status).toBe('accepted')
    expect(v.warnings.find((x) => x.code === 'DURATION_SNAPPED')?.message).toContain('5s')
  })

  const video = (w: World, extra: Partial<AdmissionTarget> = {}): AdmissionTarget => ({
    target: { kind: 'shot_video', shotId: w.shot.id },
    provider: videoProvider(),
    ...extra,
  })
  const mkJob = (w: World, over: Partial<Job>): Job => ({
    schemaVersion: 1,
    id: 'job_x',
    type: 'video',
    operation: 'shot_video',
    projectId: w.project.id,
    shotId: w.shot.id,
    params: {},
    paid: true,
    status: 'queued',
    attempt: 1,
    previousProviderJobIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  })

  it('allows only one in-flight video job per shot', async () => {
    const w = await makeWorld()
    await giveShotAnImage(w)
    for (const status of ['queued', 'running'] as const) {
      const v = await evaluateTarget(await ctxFor(w, [mkJob(w, { status })]), video(w))
      expect(codes(v)).toContain('IN_FLIGHT_CONFLICT')
    }
    // 别的镜头的在途任务不相干
    const other = await evaluateTarget(
      await ctxFor(w, [mkJob(w, { shotId: w.shot2.id })]),
      video(w),
    )
    expect(other.status).toBe('accepted')
  })

  it('after a failure that kept the upstream id, "resume" must come first; regenerating needs confirmation', async () => {
    const w = await makeWorld()
    await giveShotAnImage(w)
    const failed = mkJob(w, {
      status: 'failed',
      providerJobId: 'up-1',
      error: { category: 'delivery_failed', code: 'X', message: 'm', recoverable: true },
    })
    const v = await evaluateTarget(await ctxFor(w, [failed]), video(w))
    expect(codes(v)).toContain('RECOVER_ORIGINAL_FIRST')
    const confirmed = await evaluateTarget(
      await ctxFor(w, [failed]),
      video(w, { confirmResubmit: true }),
    )
    expect(confirmed.status).toBe('accepted')
    // 上游确认生成失败的，直接重试没问题
    const upstreamFailed = mkJob(w, {
      status: 'failed',
      providerJobId: 'up-1',
      error: { category: 'generation_failed', code: 'X', message: 'm', recoverable: false },
    })
    expect((await evaluateTarget(await ctxFor(w, [upstreamFailed]), video(w))).status).toBe(
      'accepted',
    )
  })

  it('narration audio needs narration text and a tts provider', async () => {
    const w = await makeWorld()
    const tts = {
      id: 'tts',
      label: 'TTS',
      kind: 'tts' as const,
      protocol: 'openai-tts' as const,
      baseUrl: 'https://x',
      model: 'tts-1',
      enabled: true,
    }
    const ok = await evaluateTarget(await ctxFor(w), {
      target: { kind: 'shot_audio', shotId: w.shot.id },
      provider: tts,
    })
    expect(ok.status).toBe('accepted')
    await w.ports.store.shots.put({ ...w.shot, narration: '  ' })
    const v = await evaluateTarget(await ctxFor(w), {
      target: { kind: 'shot_audio', shotId: w.shot.id },
      provider: tts,
    })
    expect(codes(v)).toContain('NARRATION_EMPTY')
  })

  it('asset sheets: variants derive from the base sheet by an edit (the only reference)', async () => {
    const w = await makeWorld()
    const withVariant = {
      ...w.hero,
      variants: [
        {
          name: '婚纱',
          description: '白色婚纱',
          origin: 'edit' as const,
          editInstruction: '换成白色婚纱',
          sheet: { currentVersionId: null, versions: [] },
        },
      ],
    }
    await w.ports.store.assets.put(withVariant)
    const v = await evaluateTarget(await ctxFor(w), {
      target: { kind: 'asset_sheet', assetId: w.hero.id, variantName: '婚纱' },
      provider: imageProvider(),
    })
    expect(v.status).toBe('accepted')
    expect(v.inputs?.prompt).toBe('换成白色婚纱')
    expect(v.inputs?.references.map((r) => r.assetName)).toEqual(['林夏'])
    // 本体没有资产图 → 无法派生
    const bare = { ...withVariant, sheet: { currentVersionId: null, versions: [] } }
    await w.ports.store.assets.put(bare)
    expect(
      codes(
        await evaluateTarget(await ctxFor(w), {
          target: { kind: 'asset_sheet', assetId: w.hero.id, variantName: '婚纱' },
          provider: imageProvider(),
        }),
      ),
    ).toContain('BASE_SHEET_MISSING')
    // 不存在的变体
    expect(
      codes(
        await evaluateTarget(await ctxFor(w), {
          target: { kind: 'asset_sheet', assetId: w.hero.id, variantName: '不存在' },
          provider: imageProvider(),
        }),
      ),
    ).toContain('VARIANT_NOT_FOUND')
  })
})

describe('batch admission is all-or-nothing', () => {
  const t = (_w: World, shotId: string): AdmissionTarget => ({
    target: { kind: 'shot_image', shotId },
    provider: imageProvider(),
  })

  it('one bad target blocks the whole batch; the good ones are told who blocked them', async () => {
    const w = await makeWorld()
    // 第二镜引用的道具没有资产图
    await w.ports.store.assets.put({ ...w.prop, sheet: { currentVersionId: null, versions: [] } })
    const shot3 = { ...w.shot, id: 'shot_3', number: 3 }
    await w.ports.store.shots.put(shot3)
    const batch = await admitBatch(await ctxFor(w), [
      t(w, w.shot.id),
      t(w, w.shot2.id),
      t(w, 'shot_3'),
    ])
    expect(batch.ok).toBe(false)
    const [a, b, c] = batch.results
    expect(b.status).toBe('blocked')
    expect(codes(b)).toContain('ASSET_SHEET_MISSING')
    for (const r of [a, c]) {
      expect(r.status).toBe('blocked_by_batch')
      expect(r.blockedBy).toEqual([`shot_image:${w.shot2.id}`])
      expect(codes(r)).toEqual(['BLOCKED_BY_BATCH'])
    }
  })

  it('submitBatch creates zero jobs when anything is blocked', async () => {
    const w = await makeWorld()
    await w.ports.store.assets.put({ ...w.prop, sheet: { currentVersionId: null, versions: [] } })
    const queue = new JobQueue({ jobs: w.ports.store.jobs, clock: w.ports.clock, ids: w.ports.ids })
    const res = await submitBatch(await ctxFor(w), queue, [t(w, w.shot.id), t(w, w.shot2.id)])
    expect(res.succeeded).toEqual([])
    expect(res.blocked.map((b) => b.targetId).sort()).toEqual(
      [`shot_image:${w.shot.id}`, `shot_image:${w.shot2.id}`].sort(),
    )
    expect(await w.ports.store.jobs.list()).toHaveLength(0)
  })

  it('submitBatch creates one job per target with the batch id and a frozen provider snapshot', async () => {
    const w = await makeWorld()
    const queue = new JobQueue({ jobs: w.ports.store.jobs, clock: w.ports.clock, ids: w.ports.ids })
    const res = await submitBatch(await ctxFor(w), queue, [t(w, w.shot.id), t(w, w.shot2.id)], {
      batchId: 'batch_1',
    })
    expect(res.requested).toEqual([`shot_image:${w.shot.id}`, `shot_image:${w.shot2.id}`])
    expect(res.succeeded).toHaveLength(2)
    expect(res.failed).toEqual([])
    const jobs = await w.ports.store.jobs.list()
    expect(jobs.map((j) => j.batchId)).toEqual(['batch_1', 'batch_1'])
    expect(jobs[0]).toMatchObject({
      type: 'image',
      operation: 'shot_image',
      paid: true,
      shotId: w.shot.id,
      providerLabel: 'Nano Banana',
      providerSnapshot: {
        providerConfigId: 'prov-img',
        protocol: 'gemini-image',
        baseUrl: 'https://api.302.ai',
        model: 'gemini-2.5-flash-image',
      },
    })
    // 同一输入再提交一次 → 去重到在途任务，不会重复计费
    const again = await submitBatch(await ctxFor(w), queue, [t(w, w.shot.id)])
    expect(again.succeeded[0]).toMatchObject({ deduped: true, jobId: jobs[0].id })
    expect(await w.ports.store.jobs.list()).toHaveLength(2)
  })

  it('does not roll back jobs created before an enqueue failure; the rest report ENQUEUE_ABORTED', async () => {
    const w = await makeWorld()
    const real = new JobQueue({ jobs: w.ports.store.jobs, clock: w.ports.clock, ids: w.ports.ids })
    let n = 0
    const flaky = {
      enqueue: async (j: Parameters<JobQueue['enqueue']>[0]) => {
        if (++n === 2) throw new Error('db down')
        return real.enqueue(j)
      },
    }
    const shot3 = { ...w.shot, id: 'shot_3', number: 3 }
    await w.ports.store.shots.put(shot3)
    const res = await submitBatch(await ctxFor(w), flaky, [
      t(w, w.shot.id),
      t(w, w.shot2.id),
      t(w, 'shot_3'),
    ])
    expect(res.succeeded).toHaveLength(1)
    expect(res.failed.map((f) => f.reason.code)).toEqual(['ENQUEUE_FAILED', 'ENQUEUE_ABORTED'])
    expect(await w.ports.store.jobs.list()).toHaveLength(1)
  })

  it('rejects duplicate targets inside one batch', async () => {
    const w = await makeWorld()
    const batch = await admitBatch(await ctxFor(w), [t(w, w.shot.id), t(w, w.shot.id)])
    expect(batch.ok).toBe(false)
    expect(codes(batch.results[1])).toContain('DUPLICATE_TARGET')
  })

  it('an empty batch is trivially ok', async () => {
    const w = await makeWorld()
    expect(await admitBatch(await ctxFor(w), [])).toEqual({ ok: true, results: [] })
  })
})

describe('one shared computation of the inputs', () => {
  it('admission, the executor and prompt preview all see exactly the same resolved inputs', async () => {
    const w = await makeWorld()
    const ctx = await ctxFor(w)
    const verdict = await evaluateTarget(ctx, shotImage(w))
    // 执行器/预览直接调同一个函数（相同的模型上限参数）
    const fromExecutor = resolveInputs(
      ctx.projection,
      { kind: 'shot_image', shotId: w.shot.id },
      { maxRefImages: 3 },
    )
    expect(verdict.inputs).toEqual(fromExecutor)
  })
})

describe('unverified capabilities: neither blocked nor silently allowed', () => {
  const banana = (accepted: string[] = []) => imageProvider({ acceptedUnverified: accepted })
  const target = (
    w: World,
    provider = banana(),
    shotId = w.shot.id,
    extra: Partial<AdmissionTarget> = {},
  ): AdmissionTarget => ({
    target: { kind: 'shot_image', shotId },
    provider,
    ...extra,
  })

  it('needs confirmation when the model has an unverified capability this shot needs', async () => {
    const w = await makeWorld()
    const v = await evaluateTarget(await ctxFor(w), target(w))
    expect(v.status).toBe('needs_confirmation')
    expect(codes(v)).toEqual(['UNVERIFIED_NEEDS_CONFIRMATION'])
    expect(v.unverified.map((u) => [u.key, u.confirmed])).toEqual([
      ['mode:i2i', false],
      ['refImages', false],
      ['aspectRatio', false],
    ])
    expect(v.estimate).toBeDefined() // 仍然给出预估，界面可以一起展示
  })

  it('only the capabilities the shot actually needs are checked', async () => {
    const w = await makeWorld()
    await w.ports.store.shots.put({ ...w.shot2, prompts: { keyFrame: 'an empty teahouse' } })
    await w.ports.store.shotRefs.replaceForShot(w.shot2.id, [])
    const v = await evaluateTarget(await ctxFor(w), target(w, banana(), w.shot2.id))
    expect(v.unverified.map((u) => u.key)).toEqual(['aspectRatio']) // 没有参考图，就不管参考图验没验证过
  })

  it('a one-off confirmation lets it through and keeps the warning', async () => {
    const w = await makeWorld()
    const v = await evaluateTarget(
      await ctxFor(w),
      target(w, banana(), w.shot.id, { confirmUnverified: true }),
    )
    expect(v.status).toBe('accepted')
    expect(v.warnings.filter((x) => x.code === 'CAPABILITY_UNVERIFIED')).toHaveLength(3)
    expect(v.unverified.every((u) => u.confirmed)).toBe(true)
  })

  it('a remembered acceptance on the provider config is per capability item', async () => {
    const w = await makeWorld()
    const partial = await evaluateTarget(
      await ctxFor(w),
      target(w, banana(['refImages', 'aspectRatio'])),
    )
    expect(partial.status).toBe('needs_confirmation')
    expect(partial.unverified.filter((u) => !u.confirmed).map((u) => u.key)).toEqual(['mode:i2i'])
    const all = await evaluateTarget(
      await ctxFor(w),
      target(w, banana(['mode:i2i', 'refImages', 'aspectRatio'])),
    )
    expect(all.status).toBe('accepted')
  })

  it('"unsupported" always wins over "unverified": no confirmation can unblock it', async () => {
    const w = await makeWorld()
    const seedream = imageProvider({
      id: 's',
      protocol: 'openai-images',
      model: 'doubao-seedream-5-0-260128',
      baseUrl: 'https://api.302.ai/doubao',
      acceptedUnverified: [],
    })
    const v = await evaluateTarget(await ctxFor(w), {
      ...target(w, seedream),
      confirmUnverified: true,
    })
    expect(v.status).toBe('blocked')
    expect(codes(v)).toContain('REFERENCE_NOT_SUPPORTED')
    expect(codes(v)).not.toContain('UNVERIFIED_NEEDS_CONFIRMATION')
  })

  it('verified models need no confirmation at all (Wan Flash video)', async () => {
    const w = await makeWorld()
    await giveShotAnImage(w)
    const v = await evaluateTarget(await ctxFor(w), {
      target: { kind: 'shot_video', shotId: w.shot.id },
      provider: videoProvider(),
      resolution: '720P',
    })
    expect(v.status).toBe('accepted')
    expect(v.unverified).toEqual([])
    expect(v.warnings).toEqual([])
  })

  it('unverified duration steps are reported on video', async () => {
    const w = await makeWorld()
    await giveShotAnImage(w)
    const plus = videoProvider({ model: 'wan2.2-i2v-plus', acceptedUnverified: [] })
    const v = await evaluateTarget(await ctxFor(w), {
      target: { kind: 'shot_video', shotId: w.shot.id },
      provider: plus,
      resolution: '480P',
    })
    expect(v.status).toBe('needs_confirmation')
    expect(v.unverified.map((u) => u.key).sort()).toEqual(
      ['duration', 'mode:i2v', 'firstFrame', 'resolution'].sort(),
    )
  })

  it('batch: an unconfirmed target holds back the whole batch; confirming releases all of it', async () => {
    const w = await makeWorld()
    const queue = new JobQueue({ jobs: w.ports.store.jobs, clock: w.ports.clock, ids: w.ports.ids })
    const items = [
      target(w, banana(['mode:i2i', 'refImages', 'aspectRatio']), w.shot.id),
      target(w, banana(), w.shot2.id),
    ]
    const held = await submitBatch(await ctxFor(w), queue, items)
    expect(held.succeeded).toEqual([])
    expect(await w.ports.store.jobs.list()).toHaveLength(0)
    const [a, b] = held.admission.results
    expect(b.status).toBe('needs_confirmation')
    expect(a.status).toBe('blocked_by_batch')
    expect(a.blockedBy).toEqual([`shot_image:${w.shot2.id}`])
    const released = await submitBatch(await ctxFor(w), queue, items, { confirmUnverified: true })
    expect(released.succeeded).toHaveLength(2)
  })
})

describe('preflight is read-only (A13 / design 4.12 #1)', () => {
  const deepFreeze = <T>(o: T): T => {
    if (o && typeof o === 'object') {
      Object.freeze(o)
      for (const v of o instanceof Map ? [...o.values()] : Object.values(o)) deepFreeze(v)
    }
    return o
  }

  it('creates no jobs, writes nothing, emits nothing and does not touch its inputs — and can be called repeatedly', async () => {
    const w = await makeWorld()
    await giveShotAnImage(w)
    const ctx = await ctxFor(w)
    const before = structuredClone({ projection: ctx.projection, jobs: ctx.jobs })
    deepFreeze(ctx.projection)
    const items: AdmissionTarget[] = [
      { target: { kind: 'shot_image', shotId: w.shot.id }, provider: imageProvider() },
      {
        target: { kind: 'shot_image', shotId: w.shot2.id },
        provider: imageProvider({ acceptedUnverified: [] }),
      },
      {
        target: { kind: 'shot_video', shotId: w.shot.id },
        provider: videoProvider(),
        resolution: '720P',
      },
    ]
    const first = await preflight(ctx, items)
    const second = await preflight(ctx, items)
    expect(second).toEqual(first)
    expect(await w.ports.store.jobs.list()).toEqual([])
    expect(w.ports.events.events).toEqual([])
    expect(structuredClone({ projection: ctx.projection, jobs: ctx.jobs })).toEqual(before)
    // 逐项给出：能否生成、原因码、预估费用
    for (const r of first.results) {
      expect(['accepted', 'blocked', 'needs_confirmation', 'blocked_by_batch']).toContain(r.status)
      expect(r.reasons).toBeInstanceOf(Array)
      expect(r.estimate).toBeDefined()
    }
  })

  it('returns exactly what submitBatch would decide on', async () => {
    const w = await makeWorld()
    const queue = new JobQueue({ jobs: w.ports.store.jobs, clock: w.ports.clock, ids: w.ports.ids })
    const items: AdmissionTarget[] = [
      { target: { kind: 'shot_image', shotId: w.shot.id }, provider: imageProvider() },
    ]
    const pre = await preflight(await ctxFor(w), items)
    const submitted = await submitBatch(await ctxFor(w), queue, items)
    expect(submitted.admission).toEqual(pre)
  })
})

describe('variant with a linked costume (inputs)', () => {
  const addCostume = async (w: World, withSheet: boolean, kind: 'costume' | 'prop' = 'costume') => {
    let c = createAsset({
      id: 'asset_cos',
      projectId: w.project.id,
      number: 8,
      kind,
      name: '红嫁衣',
      now: 1,
      description: '红色织锦',
    })
    if (withSheet) {
      const f = await putFile(w.ports, w.project.id, 'images/asset_cos/v1.png', 'cos')
      c = { ...c, sheet: slotWith('image', 'cos_v1', f) }
    }
    await w.ports.store.assets.put(c)
    await w.ports.store.assets.put({
      ...w.hero,
      variants: [
        {
          name: '新娘',
          description: '新娘',
          origin: 'edit',
          editInstruction: '换上嫁衣',
          costumeAssetId: 'asset_cos',
          sheet: { currentVersionId: null, versions: [] },
        },
      ],
    })
  }
  const run = async (w: World) =>
    evaluateTarget(await ctxFor(w), {
      target: { kind: 'asset_sheet', assetId: w.hero.id, variantName: '新娘' },
      provider: imageProvider(),
    })

  it('adds the costume description to the edit instruction and its sheet as a second reference', async () => {
    const w = await makeWorld()
    await addCostume(w, true)
    const v = await run(w)
    expect(v.status).toBe('accepted')
    expect(v.inputs?.prompt).toBe('换上嫁衣\n服装：红嫁衣（红色织锦）')
    expect(v.inputs?.references.map((r) => [r.index, r.role, r.assetName])).toEqual([
      [1, 'character', '林夏'],
      [2, 'costume', '红嫁衣'],
    ])
  })

  it('a costume without a sheet contributes only its description (omitted input, not a block)', async () => {
    const w = await makeWorld()
    await addCostume(w, false)
    const v = await run(w)
    expect(v.status).toBe('accepted')
    expect(v.inputs?.references.map((r) => r.assetName)).toEqual(['林夏'])
    expect(v.inputs?.gaps.map((g) => [g.code, g.severity])).toEqual([
      ['OPTIONAL_INPUT_OMITTED', 'omit'],
    ])
  })

  it('a link to something that is not a costume (or no longer exists) blocks generation', async () => {
    const w = await makeWorld()
    await addCostume(w, true, 'prop')
    expect(codes(await run(w))).toContain('VARIANT_COSTUME_INVALID')
  })
})

describe('concurrent submissions of the same target (double click / two tabs)', () => {
  const imgTarget = (w: World): AdmissionTarget => ({
    target: { kind: 'shot_image', shotId: w.shot.id },
    provider: imageProvider(),
  })

  it('two concurrent submitBatch calls for the same image target create one job', async () => {
    const w = await makeWorld()
    const queue = new JobQueue({ jobs: w.ports.store.jobs, clock: w.ports.clock, ids: w.ports.ids })
    // 两个请求拿到的是同一时刻的快照，都能通过准入
    const [ctxA, ctxB] = [await ctxFor(w), await ctxFor(w)]
    const [a, b] = await Promise.all([
      submitBatch(ctxA, queue, [imgTarget(w)]),
      submitBatch(ctxB, queue, [imgTarget(w)]),
    ])
    expect(await w.ports.store.jobs.list()).toHaveLength(1)
    const all = [...a.succeeded, ...b.succeeded]
    expect(all).toHaveLength(2) // 两个请求都拿到“这个任务”
    expect(new Set(all.map((s) => s.jobId)).size).toBe(1)
    expect(all.filter((s) => s.deduped)).toHaveLength(1)
  })

  it('many concurrent calls still produce a single job', async () => {
    const w = await makeWorld()
    const queue = new JobQueue({ jobs: w.ports.store.jobs, clock: w.ports.clock, ids: w.ports.ids })
    const ctx = await ctxFor(w)
    await Promise.all(Array.from({ length: 10 }, () => submitBatch(ctx, queue, [imgTarget(w)])))
    expect(await w.ports.store.jobs.list()).toHaveLength(1)
  })

  it('one in-flight video per shot holds on the atomic path, even when two requests differ (provider / input) and both passed admission', async () => {
    const w = await makeWorld()
    await giveShotAnImage(w)
    const queue = new JobQueue({ jobs: w.ports.store.jobs, clock: w.ports.clock, ids: w.ports.ids })
    const ctx = await ctxFor(w) // 没有在途任务的快照
    const video = (provider = videoProvider()): AdmissionTarget => ({
      target: { kind: 'shot_video', shotId: w.shot.id },
      provider,
      resolution: '720P',
    })
    const results = await Promise.all([
      submitBatch(ctx, queue, [video()]),
      submitBatch(ctx, queue, [
        video(
          videoProvider({
            id: 'other',
            model: 'wan2.2-i2v-flash',
            baseUrl: 'https://other.example',
          }),
        ),
      ]),
      submitBatch(ctx, queue, [video()]),
    ])
    const jobs = await w.ports.store.jobs.list()
    expect(jobs.filter((j) => j.operation === 'shot_video')).toHaveLength(1)
    expect(jobs[0].exclusiveKey).toBe(`shot_video:${w.shot.id}`)
    const losers = results.flatMap((r) => r.failed)
    expect(losers.length).toBeGreaterThanOrEqual(1)
    expect(losers.every((l) => l.reason.code === 'IN_FLIGHT_CONFLICT')).toBe(true)
  })

  it('a lost race on one target does not stop the other targets in the batch', async () => {
    const w = await makeWorld()
    await giveShotAnImage(w, w.shot.id)
    await giveShotAnImage(w, w.shot2.id)
    const queue = new JobQueue({ jobs: w.ports.store.jobs, clock: w.ports.clock, ids: w.ports.ids })
    const ctx = await ctxFor(w)
    const v = (shotId: string): AdmissionTarget => ({
      target: { kind: 'shot_video', shotId },
      provider: videoProvider(),
      resolution: '720P',
    })
    // 对手先占了第一镜
    await queue.enqueue({
      type: 'video',
      operation: 'shot_video',
      projectId: w.project.id,
      shotId: w.shot.id,
      exclusiveKey: `shot_video:${w.shot.id}`,
      dedupeKey: 'someone-else',
    })
    const res = await submitBatch(ctx, queue, [v(w.shot.id), v(w.shot2.id)])
    expect(res.failed.map((f) => [f.targetId, f.reason.code])).toEqual([
      [`shot_video:${w.shot.id}`, 'IN_FLIGHT_CONFLICT'],
    ])
    expect(res.succeeded.map((s) => s.targetId)).toEqual([`shot_video:${w.shot2.id}`])
  })
})
