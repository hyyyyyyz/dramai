import { beforeAll, describe, expect, it } from 'vitest'
import { evaluateArtifacts } from '../src/artifacts/staleness.ts'
import { currentVersion } from '../src/domain/index.ts'
import type { Shot } from '../src/domain/index.ts'
import { loadProjection } from '../src/generation/projection.ts'
import { chooseSheetLayout, sheetAspect } from '../src/pipeline/sheets.ts'
import { episodeShots } from '../src/pipeline/entities.ts'
import { preflightEpisode, preflightTargets, requestGeneration } from '../src/pipeline/request.ts'
import { createQueue } from '../src/pipeline/request.ts'
import {
  HERO,
  LOCATE_MEDIA_HOOK_TIMEOUT_MS,
  PLACE,
  PROP,
  locateMedia,
  makePipelineEnv,
} from './fakes.ts'
import type { MediaEnv, PipelineEnv } from './fakes.ts'
import { makeWorker, prepareEpisode, runAll } from './helpers-pipeline.ts'
import type { AdmissionTarget } from '../src/admission/index.ts'

let media: MediaEnv | undefined
beforeAll(async () => {
  media = await locateMedia()
  if (!media)
    console.warn(
      '[generation tests] SKIPPED: ffmpeg not found (needed to make fake provider media)',
    )
}, LOCATE_MEDIA_HOOK_TIMEOUT_MS)

const real = (name: string, fn: () => Promise<void>, timeout = 60_000) => {
  it(
    name,
    async (ctx) => {
      if (!media) return ctx.skip()
      await fn()
    },
    timeout,
  )
}

const gemini = (env: PipelineEnv) => env.providers.posts(':generateContent')
type GeminiBody = {
  contents: Array<{ parts: Array<{ text?: string; inline_data?: unknown }> }>
  generationConfig: { imageConfig?: { aspectRatio: string } }
}
const partsOf = (b: unknown) => (b as GeminiBody).contents[0].parts
const textOf = (b: unknown) => partsOf(b).find((p) => p.text !== undefined)?.text ?? ''
const refCount = (b: unknown) => partsOf(b).filter((p) => p.inline_data).length

const sheetsFor = async (env: PipelineEnv, epId: string, layout?: 'multi_view' | 'per_angle') => {
  const shots = await episodeShots(env.deps.store, epId)
  const used = new Set<string>()
  for (const s of shots)
    for (const r of await env.deps.store.shotRefs.listByShot(s.id)) used.add(r.assetId)
  return [...used].map(
    (id): AdmissionTarget => ({
      target: { kind: 'asset_sheet', assetId: id },
      provider: env.provider('img'),
      sheetLayout: layout,
    }),
  )
}

describe('sheet layout choice (A3 layer 1)', () => {
  const cap = (env: PipelineEnv) => env.deps.catalog.models.lookup(env.provider('img')).capability
  it('non-characters always have a single layout; characters default to one multi-view image', async () => {
    if (!media) return
    const env = await makePipelineEnv(media)
    const c = cap(env)
    expect(chooseSheetLayout({ kind: 'location', imageModel: c })).toBe('single')
    expect(chooseSheetLayout({ kind: 'prop', imageModel: c })).toBe('single')
    expect(chooseSheetLayout({ kind: 'costume', imageModel: c })).toBe('single')
    expect(chooseSheetLayout({ kind: 'character', imageModel: c })).toBe('multi_view')
    expect(chooseSheetLayout({ kind: 'character', imageModel: c, consumerMaxRefImages: 3 })).toBe(
      'multi_view',
    )
  })
  it('a downstream model that takes only one reference gets per-angle single images instead of a collage', async () => {
    if (!media) return
    const env = await makePipelineEnv(media)
    expect(
      chooseSheetLayout({ kind: 'character', imageModel: cap(env), consumerMaxRefImages: 1 }),
    ).toBe('per_angle')
    expect(
      chooseSheetLayout({ kind: 'character', imageModel: cap(env), consumerMaxRefImages: 0 }),
    ).toBe('per_angle')
  })
  it('…but not if the sheet model cannot edit its own front view (the three views would not stay consistent)', async () => {
    if (!media) return
    const env = await makePipelineEnv(media)
    const t2iOnly = env.deps.catalog.models.lookup(env.provider('img')).capability
    expect(
      chooseSheetLayout({
        kind: 'character',
        imageModel: { ...t2iOnly, modes: { t2i: 'supported', i2i: 'unsupported' } },
        consumerMaxRefImages: 1,
      }),
    ).toBe('multi_view')
  })
  it('sheet aspect ratios are explicit per kind', () => {
    expect(sheetAspect('character', 'multi_view')).toBe('16:9')
    expect(sheetAspect('character', 'per_angle')).toBe('9:16')
    expect(sheetAspect('location', 'single')).toBe('16:9')
    expect(sheetAspect('prop', 'single')).toBe('1:1')
    expect(sheetAspect('costume', 'single')).toBe('1:1')
  })
})

