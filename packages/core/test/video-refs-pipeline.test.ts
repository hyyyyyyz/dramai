import { beforeAll, describe, expect, it } from 'vitest'
import type { AdmissionTarget } from '../src/admission/index.ts'
import { currentVersion, SCHEMA_VERSIONS } from '../src/domain/index.ts'
import type { Shot } from '../src/domain/index.ts'
import { episodeShots } from '../src/pipeline/entities.ts'
import { preflightTargets, requestGeneration } from '../src/pipeline/request.ts'
import type { ProviderConfig } from '../src/providers/types.ts'
import { locateMedia, makePipelineEnv, PROVIDERS } from './fakes.ts'
import type { MediaEnv, PipelineEnv } from './fakes.ts'
import { prepareEpisode, runAll } from './helpers-pipeline.ts'

/**
 * 步骤 8：视频任务带参考图（任务参数 videoRefs，默认关）的整条管线——
 * 准入 → 入队（任务参数）→ 解析参考图 → 提示词绑定 → 三个新协议各自发出的整个请求 → 版本上的"用了哪些参考图"记录。
 * 上游是替身（假 fetch），ffmpeg 是真的。
 */

let media: MediaEnv | undefined
let env: PipelineEnv
let shot: Shot
let wanted: string[]
const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = []

const ARK: ProviderConfig = {
  id: 'ark',
  label: 'Seedance 2.0',
  kind: 'video',
  protocol: 'ark-video',
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seedance-2-0-260128',
  enabled: true,
  secretRef: 'k-vid',
}
const KLING: ProviderConfig = {
  id: 'kling',
  label: 'Kling 4.0',
  kind: 'video',
  protocol: 'kling-contents',
  baseUrl: 'https://api-singapore.klingai.com',
  model: 'kling-4.0',
  enabled: true,
  secretRef: 'k-vid',
}
const WAN3: ProviderConfig = {
  id: 'wan3',
  label: 'Wan 3.0',
  kind: 'video',
  protocol: 'dashscope-video',
  baseUrl: 'https://ws1.cn-beijing.maas.aliyuncs.com',
  model: 'wan3.0-video',
  enabled: true,
  secretRef: 'k-vid',
}
const OLD = PROVIDERS.find((p) => p.id === 'vid')! // the tested 302.AI Wan Flash

