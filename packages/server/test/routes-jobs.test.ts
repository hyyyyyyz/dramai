import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '@dramai/api'
import {
  createEpisode,
  createProject,
  createScene,
  createShot,
  SCHEMA_VERSIONS,
} from '@dramai/core'
import type { Job, ProviderConfig } from '@dramai/core'
import { summarizeCosts } from '../src/services/cost.ts'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const IMG: ProviderConfig = {
  id: 'img',
  label: 'Nano Banana',
  kind: 'image',
  protocol: 'gemini-image',
  baseUrl: 'https://img.fake',
  model: 'gemini-2.5-flash-image',
  enabled: true,
  secretRef: 'k-img',
}
const TTS: ProviderConfig = {
  id: 'tts',
  label: 'TTS',
  kind: 'tts',
  protocol: 'openai-tts',
  baseUrl: 'https://tts.fake',
  model: 'tts-1',
  enabled: true,
}

function fakeFetch() {
  const calls: string[] = []
  const fetch = async (url: string | URL | Request) => {
    const u = String(url)
    calls.push(u)
    if (u.includes(':generateContent')) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ inline_data: { mime_type: 'image/png', data: PNG.toString('base64') } }],
              },
            },
          ],
        }),
        { status: 200 },
      )
    }
    return new Response('not found', { status: 404 })
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}

/** 建一个带一个镜头的项目；worker 开关由 `worker` 控制。 */
async function setup(options: { worker?: boolean; acceptUnverified?: boolean } = {}) {
  const net = fakeFetch()
  const h = await startServer({
    startWorker: options.worker ?? false,
    workerIntervalMs: 20,
    executor: {
      fetch: net.fetch,
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 10))),
    },
  })
  const { store, secrets, settings } = h.server.ctx
  await secrets.set('k-img', 'sk-test-image-key')
  await store.providers.put({
    ...IMG,
    acceptedUnverified:
      options.acceptUnverified === false
        ? undefined
        : ['mode:t2i', 'mode:i2i', 'refImages', 'aspectRatio'],
  })
  await store.providers.put(TTS)
  await settings.patchActive('image', 'img')
  const now = Date.now()
  let project = createProject({ id: 'p1', name: '测试', aspectRatio: '9:16', now })
  let episode = createEpisode({ id: 'e1', projectId: 'p1', number: 1, title: '第一集', now })
  let scene = createScene({ id: 's1', projectId: 'p1', episodeId: 'e1', number: 1, now })
  const shot = {
    ...createShot({ id: 'sh1', projectId: 'p1', sceneId: 's1', number: 1, now }),
    prompts: { firstFrame: 'a rainy street at night' },
  }
  scene = { ...scene, shotOrder: ['sh1'] }
  episode = { ...episode, sceneOrder: ['s1'] }
  project = { ...project, episodeOrder: ['e1'] }
  await store.projects.put(project)
  await store.episodes.put(episode)
  await store.scenes.put(scene)
  await store.shots.put(shot)
  return { h, net, store: h.server.ctx.store }
}

const failedJob = (over: Partial<Job> = {}): Job => ({
  schemaVersion: SCHEMA_VERSIONS.job,
  id: `job_${Math.random().toString(36).slice(2, 8)}`,
  type: 'video',
  operation: 'shot_video',
  projectId: 'p1',
  shotId: 'sh1',
  params: {},
  paid: true,
  status: 'failed',
  attempt: 1,
  previousProviderJobIds: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  error: { category: 'delivery_failed', code: 'DOWNLOAD_FAILED', message: 'x', recoverable: true },
  ...over,
})

const apiError = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p
  } catch (err) {
    if (err instanceof ApiError) return err
    throw err
  }
  throw new Error('expected an ApiError')
}