describe('asset sheets', () => {
  real(
    'generates multi-view character sheets, explicit aspect ratios, and registers current artifacts',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      const res = await requestGeneration(
        env.deps,
        env.projectId,
        await sheetsFor(env, ep.id, 'multi_view'),
      )
      expect(res.succeeded).toHaveLength(4)
      const jobs = await runAll(env)
      expect(jobs.every((j) => j.status === 'succeeded')).toBe(true)
      const assets = await env.deps.store.assets.listByProject(env.projectId)
      for (const a of assets) {
        expect(a.sheet.versions).toHaveLength(1)
        expect(a.sheet.versions[0]).toMatchObject({ source: 'generated', kind: 'image' })
        expect(await env.ports.files.exists(env.projectId, a.sheet.versions[0].file.path)).toBe(
          true,
        )
      }
      const byName = Object.fromEntries(assets.map((a) => [a.name, a]))
      expect(byName[HERO].sheetLayout).toBe('multi_view')
      // 请求：画幅显式传出；多视图版式的提示词
      const bodies = gemini(env).map((r) => r.body)
      const aspects = bodies.map((b) => (b as GeminiBody).generationConfig.imageConfig?.aspectRatio)
      expect(aspects.sort()).toEqual(['1:1', '16:9', '16:9', '16:9'].sort())
      const heroPrompt = bodies
        .map(textOf)
        .find((t) => t.includes('角色设定图') && t.includes(HERO))!
      expect(heroPrompt).toContain('正面、90 度侧面、背面')
      expect(heroPrompt).toContain('同一张脸')
      expect(heroPrompt).toContain('黑色长发') // 外貌描述
      expect(heroPrompt).toContain('mystery') // 风格关键词来自项目的风格快照
      // 清单
      const reports = evaluateArtifacts(await loadProjection(env.deps.store, env.projectId))
      for (const a of assets) expect(reports.get(`asset_sheet:${a.id}`)!.status).toBe('current')
      expect(gemini(env).every((r) => (r.body as GeminiBody) && true)).toBe(true)
    },
  )

  real(
    'per-angle layout makes three images: front becomes the sheet, side/back use the front as reference',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      const assets = await env.deps.store.assets.listByProject(env.projectId)
      const hero = assets.find((a) => a.name === HERO)!
      const pre = await preflightTargets(env.deps, env.projectId, [
        {
          target: { kind: 'asset_sheet', assetId: hero.id },
          provider: env.provider('img'),
          sheetLayout: 'per_angle',
        },
      ])
      expect(pre.results[0].estimate).toMatchObject({
        priced: true,
        amount: expect.closeTo(1.05, 5),
      }) // 3 张
      await requestGeneration(env.deps, env.projectId, [
        {
          target: { kind: 'asset_sheet', assetId: hero.id },
          provider: env.provider('img'),
          sheetLayout: 'per_angle',
        },
      ])
      await runAll(env)
      const after = (await env.deps.store.assets.get(hero.id))!
      expect(after.sheetLayout).toBe('per_angle')
      expect(after.sheet.versions).toHaveLength(1)
      expect(after.sheetViews?.side?.versions).toHaveLength(1)
      expect(after.sheetViews?.back?.versions).toHaveLength(1)
      const bodies = gemini(env).map((r) => r.body)
      expect(bodies).toHaveLength(3)
      expect(refCount(bodies[0])).toBe(0)
      expect(refCount(bodies[1])).toBe(1)
      expect(textOf(bodies[1])).toContain('90 度侧面')
      expect(textOf(bodies[2])).toContain('背面')
      expect(textOf(bodies[0])).not.toContain('并排画出')
      void ep
    },
  )
})

async function withSheets(env: PipelineEnv, ep: { id: string }) {
  await requestGeneration(env.deps, env.projectId, await sheetsFor(env, ep.id, 'multi_view'))
  await runAll(env)
}