beforeAll(async () => {
  media = await locateMedia()
  if (!media) {
    console.warn('[video refs pipeline] SKIPPED: ffmpeg not found')
    return
  }
  env = await makePipelineEnv(media, { aspectRatio: '9:16' })
  const inner = env.providers.fetch
  const video = () => env.media.videoSilent(1)
  env.deps.providers = {
    get: async (id) => [...PROVIDERS, ARK, KLING, WAN3].find((p) => p.id === id),
    list: async () => [...PROVIDERS, ARK, KLING, WAN3],
  }
  env.deps.executor = {
    sleep: async () => {},
    fetch: async (url, init) => {
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
      if (url.startsWith('https://ark.cn-beijing.volces.com')) {
        calls.push({ method, url, body })
        return method === 'POST'
          ? json({ id: 'cgt-1' })
          : json({ status: 'succeeded', content: { video_url: 'https://cdn.fake/new-1.mp4' } })
      }
      if (url.startsWith('https://api-singapore.klingai.com')) {
        calls.push({ method, url, body })
        return method === 'POST'
          ? json({ code: 0, data: { id: 'k-1', status: 'submitted' } })
          : json({
              code: 0,
              data: [
                {
                  id: 'k-1',
                  status: 'succeeded',
                  outputs: [{ type: 'video', url: 'https://cdn.fake/new-1.mp4', duration: '2' }],
                },
              ],
            })
      }
      if (url.includes('maas.aliyuncs.com')) {
        calls.push({ method, url, body })
        return method === 'POST'
          ? json({ output: { task_id: 'w-1', task_status: 'PENDING' } })
          : json({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.fake/new-1.mp4' } })
      }
      if (url === 'https://cdn.fake/new-1.mp4') {
        return new Response(await video(), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        })
      }
      return inner(url, init)
    },
  }
  const ep = await prepareEpisode(env)
  const shots = await episodeShots(env.deps.store, ep.id)
  const used = new Set<string>()
  for (const s of shots)
    for (const r of await env.deps.store.shotRefs.listByShot(s.id)) used.add(r.assetId)
  await requestGeneration(
    env.deps,
    env.projectId,
    [...used].map(
      (id): AdmissionTarget => ({
        target: { kind: 'asset_sheet', assetId: id },
        provider: env.provider('img'),
        sheetLayout: 'multi_view',
      }),
    ),
  )
  await runAll(env)
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
  // the shot with the most registered assets
  let best = shots[0]!
  let bestN = -1
  for (const s of shots) {
    const n = (await env.deps.store.shotRefs.listByShot(s.id)).length
    if (n > bestN) [best, bestN] = [s, n]
  }
  shot = (await env.deps.store.shots.get(best.id))!
  wanted = []
  for (const r of await env.deps.store.shotRefs.listByShot(shot.id)) {
    wanted.push((await env.deps.store.assets.get(r.assetId))!.name)
  }
}, 240_000)

const real = (name: string, fn: () => Promise<void>, timeout = 60_000) =>
  it(
    name,
    async (ctx) => {
      if (!media) return ctx.skip()
      await fn()
    },
    timeout,
  )

const target = (provider: ProviderConfig, videoRefs?: boolean): AdmissionTarget => ({
  target: { kind: 'shot_video', shotId: shot.id },
  provider,
  resolution: ['dashscope-video', 'aliyun-video'].includes(provider.protocol) ? '720P' : '720p',
  confirmUnverified: true,
  ...(videoRefs ? { videoRefs: true } : {}),
})

async function generate(provider: ProviderConfig, videoRefs?: boolean) {
  calls.length = 0
  await requestGeneration(env.deps, env.projectId, [target(provider, videoRefs)], {
    confirmUnverified: true,
  })
  const jobs = await runAll(env)
  const job = jobs.filter((j) => j.operation === 'shot_video').at(-1)!
  const s = (await env.deps.store.shots.get(shot.id))!
  return { job, version: currentVersion(s.video)!, post: calls.find((c) => c.method === 'POST')! }
}

describe('video with reference images (task parameter videoRefs, default off)', () => {
  real(
    'default off: an Ark job sends the first frame only, the job params and the version carry nothing new',
    async () => {
      const { job, version, post } = await generate(ARK)
      expect(job.status).toBe('succeeded')
      expect(job.params).not.toHaveProperty('videoRefs')
      expect(version.usedReferences).toBeUndefined()
      const roles = (post.body!.content as Array<{ role?: string; type: string }>).map(
        (c) => c.role ?? c.type,
      )
      expect(roles).toEqual(['text', 'first_frame'])
      expect(post.body!.ratio).toBe('adaptive')
      expect(job.result).not.toHaveProperty('references')
    },
  )

  real(
    'Seedance (mutually exclusive): the shot image becomes reference 1, the prompt says so and numbers the assets from 2',
    async () => {
      const pre = await preflightTargets(env.deps, env.projectId, [target(ARK, true)], {
        confirmUnverified: true,
      })
      expect(pre.results[0]!.video).toMatchObject({
        frame: 'as_reference',
        ifRefsOn: 'frame_as_reference',
        refsRequested: true,
      })
      expect(pre.results[0]!.warnings.map((w) => w.code)).toContain(
        'FIRST_FRAME_REPLACED_BY_REFERENCE',
      )

      const { job, version, post } = await generate(ARK, true)
      expect(job.status).toBe('succeeded')
      expect(job.params.videoRefs).toBe(true)
      const content = post.body!.content as Array<{ type: string; role?: string; text?: string }>
      expect(content.map((c) => c.role ?? c.type)).toEqual([
        'text',
        ...Array(wanted.length + 1).fill('reference_image'), // the shot image + the assets
      ])
      expect(content.some((c) => c.role === 'first_frame' || c.role === 'last_frame')).toBe(false)
      expect(post.body!.ratio).toBe('9:16')
      const text = content[0]!.text!
      expect(text).toContain('图1是开场画面，视频从这一帧开始。')
      for (const [i, name] of wanted.entries())
        expect(text).toContain(`图${i + 2}是${name}的参考图`)
      // the record on the version itself
      expect(version.usedReferences).toMatchObject({ frame: 'as_reference', trimmed: 0 })
      const roles = version.usedReferences!.references.map((r) => r.role)
      expect(roles[0]).toBe('start_frame')
      expect(roles).toHaveLength(wanted.length + 1)
      expect(version.usedReferences!.references[1]!.assetName).toBe(wanted[0])
      expect(version.usedReferences!.references.every((r) => r.sha256)).toBe(true)
      expect(job.result).toMatchObject({ references: wanted.length, frameAsReference: true })
    },
  )

  real(
    'Kling (both together): first_frame stays, references get ids image_n, the prompt uses @image_n',
    async () => {
      const { version, post } = await generate(KLING, true)
      expect(post.url).toBe('https://api-singapore.klingai.com/omni-video/kling-4.0')
      const contents = post.body!.contents as Array<{ type: string; id?: string; text?: string }>
      expect(contents.map((c) => c.type)).toEqual([
        'prompt',
        'first_frame',
        ...wanted.map(() => 'refer_image'),
      ])
      expect(contents.filter((c) => c.type === 'refer_image').map((c) => c.id)).toEqual(
        wanted.map((_, i) => `image_${i + 1}`),
      )
      const text = contents[0]!.text!
      expect(text).not.toContain('开场画面') // the frame is a real first frame here
      for (const [i, name] of wanted.entries()) expect(text).toContain(`@image_${i + 1}（${name}）`)
      expect(version.usedReferences).toMatchObject({ frame: 'with_references' })
      expect(version.usedReferences!.references.map((r) => r.role)).not.toContain('start_frame')
    },
  )

  real(
    'Wan 3.0: media is reference_image only (no first_frame), numbered like Seedance',
    async () => {
      const { post, version } = await generate(WAN3, true)
      expect(post.url).toContain('/api/v1/services/aigc/video-generation/video-synthesis')
      const m = post.body!.input as { media: Array<{ type: string }>; prompt: string }
      expect(m.media.map((x) => x.type)).toEqual(
        wanted.concat('frame').map(() => 'reference_image'),
      )
      expect(m.prompt).toContain('图1是开场画面')
      expect((post.body!.parameters as { ratio: string }).ratio).toBe('9:16')
      expect(version.usedReferences!.frame).toBe('as_reference')
    },
  )

  real(
    'a model that takes no reference images (the tested Wan Flash) is refused at admission, before any money',
    async () => {
      const pre = await preflightTargets(env.deps, env.projectId, [target(OLD, true)], {
        confirmUnverified: true,
      })
      expect(pre.ok).toBe(false)
      expect(pre.results[0]!.reasons.map((r) => r.code)).toContain('REFERENCE_NOT_SUPPORTED')
    },
  )

  real(
    'the tested Wan Flash preset, refs off: the same request as ever, no new fields anywhere',
    async () => {
      const { job, version, post } = await generate(OLD)
      expect(job.status).toBe('succeeded')
      expect(job.params).not.toHaveProperty('videoRefs')
      expect(version.usedReferences).toBeUndefined()
      void post
      const submit = env.providers.posts('/video-synthesis').at(-1)!.body as Record<string, unknown>
      expect(Object.keys(submit).sort()).toEqual(['input', 'model', 'parameters'])
      expect(Object.keys(submit.input as object).sort()).toEqual(['img_url', 'prompt'])
    },
  )

  real(
    'exec 21: the preflight list of references is the list the job used (same function), for every protocol that takes references',
    async () => {
      for (const p of [ARK, KLING, WAN3]) {
        const pre = await preflightTargets(env.deps, env.projectId, [target(p, true)], {
          confirmUnverified: true,
        })
        const plan = pre.results[0]!.video!
        const { version } = await generate(p, true)
        const used = version.usedReferences!
        expect(plan.references, p.model).toEqual(used.references)
        expect(plan.dropped!.length, p.model).toBe(used.trimmed)
        expect(plan.referenceCount, p.model).toBe(used.references.length)
        // order is 1, 2, 3… — the number the prompt uses for "图 N"
        expect(
          plan.references!.map((r) => r.order),
          p.model,
        ).toEqual(used.references.map((_, i) => i + 1))
        // the names carry the variant exactly as the version record does
        expect(
          plan.references!.map((r) => [r.assetName, r.variantName]),
          p.model,
        ).toEqual(used.references.map((r) => [r.assetName, r.variantName]))
        if (used.frame === 'as_reference') {
          expect(plan.references![0]).toMatchObject({ role: 'start_frame', order: 1 })
          expect(plan.startFrame).toMatchObject({ use: 'reference' })
        } else {
          expect(plan.references!.map((r) => r.role)).not.toContain('start_frame')
          expect(plan.startFrame).toMatchObject({ use: 'first_frame' })
        }
        expect(plan.startFrame!.versionId).toBeTruthy()
      }
    },
  )

  real(
    'exec 21: references that did not fit are listed as dropped (over_limit), and the used list still equals the version record',
    async () => {
      const tiny: ProviderConfig = {
        ...ARK,
        id: 'ark-tiny',
        capabilityOverrides: { refImages: { support: 'unverified', value: 2 } },
      }
      const prev = env.deps.providers
      env.deps.providers = {
        get: async (id) => (id === tiny.id ? tiny : prev.get(id)),
        list: async () => [...(await prev.list()), tiny],
      }
      try {
        const pre = await preflightTargets(env.deps, env.projectId, [target(tiny, true)], {
          confirmUnverified: true,
        })
        const plan = pre.results[0]!.video!
        const { version } = await generate(tiny, true)
        expect(wanted.length).toBeGreaterThan(1)
        expect(plan.references).toEqual(version.usedReferences!.references)
        expect(plan.references!.map((r) => r.role)).toEqual(['start_frame', expect.any(String)])
        expect(plan.dropped).toHaveLength(wanted.length - 1)
        expect(plan.dropped!.every((d) => d.reason === 'over_limit' && d.assetName)).toBe(true)
        expect(plan.droppedReferences).toBe(version.usedReferences!.trimmed)
        // every registered asset is accounted for exactly once: used or dropped
        const names = [
          ...plan.references!.filter((r) => r.assetName).map((r) => r.assetName),
          ...plan.dropped!.map((d) => d.assetName),
        ]
        expect(names.sort()).toEqual([...wanted].sort())
      } finally {
        env.deps.providers = prev
      }
    },
  )

  real(
    'exec 21: with references off the plan carries none of the new fields (a default-path verdict is as before)',
    async () => {
      for (const p of [ARK, OLD]) {
        const pre = await preflightTargets(env.deps, env.projectId, [target(p)], {
          confirmUnverified: true,
        })
        const plan = pre.results[0]!.video!
        expect(plan, p.model).not.toHaveProperty('references')
        expect(plan, p.model).not.toHaveProperty('dropped')
        expect(plan, p.model).not.toHaveProperty('startFrame')
      }
    },
  )

  real(
    'review fix 1: a job that reaches the task entry with references on for a first-frame-only protocol fails with a stable code, before any request',
    async () => {
      const custom: ProviderConfig = {
        id: 'legacy-custom',
        label: 'My own Wan',
        kind: 'video',
        protocol: 'aliyun-video',
        baseUrl: 'https://api.302ai.cn',
        model: 'my-own-wan',
        enabled: true,
        secretRef: 'k-vid',
      }
      const prev = env.deps.providers
      env.deps.providers = {
        get: async (id) => (id === custom.id ? custom : prev.get(id)),
        list: async () => [...(await prev.list()), custom],
      }
      const before = env.providers.posts('/video-synthesis').length
      const now = env.deps.clock.now()
      await env.deps.store.jobs.insert({
        schemaVersion: SCHEMA_VERSIONS.job,
        id: 'job_forced_refs',
        type: 'video',
        operation: 'shot_video',
        projectId: env.projectId,
        shotId: shot.id,
        params: {
          target: { kind: 'shot_video', shotId: shot.id },
          resolution: '720P',
          videoRefs: true,
        },
        paid: true,
        status: 'queued',
        attempt: 0,
        previousProviderJobIds: [],
        createdAt: now,
        updatedAt: now,
        providerSnapshot: {
          providerConfigId: custom.id,
          protocol: custom.protocol,
          baseUrl: custom.baseUrl,
          model: custom.model,
        },
      })
      const jobs = await runAll(env)
      const job = jobs.find((j) => j.id === 'job_forced_refs')!
      expect(job.status).toBe('failed')
      expect(job.error).toMatchObject({
        code: 'REFERENCE_NOT_SUPPORTED',
        category: 'invalid_input',
        recoverable: false,
      })
      expect(env.providers.posts('/video-synthesis').length).toBe(before) // nothing was sent
      env.deps.providers = prev
    },
  )
})