describe('cost summary', () => {
  it('sums per currency, counts unpriced without guessing, and converts only with a rate', () => {
    const estimates = [
      { priced: true as const, currency: 'CNY', amount: 1.5, approx: false },
      {
        priced: true as const,
        currency: 'CNY',
        amount: 0.5,
        range: [0.4, 0.8] as [number, number],
        approx: true,
      },
      { priced: true as const, currency: 'PTC', amount: 10, approx: false },
      { priced: false as const, reason: '未定价' },
    ]
    const plain = summarizeCosts(estimates)
    expect(plain.byCurrency.CNY).toMatchObject({ amount: 2, approx: true })
    expect(plain.byCurrency.PTC).toMatchObject({ amount: 10 })
    expect(plain.unpriced).toBe(1)
    expect(plain.converted).toBeUndefined()
    expect(plain.isEstimate).toBe(true)
    expect(Object.keys(plain.remaining).sort()).toEqual(['CNY', 'PTC'])

    const conv = summarizeCosts(estimates, {
      conversion: { targetCurrency: 'CNY', rates: { PTC: 0.1 } },
    })
    expect(conv.converted).toMatchObject({ currency: 'CNY', amount: 3, approx: true })
    expect(conv.remaining).toEqual({}) // CNY 本币、PTC 有汇率，都折进去了
    // 没有汇率的币种不折算、不猜
    const partial = summarizeCosts(estimates, { conversion: { targetCurrency: 'CNY', rates: {} } })
    expect(partial.converted).toMatchObject({ amount: 2 })
    expect(Object.keys(partial.remaining)).toEqual(['PTC'])
  })
})