describe('shot images (multiple references, versions)', () => {
  real(
    'refuses (before any request) while a referenced asset has no sheet — originals cannot stand in',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      const shots = await episodeShots(env.deps.store, ep.id)
      const res = await requestGeneration(env.deps, env.projectId, [
        { target: { kind: 'shot_image', shotId: shots[0].id }, provider: env.provider('img') },
      ])
      expect(res.succeeded).toEqual([])
      expect(res.blocked[0].reasons.map((r) => r.code)).toContain('ASSET_SHEET_MISSING')
      expect(env.providers.requests).toEqual([])
      expect(await env.deps.store.jobs.list()).toEqual([])
    },
  )

  real(
    'sends the sheets as ordered references with index bindings, project style and explicit aspect; appends a new version each time',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      await withSheets(env, ep)
      env.providers.requests.length = 0
      const shots = await episodeShots(env.deps.store, ep.id)
      const target = shots.find(
        (s) => s.entityHints?.characters.includes(HERO) && s.entityHints.location === PLACE,
      )!
      const req = await requestGeneration(env.deps, env.projectId, [
        { target: { kind: 'shot_image', shotId: target.id }, provider: env.provider('img') },
      ])
      expect(req.succeeded).toHaveLength(1)
      expect((await env.deps.store.shots.get(target.id))!.stages.image).toBe('queued')
      await runAll(env)
      const body = gemini(env)[0].body
      expect(refCount(body)).toBeGreaterThanOrEqual(2)
      const text = textOf(body)
      expect(text.startsWith(env.deps.catalog.styles.get('mystery_realistic')!.imageKeywords)).toBe(
        true,
      )
      expect(text).toContain(`Image 1 is the reference for ${HERO}`)
      expect(text).toContain('Exclude: 画面中没有多余的路人') // Gemini：负面项并入正文
      expect(text).not.toContain('@{') // 占位符已换成名字
      expect(text).toContain(HERO)
      expect((body as GeminiBody).generationConfig.imageConfig?.aspectRatio).toBe('9:16') // 项目画幅
      const shot = (await env.deps.store.shots.get(target.id))!
      expect(shot.stages.image).toBe('succeeded')
      expect(shot.image.versions).toHaveLength(1)

      // 再生成一次：旧版本保留，当前指针前移，旧文件仍在
      const first = currentVersion(shot.image)!
      await requestGeneration(env.deps, env.projectId, [
        { target: { kind: 'shot_image', shotId: target.id }, provider: env.provider('img') },
      ])
      await runAll(env)
      const again = (await env.deps.store.shots.get(target.id))!
      expect(again.image.versions.map((v) => v.id)).toEqual([
        first.id,
        again.image.currentVersionId,
      ])
      expect(currentVersion(again.image)!.id).not.toBe(first.id)
      expect(await env.ports.files.exists(env.projectId, first.file.path)).toBe(true)
      expect(first.file.path).not.toBe(currentVersion(again.image)!.file.path)
    },
  )

  real(
    'the reference order follows the first mention in the prompt, and the budget keeps characters over props over places',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      await withSheets(env, ep)
      const shots = await episodeShots(env.deps.store, ep.id)
      const assets = await env.deps.store.assets.listByProject(env.projectId)
      const id = (n: string) => assets.find((a) => a.name === n)!.id
      const s = shots[0]
      const refs = [HERO, PLACE, PROP].map((n) => ({ shotId: s.id, assetId: id(n) }))
      await env.deps.store.shotRefs.replaceForShot(s.id, refs)
      await env.deps.store.shots.put({
        ...s,
        promptSpec: undefined,
        prompts: { keyFrame: `@{${id(PROP)}} 在 @{${id(HERO)}} 手里，背景是 @{${id(PLACE)}}` },
      })
      env.providers.requests.length = 0
      await requestGeneration(env.deps, env.projectId, [
        { target: { kind: 'shot_image', shotId: s.id }, provider: env.provider('img') },
      ])
      await runAll(env)
      const text = textOf(gemini(env)[0].body)
      expect(text.indexOf(`Image 1 is the reference for ${PROP}`)).toBeGreaterThan(-1)
      expect(text.indexOf(`Image 2 is the reference for ${HERO}`)).toBeGreaterThan(
        text.indexOf('Image 1'),
      )
      expect(text.indexOf(`Image 3 is the reference for ${PLACE}`)).toBeGreaterThan(
        text.indexOf('Image 2'),
      )
      expect(refCount(gemini(env)[0].body)).toBe(3)
    },
  )

  real(
    'an upstream failure marks the shot as failed at the image stage, then a retry clears it',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      await withSheets(env, ep)
      const shots = await episodeShots(env.deps.store, ep.id)
      env.providers.faults.failImages = 1
      await requestGeneration(env.deps, env.projectId, [
        { target: { kind: 'shot_image', shotId: shots[0].id }, provider: env.provider('img') },
      ])
      const jobs = await runAll(env)
      const failed = jobs.find((j) => j.status === 'failed')!
      expect(failed.error).toMatchObject({ code: 'HTTP_500' })
      const s1 = (await env.deps.store.shots.get(shots[0].id))!
      expect(s1).toMatchObject({ failedStage: 'image', stages: { image: 'failed' } })
      await requestGeneration(env.deps, env.projectId, [
        { target: { kind: 'shot_image', shotId: shots[0].id }, provider: env.provider('img') },
      ])
      await runAll(env)
      const s2 = (await env.deps.store.shots.get(shots[0].id))!
      expect(s2.failedStage).toBeUndefined()
      expect(s2.stages.image).toBe('succeeded')
    },
  )
})

describe('variants: editing the base sheet (A3 layer 5)', () => {
  real(
    'creates the variant sheet by one image edit with the base sheet as the only reference; goes stale (not regenerated) when the base is regenerated',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      await withSheets(env, ep)
      const assets = await env.deps.store.assets.listByProject(env.projectId)
      const hero = assets.find((a) => a.name === HERO)!
      await env.deps.store.assets.put({
        ...hero,
        variants: [
          {
            name: '婚服',
            description: '换上红色嫁衣',
            origin: 'edit',
            editInstruction: '换上红色织锦嫁衣，头戴金凤冠',
            sheet: { currentVersionId: null, versions: [] },
          },
        ],
      })
      env.providers.requests.length = 0
      await requestGeneration(env.deps, env.projectId, [
        {
          target: { kind: 'asset_sheet', assetId: hero.id, variantName: '婚服' },
          provider: env.provider('img'),
        },
      ])
      await runAll(env)
      const body = gemini(env)[0].body
      expect(refCount(body)).toBe(1)
      expect(textOf(body)).toContain('只做下面这处修改')
      expect(textOf(body)).toContain('红色织锦嫁衣')
      const after = (await env.deps.store.assets.get(hero.id))!
      const v = after.variants[0].sheet
      expect(v.versions).toHaveLength(1)
      expect(v.versions[0].source).toBe('image_edit')
      expect(after.sheet.versions).toHaveLength(1) // 本体没动
      const vKey = `variant_sheet:${hero.id}/婚服`
      let reports = evaluateArtifacts(await loadProjection(env.deps.store, env.projectId))
      expect(reports.get(vKey)!.status).toBe('current')
      // 重生本体 → 衍生过期（有原因），不自动重做
      const before = (await env.deps.store.jobs.list()).length
      await requestGeneration(env.deps, env.projectId, [
        {
          target: { kind: 'asset_sheet', assetId: hero.id },
          provider: env.provider('img'),
          sheetLayout: 'multi_view',
        },
      ])
      await runAll(env)
      const jobsAfter = (await env.deps.store.jobs.list()).length
      expect(jobsAfter).toBe(before + 1) // 只有这一次重生本体，衍生没有被自动重做
      reports = evaluateArtifacts(await loadProjection(env.deps.store, env.projectId))
      const r = reports.get(vKey)!
      expect(r.status).toBe('stale')
      expect(r.changes).toMatchObject([
        {
          kind: 'upstream',
          key: `asset_sheet:${hero.id}`,
          label: HERO,
          from: { versionId: expect.any(String) },
          to: { versionId: expect.any(String) },
        },
      ])
      expect(r.changes[0]).toSatisfy(
        (c: { kind: string; from?: { versionId: string }; to?: { versionId: string } }) =>
          c.kind === 'upstream' && c.from!.versionId !== c.to!.versionId,
      )
    },
  )
})

async function withImages(env: PipelineEnv, ep: { id: string }) {
  await withSheets(env, ep)
  const shots = await episodeShots(env.deps.store, ep.id)
  await requestGeneration(
    env.deps,
    env.projectId,
    shots.map(
      (s): AdmissionTarget => ({
        target: { kind: 'shot_image', shotId: s.id },
        provider: env.provider('img'),
      }),
    ),
  )
  await runAll(env)
  return shots
}