describe('generate.preflight / generate.submit', () => {
  it('blocks with an actionable reason (not a 500) when no provider is selected, and has no side effects', async () => {
    const { h, store } = await setup()
    await h.server.ctx.settings.patchActive('image', undefined)
    const res = await h.client.call('generate.preflight', {
      params: { projectId: 'p1' },
      body: { items: [{ target: { kind: 'shot_image', shotId: 'sh1' } }] },
    })
    expect(res.ok).toBe(false)
    expect(res.results[0]).toMatchObject({ status: 'blocked', reasons: [{ code: 'NO_PROVIDER' }] })
    expect(res.results[0]!.reasons[0]!.message).toContain('服务商')
    expect(await store.jobs.list()).toHaveLength(0)

    const sub = await h.client.call('generate.submit', {
      params: { projectId: 'p1' },
      body: { items: [{ target: { kind: 'shot_image', shotId: 'sh1' } }] },
    })
    expect(sub.succeeded).toEqual([])
    expect(sub.blocked[0]).toMatchObject({ reasons: [{ code: 'NO_PROVIDER' }] })
    expect(await store.jobs.list()).toHaveLength(0)
  })

  it('reports an unknown providerId as a blocked verdict', async () => {
    const { h } = await setup()
    const res = await h.client.call('generate.preflight', {
      params: { projectId: 'p1' },
      body: { items: [{ target: { kind: 'shot_image', shotId: 'sh1' }, providerId: 'nope' }] },
    })
    expect(res.results[0]).toMatchObject({
      status: 'blocked',
      reasons: [{ code: 'PROVIDER_NOT_FOUND' }],
    })
  })

  it('404s for an unknown project', async () => {
    const { h } = await setup()
    const err = await apiError(
      h.client.call('generate.preflight', {
        params: { projectId: 'nope' },
        body: { items: [{ target: { kind: 'shot_image', shotId: 'sh1' } }] },
      }),
    )
    expect(err.status).toBe(404)
  })

  it('previews verdict + cost read-only, then submits and the job runs to completion', async () => {
    const { h, store, net } = await setup({ worker: true })
    const body = { items: [{ target: { kind: 'shot_image' as const, shotId: 'sh1' } }] }
    const pre = await h.client.call('generate.preflight', { params: { projectId: 'p1' }, body })
    expect(pre.ok).toBe(true)
    expect(pre.results[0]).toMatchObject({ targetId: 'shot_image:sh1', status: 'accepted' })
    expect(pre.totals.isEstimate).toBe(true)
    expect(net.calls).toHaveLength(0)
    expect(await store.jobs.list()).toHaveLength(0)

    const sub = await h.client.call('generate.submit', { params: { projectId: 'p1' }, body })
    expect(sub.succeeded).toHaveLength(1)
    const jobId = sub.succeeded[0]!.jobId
    await h.server.ctx.worker.idle()
    // worker 可能还没拾起：轮询到完成
    for (let i = 0; i < 100; i++) {
      const j = await h.client.call('jobs.get', { params: { jobId } })
      if (j.status === 'succeeded' || j.status === 'failed') break
      await new Promise((r) => setTimeout(r, 20))
    }
    const done = await h.client.call('jobs.get', { params: { jobId } })
    expect(done).toMatchObject({ status: 'succeeded', needsAttention: false })
    expect(net.calls.filter((c) => c.includes(':generateContent'))).toHaveLength(1)
    const shot = (await store.shots.get('sh1'))!
    expect(shot.image.currentVersionId).toBeTruthy()
  })

  it('creates exactly one job for two concurrent submissions of the same target', async () => {
    const { h, store } = await setup()
    const body = { items: [{ target: { kind: 'shot_image' as const, shotId: 'sh1' } }] }
    const [a, b] = await Promise.all([
      h.client.call('generate.submit', { params: { projectId: 'p1' }, body }),
      h.client.call('generate.submit', { params: { projectId: 'p1' }, body }),
    ])
    const jobs = await store.jobs.list()
    expect(jobs).toHaveLength(1)
    expect(a.succeeded[0]!.jobId).toBe(b.succeeded[0]!.jobId)
    expect([a.succeeded[0]!.deduped, b.succeeded[0]!.deduped].sort()).toEqual([false, true])
  })

  it('needs confirmation for unverified capabilities, and proceeds once confirmed', async () => {
    const { h, store } = await setup({ acceptUnverified: false })
    const body = { items: [{ target: { kind: 'shot_image' as const, shotId: 'sh1' } }] }
    const pre = await h.client.call('generate.preflight', { params: { projectId: 'p1' }, body })
    expect(pre.results[0]!.status).toBe('needs_confirmation')
    expect(pre.results[0]!.unverified.length).toBeGreaterThan(0)
    expect(pre.ok).toBe(false)

    const blocked = await h.client.call('generate.submit', { params: { projectId: 'p1' }, body })
    expect(blocked.succeeded).toEqual([])
    expect(blocked.blocked).toHaveLength(1)
    expect(await store.jobs.list()).toHaveLength(0)

    const ok = await h.client.call('generate.submit', {
      params: { projectId: 'p1' },
      body: { ...body, confirmUnverified: true },
    })
    expect(ok.succeeded).toHaveLength(1)
    expect(ok.admission.results[0]!.warnings.some((w) => w.code === 'CAPABILITY_UNVERIFIED')).toBe(
      true,
    )
  })

  it('one bad item blocks the whole batch and names who blocked it', async () => {
    const { h, store } = await setup()
    const res = await h.client.call('generate.submit', {
      params: { projectId: 'p1' },
      body: {
        items: [
          { target: { kind: 'shot_image', shotId: 'sh1' } },
          { target: { kind: 'shot_image', shotId: 'missing' } },
        ],
      },
    })
    expect(res.succeeded).toEqual([])
    const verdicts = Object.fromEntries(res.admission.results.map((v) => [v.targetId, v]))
    expect(verdicts['shot_image:missing']!.status).toBe('blocked')
    expect(verdicts['shot_image:sh1']).toMatchObject({
      status: 'blocked_by_batch',
      blockedBy: ['shot_image:missing'],
    })
    expect(await store.jobs.list()).toHaveLength(0)
  })

  it('rejects malformed bodies with 400', async () => {
    const { h } = await setup()
    const r = await h.raw('/api/projects/p1/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [] }),
    })
    expect(r.status).toBe(400)
  })
})