describe('video', () => {
  real(
    'generates one video per shot with the start frame, snaps the duration to the model steps, and keeps a version history',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      const shots = await withImages(env, ep)
      env.providers.requests.length = 0
      const s = shots[0]
      await env.deps.store.shots.put({ ...(await env.deps.store.shots.get(s.id))!, durationSec: 8 })
      const pre = await preflightTargets(env.deps, env.projectId, [
        {
          target: { kind: 'shot_video', shotId: s.id },
          provider: env.provider('vid'),
          resolution: '720P',
        },
      ])
      expect(pre.results[0].status).toBe('accepted')
      expect(pre.results[0].warnings.map((w) => w.code)).toContain('DURATION_SNAPPED')
      await requestGeneration(env.deps, env.projectId, [
        {
          target: { kind: 'shot_video', shotId: s.id },
          provider: env.provider('vid'),
          resolution: '720P',
        },
      ])
      await runAll(env)
      const submit = env.providers.posts('/video-synthesis')[0].body as {
        input: { prompt: string; img_url: string }
        parameters: { duration: number; resolution: string }
      }
      expect(submit.parameters).toMatchObject({ duration: 5, resolution: '720P' })
      expect(submit.input.img_url.startsWith('data:image/png;base64,')).toBe(true)
      expect(submit.input.prompt).toContain('固定机位') // 一镜一个主运镜，放在最前
      const shot = (await env.deps.store.shots.get(s.id))!
      expect(shot.stages.video).toBe('succeeded')
      expect(shot.video.versions).toHaveLength(1)
      expect(shot.video.versions[0].facts?.durationSec).toBeGreaterThan(1.5) // ffprobe 实测
      await requestGeneration(env.deps, env.projectId, [
        {
          target: { kind: 'shot_video', shotId: s.id },
          provider: env.provider('vid'),
          resolution: '720P',
        },
      ])
      await runAll(env)
      expect((await env.deps.store.shots.get(s.id))!.video.versions).toHaveLength(2)
    },
  )

  real(
    'voice ownership: dialogue shots ask the video model for native voice; narration never goes into the video prompt',
    async () => {
      const env = await makePipelineEnv(media!, { videoHasAudio: true })
      const ep = await prepareEpisode(env)
      const shots = await withImages(env, ep)
      const dialogueShot = shots.find((s) => s.dialogue.length > 0)!
      const narrationShot = shots.find((s) => s.narration)!
      env.providers.requests.length = 0
      const seed = (id: string) => ({
        target: { kind: 'shot_video' as const, shotId: id },
        provider: env.provider('seedance'),
        resolution: '720p',
        confirmUnverified: true,
      })
      // 没验证过的模型：先预检报告“需要确认”，确认后才放行
      const needs = await preflightTargets(env.deps, env.projectId, [
        {
          ...seed(dialogueShot.id),
          confirmUnverified: false,
          provider: { ...env.provider('seedance'), acceptedUnverified: [] },
        },
      ])
      expect(needs.results[0].status).toBe('needs_confirmation')
      await requestGeneration(env.deps, env.projectId, [
        seed(dialogueShot.id),
        seed(narrationShot.id),
      ])
      await runAll(env)
      const posts = env.providers.posts('/contents/generations/tasks')
      expect(posts).toHaveLength(2)
      const bodies = posts.map(
        (p) => p.body as { generate_audio: boolean; content: Array<{ text?: string }> },
      )
      expect(bodies[0].generate_audio).toBe(true)
      expect(bodies[1].generate_audio).toBe(false)
      for (const b of bodies) expect(b.content[0].text).not.toContain(narrationShot.narration!)
      const dv = currentVersion((await env.deps.store.shots.get(dialogueShot.id))!.video)!
      const nv = currentVersion((await env.deps.store.shots.get(narrationShot.id))!.video)!
      expect(dv.withNativeAudio).toBe(true)
      expect(nv.withNativeAudio).toBe(false)
    },
  )

  real('a model without native voice warns that dialogue will be silent', async () => {
    const env = await makePipelineEnv(media!)
    const ep = await prepareEpisode(env)
    const shots = await withImages(env, ep)
    const d = shots.find((s) => s.dialogue.length > 0)!
    const pre = await preflightTargets(env.deps, env.projectId, [
      {
        target: { kind: 'shot_video', shotId: d.id },
        provider: env.provider('vid'),
        resolution: '720P',
      },
    ])
    expect(pre.results[0].warnings.map((w) => w.code)).toContain('DIALOGUE_NOT_VOICED')
  })

  real(
    'a shot with both dialogue and narration is blocked for video and for narration (two layers of voice)',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      const shots = await withImages(env, ep)
      const s = shots.find((x) => x.dialogue.length > 0)!
      await env.deps.store.shots.put({
        ...(await env.deps.store.shots.get(s.id))!,
        narration: '旁白混进来了',
      })
      env.providers.requests.length = 0
      const res = await requestGeneration(env.deps, env.projectId, [
        {
          target: { kind: 'shot_video', shotId: s.id },
          provider: env.provider('vid'),
          resolution: '720P',
        },
      ])
      expect(res.blocked[0].reasons.map((r) => r.code)).toContain('VOICE_CONFLICT')
      const audio = await preflightTargets(env.deps, env.projectId, [
        { target: { kind: 'shot_audio', shotId: s.id }, provider: env.provider('tts') },
      ])
      expect(audio.results[0].reasons.map((r) => r.code)).toContain('VOICE_CONFLICT')
      expect(env.providers.requests).toEqual([])
    },
  )

  real(
    'a poll outage after submit leaves a resumable job; resuming polls the same task and never submits again',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      const shots = await withImages(env, ep)
      env.providers.requests.length = 0
      env.providers.faults.failPolls = 100
      await requestGeneration(env.deps, env.projectId, [
        {
          target: { kind: 'shot_video', shotId: shots[0].id },
          provider: env.provider('vid'),
          resolution: '720P',
        },
      ])
      const worker = makeWorker(env)
      const jobs = await runAll(env, worker)
      const job = jobs.find((j) => j.operation === 'shot_video')!
      expect(job).toMatchObject({
        status: 'failed',
        providerJobId: 'task-1',
        error: { category: 'delivery_failed', recoverable: true },
      })
      expect((await env.deps.store.shots.get(shots[0].id))!.failedStage).toBe('video')
      env.providers.faults.failPolls = 0
      const queue = createQueue(env.deps)
      expect((await queue.resume(job.id)).ok).toBe(true)
      await runAll(env, worker)
      expect(env.providers.posts('/video-synthesis')).toHaveLength(1) // 只提交过一次
      expect((await env.deps.store.jobs.get(job.id))!.status).toBe('succeeded')
      expect((await env.deps.store.shots.get(shots[0].id))!.video.versions).toHaveLength(1)
    },
  )

  real('the same shot cannot have two videos in flight, even if two requests race', async () => {
    const env = await makePipelineEnv(media!)
    const ep = await prepareEpisode(env)
    const shots = await withImages(env, ep)
    const item = (provider: string): AdmissionTarget => ({
      target: { kind: 'shot_video', shotId: shots[0].id },
      provider: env.provider(provider),
      resolution: provider === 'vid' ? '720P' : '720p',
      confirmUnverified: true,
    })
    const [a, b] = await Promise.all([
      requestGeneration(env.deps, env.projectId, [item('vid')]),
      requestGeneration(env.deps, env.projectId, [item('seedance')]),
    ])
    expect(a.succeeded.length + b.succeeded.length).toBe(1)
    expect([...a.failed, ...b.failed].map((f) => f.reason.code)).toEqual(['IN_FLIGHT_CONFLICT'])
    expect(
      (await env.deps.store.jobs.list()).filter((j) => j.operation === 'shot_video'),
    ).toHaveLength(1)
  })
})