describe('jobs routes', () => {
  it('lists with filters, newest first, with queue positions and needsAttention', async () => {
    const { h, store } = await setup()
    const q1 = failedJob({ id: 'q1', status: 'queued', type: 'image', createdAt: 1 })
    const q2 = failedJob({ id: 'q2', status: 'queued', type: 'image', createdAt: 2 })
    const f1 = failedJob({ id: 'f1', createdAt: 3 })
    const f2 = failedJob({ id: 'f2', createdAt: 4, acknowledgedAt: 5 })
    for (const j of [q1, q2, f1, f2])
      await store.jobs.insert({ ...j, error: j.status === 'failed' ? j.error : undefined })

    const all = await h.client.call('jobs.list', { query: { projectId: 'p1' } })
    expect(all.items.map((j) => j.id)).toEqual(['f2', 'f1', 'q2', 'q1'])
    expect(all.items.find((j) => j.id === 'q2')!.queuePosition).toBe(2)
    expect(all.items.find((j) => j.id === 'q1')!.queuePosition).toBe(1)

    const attention = await h.client.call('jobs.list', { query: { needsAttention: true } })
    expect(attention.items.map((j) => j.id)).toEqual(['f1'])
    const queued = await h.client.call('jobs.list', { query: { status: 'queued' } })
    expect(queued.items.map((j) => j.id).sort()).toEqual(['q1', 'q2'])
    const multi = await h.client.call('jobs.list', { query: { status: 'queued,failed', limit: 3 } })
    expect(multi.items).toHaveLength(3)
    expect(
      (await apiError(h.client.call('jobs.list', { query: { status: 'bogus' } }))).status,
    ).toBe(400)
  })

  it('cancels a queued job and refuses finished ones with a stable 409 code', async () => {
    const { h, store } = await setup()
    await store.jobs.insert(failedJob({ id: 'q', status: 'queued', error: undefined }))
    const cancelled = await h.client.call('jobs.cancel', { params: { jobId: 'q' } })
    expect(cancelled.status).toBe('cancelled')
    const again = await apiError(h.client.call('jobs.cancel', { params: { jobId: 'q' } }))
    expect(again).toMatchObject({ status: 409, code: 'ALREADY_FINISHED' })
    const running = failedJob({ id: 'r', status: 'running', error: undefined })
    await store.jobs.insert(running)
    expect(await apiError(h.client.call('jobs.cancel', { params: { jobId: 'r' } }))).toMatchObject({
      status: 409,
      code: 'RUNNING_NOT_CANCELLABLE',
    })
    expect(
      await apiError(h.client.call('jobs.cancel', { params: { jobId: 'zzz' } })),
    ).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('retry: only failed jobs; a possibly-billed one needs explicit confirmation', async () => {
    const { h, store } = await setup()
    await store.jobs.insert(failedJob({ id: 'ok', status: 'succeeded', error: undefined }))
    expect(
      await apiError(h.client.call('jobs.retry', { params: { jobId: 'ok' }, body: {} })),
    ).toMatchObject({
      status: 409,
      code: 'NOT_FAILED',
    })

    await store.jobs.insert(failedJob({ id: 'paid', providerJobId: 'task-1' }))
    const needs = await apiError(
      h.client.call('jobs.retry', { params: { jobId: 'paid' }, body: {} }),
    )
    expect(needs).toMatchObject({ status: 409, code: 'CONFIRM_RECHARGE_REQUIRED' })
    expect(needs.message).toContain('计费')
    expect(needs.details).toMatchObject({ jobId: 'paid', requires: 'confirmRecharge' })

    const retried = await h.client.call('jobs.retry', {
      params: { jobId: 'paid' },
      body: { confirmRecharge: true },
    })
    expect(retried).toMatchObject({ status: 'queued', attempt: 2, needsAttention: false })
    expect(retried.previousProviderJobIds).toEqual(['task-1'])
    expect(retried.providerJobId).toBeUndefined()
  })

  it('resume continues the original upstream task; nothing to resume is a 409', async () => {
    const { h, store } = await setup()
    await store.jobs.insert(failedJob({ id: 'r1', providerJobId: 'task-9' }))
    const resumed = await h.client.call('jobs.resume', { params: { jobId: 'r1' } })
    expect(resumed).toMatchObject({ status: 'queued', providerJobId: 'task-9', resumeFrom: 'poll' })

    await store.jobs.insert(failedJob({ id: 'r2' }))
    expect(await apiError(h.client.call('jobs.resume', { params: { jobId: 'r2' } }))).toMatchObject(
      {
        status: 409,
        code: 'NOTHING_TO_RESUME',
      },
    )
  })

  it('acknowledge clears needsAttention, idempotently', async () => {
    const { h, store } = await setup()
    await store.jobs.insert(failedJob({ id: 'a1' }))
    expect((await h.client.call('jobs.get', { params: { jobId: 'a1' } })).needsAttention).toBe(true)
    const acked = await h.client.call('jobs.acknowledge', { params: { jobId: 'a1' } })
    expect(acked.needsAttention).toBe(false)
    expect(acked.acknowledgedAt).toBeDefined()
    const again = await h.client.call('jobs.acknowledge', { params: { jobId: 'a1' } })
    expect(again.acknowledgedAt).toBe(acked.acknowledgedAt)
    await store.jobs.insert(failedJob({ id: 'a2', status: 'queued', error: undefined }))
    expect(
      await apiError(h.client.call('jobs.acknowledge', { params: { jobId: 'a2' } })),
    ).toMatchObject({
      status: 409,
      code: 'NOT_FAILED',
    })
  })
})

describe('import.legacy', () => {
  const backup = {
    format: 'dramai-backup',
    version: 1,
    exportedAt: 1,
    appVersion: '0.4.1',
    projects: [
      {
        id: 'old-1',
        title: '旧项目',
        summary: '概要',
        style: '',
        status: 'done',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    characters: [],
    materials: [],
    storyboards: [],
    assets: [],
    generations: [],
  }
  const upload = (text: string, extra: Record<string, string> = {}) => {
    const form = new FormData()
    form.set('file', new File([text], 'backup.json', { type: 'application/json' }))
    for (const [k, v] of Object.entries(extra)) form.set(k, v)
    return form
  }

  it('imports a v0.4 backup, makes the project visible, and skips a re-import', async () => {
    const { h, store } = await setup()
    const before = (await store.projects.list()).length
    const res = await h.client.call('import.legacy', { form: upload(JSON.stringify(backup)) })
    expect(res.projects).toHaveLength(1)
    expect(res.projects[0]).toMatchObject({ legacyId: 'old-1', name: '旧项目' })
    expect((await store.projects.list()).length).toBe(before + 1)
    const again = await h.client.call('import.legacy', { form: upload(JSON.stringify(backup)) })
    expect(again.projects).toEqual([])
    expect(again.skipped).toEqual([{ legacyId: 'old-1', reason: 'ALREADY_IMPORTED' }])
    const dup = await h.client.call('import.legacy', {
      form: upload(JSON.stringify(backup), { allowDuplicate: 'true' }),
    })
    expect(dup.projects).toHaveLength(1)
  })

  it('rejects files that are not backups with 400, and a missing file field', async () => {
    const { h } = await setup()
    const bad = await apiError(h.client.call('import.legacy', { form: upload('不是 json') }))
    expect(bad.status).toBe(400)
    const wrong = await apiError(
      h.client.call('import.legacy', { form: upload(JSON.stringify({ format: 'x', version: 1 })) }),
    )
    expect(wrong.status).toBe(400)
    const none = await apiError(h.client.call('import.legacy', { form: new FormData() }))
    expect(none.status).toBe(400)
  })
})