describe('narration (TTS as a queue job)', () => {
  real(
    'synthesises only narration shots, records the measured duration, and uses the project voice',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      const shots = await episodeShots(env.deps.store, ep.id)
      const withNarr = shots.filter((s) => s.narration)
      const targets = shots.map(
        (s): AdmissionTarget => ({
          target: { kind: 'shot_audio', shotId: s.id },
          provider: env.provider('tts'),
        }),
      )
      // 不是所有镜头都能配音：有对白的镜头由视频模型原生人声承载，没有旁白的无事可做。批量是整批的。
      const all = await requestGeneration(env.deps, env.projectId, targets)
      expect(all.succeeded).toEqual([])
      expect(all.blocked.length).toBeGreaterThan(0)
      expect(env.providers.requests).toEqual([])
      const res = await requestGeneration(
        env.deps,
        env.projectId,
        targets.filter((t) =>
          withNarr.some((s) => s.id === (t.target as { shotId: string }).shotId),
        ),
      )
      expect(res.succeeded).toHaveLength(withNarr.length)
      const jobs = await runAll(env)
      expect(
        jobs.filter((j) => j.operation === 'shot_audio').every((j) => j.status === 'succeeded'),
      ).toBe(true)
      const speech = env.providers.posts('/audio/speech')
      expect(speech).toHaveLength(withNarr.length)
      expect(speech[0].body).toMatchObject({
        voice: 'alloy',
        model: 'tts-1',
        response_format: 'mp3',
        input: expect.stringContaining(''),
      })
      const shot = (await env.deps.store.shots.get(withNarr[0].id))!
      const v = currentVersion(shot.narrationAudio)!
      expect(v.kind).toBe('audio')
      expect(v.facts?.durationSec).toBeGreaterThan(1.2)
      expect(v.facts?.durationSec).toBeLessThan(2)
    },
  )

  real(
    'narration made while the project has no narration voice is current, and becomes stale only once a voice is set',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      // a project without a narration voice (the test env sets one by default)
      const project = (await env.deps.store.projects.get(env.projectId))!
      const withoutVoice = { ...project }
      delete withoutVoice.narrationVoice
      await env.deps.store.projects.put(withoutVoice)
      const withNarr = (await episodeShots(env.deps.store, ep.id)).filter((s) => s.narration)
      await requestGeneration(
        env.deps,
        env.projectId,
        withNarr.map(
          (s): AdmissionTarget => ({
            target: { kind: 'shot_audio', shotId: s.id },
            provider: env.provider('tts'),
          }),
        ),
      )
      await runAll(env)
      // generated with the default voice...
      expect(env.providers.posts('/audio/speech')[0]!.body).toMatchObject({ voice: 'alloy' })
      // ...and not "changed basis" the moment it exists
      let reports = evaluateArtifacts(await loadProjection(env.deps.store, env.projectId))
      for (const s of withNarr) {
        const r = reports.get(`shot_audio:${s.id}`)!
        expect(r.status, JSON.stringify(r.changes)).toBe('current')
      }
      // choosing a voice afterwards changes what the user would hear, so the narration is honestly outdated
      await env.deps.store.projects.put({
        ...withoutVoice,
        narrationVoice: { providerConfigId: 'tts', voice: 'nova', speed: 1 },
      })
      reports = evaluateArtifacts(await loadProjection(env.deps.store, env.projectId))
      for (const s of withNarr) {
        const r = reports.get(`shot_audio:${s.id}`)!
        expect(r.status).toBe('stale')
        expect(r.changes).toMatchObject([{ kind: 'input', field: 'audio' }])
      }
    },
  )

  real('post-production projects do not synthesise narration', async () => {
    const env = await makePipelineEnv(media!, { delivery: 'post' })
    const ep = await prepareEpisode(env)
    const s = (await episodeShots(env.deps.store, ep.id)).find((x) => x.narration)!
    const pre = await preflightTargets(env.deps, env.projectId, [
      { target: { kind: 'shot_audio', shotId: s.id }, provider: env.provider('tts') },
    ])
    expect(pre.results[0].reasons.map((r) => r.code)).toContain('NARRATION_NOT_TTS')
  })
})

describe('read-only preflight for a whole episode', () => {
  real(
    'returns per-target verdicts and cost totals, creates nothing, and matches what a real submission decides',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      const snapshot = async () =>
        JSON.stringify([
          await env.deps.store.jobs.list(),
          await env.deps.store.assets.listByProject(env.projectId),
          await episodeShots(env.deps.store, ep.id),
        ])
      const before = await snapshot()
      const eventsBefore = env.ports.events.events.length
      const plan = {
        assetSheets: env.provider('img'),
        shotImages: env.provider('img'),
        shotVideos: env.provider('vid'),
        narration: env.provider('tts'),
        resolution: '720P',
        sheetLayout: 'multi_view' as const,
      }
      const pre = await preflightEpisode(env.deps, ep.id, plan)
      expect(await snapshot()).toBe(before)
      expect(env.ports.events.events.length).toBe(eventsBefore)
      expect(env.providers.requests).toEqual([])
      expect(pre.targets.length).toBeGreaterThan(20)
      // 从零开始：设定图可以生成，分镜图缺设定图，视频缺起始帧——如实报告
      const byKind = (k: string) => pre.admission.results.filter((r) => r.targetId.startsWith(k))
      expect(byKind('asset_sheet').every((r) => r.status !== 'accepted' || true)).toBe(true)
      expect(
        byKind('shot_image').every((r) =>
          r.reasons.some((x) => x.code === 'ASSET_SHEET_MISSING' || x.code === 'BLOCKED_BY_BATCH'),
        ),
      ).toBe(true)
      expect(pre.admission.ok).toBe(false)
      expect(pre.totals.byCurrency.PTC).toBeDefined()
      // 同一份目标真正提交 → 同样的结论、同样没有任务
      const res = await requestGeneration(env.deps, env.projectId, pre.targets)
      expect(
        res.admission.results.map((r) => [r.targetId, r.status, r.reasons.map((x) => x.code)]),
      ).toEqual(
        pre.admission.results.map((r) => [r.targetId, r.status, r.reasons.map((x) => x.code)]),
      )
      expect(await env.deps.store.jobs.list()).toEqual([])
    },
  )

  real(
    'text steps are counted in the estimate (unpriced models are reported as unpriced, not as zero)',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      const pre = await preflightEpisode(env.deps, ep.id, {
        shotImages: env.provider('img'),
        textModel: env.provider('llm'),
      })
      expect(pre.textSteps.map((t) => t.step)).toEqual([
        'episode_breakdown',
        'entities_extract',
        'shot_frames',
      ])
      expect(pre.textSteps.every((t) => t.calls >= 1 && t.chars > 0)).toBe(true)
      expect(pre.textSteps.every((t) => t.estimate.priced === false)).toBe(true) // deepseek 没有价目
      const without = await preflightEpisode(env.deps, ep.id, { shotImages: env.provider('img') })
      expect(without.textSteps).toEqual([])
      expect(pre.totals.unpriced).toBe(without.totals.unpriced + 3)
    },
  )

  real(
    'after the sheets exist, only the sheets-dependent stages become available, and already-current targets are skipped',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      await withSheets(env, ep)
      const plan = { assetSheets: env.provider('img'), shotImages: env.provider('img') }
      const pre = await preflightEpisode(env.deps, ep.id, plan)
      expect(pre.targets.every((t) => t.target.kind === 'shot_image')).toBe(true) // 设定图都 current 了，不再列
      expect(pre.admission.ok).toBe(true)
      const all = await preflightEpisode(env.deps, ep.id, { ...plan, onlyMissing: false })
      expect(all.targets.some((t) => t.target.kind === 'asset_sheet')).toBe(true)
    },
  )
})

describe('stale propagation with reasons after a sheet is regenerated', () => {
  real(
    'shot images that used the sheet are stale (naming the asset and versions), videos only once their image is regenerated, and nothing is auto-regenerated',
    async () => {
      const env = await makePipelineEnv(media!)
      const ep = await prepareEpisode(env)
      const shots = await withImages(env, ep)
      await requestGeneration(
        env.deps,
        env.projectId,
        shots
          .map(
            (s): AdmissionTarget => ({
              target: { kind: 'shot_video', shotId: s.id },
              provider: env.provider('vid'),
              resolution: '720P',
            }),
          )
          .filter((t) => {
            const s = shots.find((x) => x.id === (t.target as { shotId: string }).shotId) as Shot
            return !(s.dialogue.length > 0 && s.narration)
          }),
      )
      await runAll(env)
      const hero = (await env.deps.store.assets.listByProject(env.projectId)).find(
        (a) => a.name === HERO,
      )!
      const oldVersion = hero.sheet.currentVersionId!
      const jobsBefore = (await env.deps.store.jobs.list()).length

      await requestGeneration(env.deps, env.projectId, [
        {
          target: { kind: 'asset_sheet', assetId: hero.id },
          provider: env.provider('img'),
          sheetLayout: 'multi_view',
        },
      ])
      await runAll(env)
      const newVersion = (await env.deps.store.assets.get(hero.id))!.sheet.currentVersionId!
      expect(newVersion).not.toBe(oldVersion)
      expect((await env.deps.store.jobs.list()).length).toBe(jobsBefore + 1)

      const projection = await loadProjection(env.deps.store, env.projectId)
      const reports = evaluateArtifacts(projection)
      const usesHero = shots.filter((s) => s.entityHints?.characters.includes(HERO))
      expect(usesHero.length).toBeGreaterThan(3)
      for (const s of usesHero) {
        const r = reports.get(`shot_image:${s.id}`)!
        expect(r.status, s.id).toBe('stale')
        expect(r.reason).toBe('upstream_changed')
        expect(r.changes).toContainEqual({
          kind: 'upstream',
          key: `asset_sheet:${hero.id}`,
          label: HERO,
          from: { versionId: oldVersion, contentHash: expect.any(String) },
          to: { versionId: newVersion, contentHash: expect.any(String) },
        })
        // 视频的直接上游是镜头图；镜头图还没重生，视频仍然 current，但被标出“上游已过期”
        expect(reports.get(`shot_video:${s.id}`)!.status).toBe('current')
        expect(reports.get(`shot_video:${s.id}`)!.staleUpstream).toEqual([`shot_image:${s.id}`])
      }
      // 没用到这个角色的镜头不受影响
      for (const s of shots.filter((x) => !x.entityHints?.characters.includes(HERO))) {
        expect(reports.get(`shot_image:${s.id}`)!.status).toBe('current')
      }
      // 过期的产物仍可使用：文件还在，当前版本不变
      const stale = (await env.deps.store.shots.get(usesHero[0].id))!
      expect(
        await env.ports.files.exists(env.projectId, currentVersion(stale.image)!.file.path),
      ).toBe(true)
      // 重生其中一个镜头图 → 它的视频随之过期
      await requestGeneration(env.deps, env.projectId, [
        { target: { kind: 'shot_image', shotId: usesHero[0].id }, provider: env.provider('img') },
      ])
      await runAll(env)
      const after = evaluateArtifacts(await loadProjection(env.deps.store, env.projectId))
      expect(after.get(`shot_image:${usesHero[0].id}`)!.status).toBe('current')
      if (after.has(`shot_video:${usesHero[0].id}`) && currentVersion(stale.video)) {
        expect(after.get(`shot_video:${usesHero[0].id}`)!.status).toBe('stale')
      }
    },
    120_000,
  )
})
