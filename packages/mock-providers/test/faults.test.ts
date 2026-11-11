import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@dramai/api'
import { createServer } from '@dramai/server'
import type { DramaiServer } from '@dramai/server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockProviders } from '../src/index.ts'
import type { FaultKind, MockProviders } from '../src/index.ts'
import { addProviders, waitJobs } from './flow.ts'
import { STORY } from './story.ts'

/**
 * 失败注入：每种故障注入一次，确认任务落到正确的失败分类上。
 * 分类的含义（见 core 的 jobs/types.ts）：
 *  generation_failed  上游明确拒绝 / 确认失败——没有费用，重试 = 重新生成
 *  submission_unknown 请求可能已送达——不得自动重投，用户确认后才能重来
 *  delivery_failed    上游已成功，交付失败——可以续上原任务
 */
let mock: MockProviders
let server: DramaiServer
let api: ReturnType<typeof createClient>
let dataDir: string
let ffmpegOk = false
let projectId = ''
let ids: Record<string, string> = {}
let shots: string[] = []
let assets: string[] = []

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dramai-mock-faults-'))
  mock = await startMockProviders({ config: { videoMs: 100, streamChunkMs: 0 } })
  server = await createServer({
    dataDir,
    port: 0,
    validateResponses: true,
    workerIntervalMs: 20,
    executor: { sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 15))) },
    logger: { error: () => {} },
  })
  api = createClient({ baseUrl: server.url })
  ffmpegOk = (await api.call('system.get')).ffmpeg.ok
  if (!ffmpegOk) return
  ids = await addProviders(api, mock.url)
  const project = await api.call('projects.create', {
    body: {
      name: '旧信',
      aspectRatio: '9:16',
      narrationDelivery: 'tts',
      narrationVoice: { providerConfigId: ids.tts!, voice: 'alloy', speed: 1 },
    },
  })
  projectId = project.id
  const form = new FormData()
  form.set('file', new File([STORY], '旧信.txt', { type: 'text/plain' }))
  await api.call('materials.upload', { params: { projectId }, form })
  await api.call('episodes.plan', { params: { projectId }, body: { targetChars: 6000 } })
  await waitJobs(api, projectId)
  const episodeId = (await api.call('episodes.list', { params: { projectId } })).items[0]!.id
  await api.call('episodes.breakdown', { params: { episodeId }, body: {} })
  await waitJobs(api, projectId)
  await api.call('episodes.extractEntities', { params: { episodeId }, body: {} })
  await waitJobs(api, projectId)
  for (const c of (await api.call('candidates.list', { params: { projectId }, query: {} })).items) {
    if (c.status === 'pending')
      await api.call('candidates.accept', { params: { candidateId: c.id }, body: {} })
  }
  await api.call('episodes.generatePrompts', { params: { episodeId }, body: {} })
  await waitJobs(api, projectId)
  assets = (await api.call('assets.list', { params: { projectId } })).items.map((a) => a.id)
  const submit = async (
    items: Array<{
      target: { kind: 'asset_sheet'; assetId: string } | { kind: 'shot_image'; shotId: string }
    }>,
  ) => {
    const res = await api.call('generate.submit', { params: { projectId }, body: { items } })
    expect(res.blocked).toEqual([])
    await waitJobs(api, projectId)
  }
  await submit(assets.map((assetId) => ({ target: { kind: 'asset_sheet' as const, assetId } })))
  shots = (await api.call('episodes.get', { params: { episodeId } })).shots.map((s) => s.id)
  await submit(shots.map((shotId) => ({ target: { kind: 'shot_image' as const, shotId } })))
}, 120_000)

afterAll(async () => {
  await server?.close({ graceful: false })
  await mock?.close()
  await rm(dataDir, { recursive: true, force: true })
})

const real = (name: string, fn: () => Promise<void>) =>
  it(
    name,
    async (ctx) => {
      if (!ffmpegOk) return ctx.skip()
      mock.clearRules()
      await fn()
    },
    60_000,
  )

/** 注入一次故障，提交一个目标，等任务结束，返回这个目标的任务。 */
async function inject(
  fault: FaultKind,
  on: 'image' | 'video' | 'tts' | 'llm',
  target:
    | { kind: 'shot_image' | 'shot_video' | 'shot_audio'; shotId: string }
    | { kind: 'asset_sheet'; assetId: string },
  providerId?: string,
) {
  mock.addRule({ fault, on, times: 1 })
  const res = await api.call('generate.submit', {
    params: { projectId },
    body: { items: [{ target, providerId }], confirmUnverified: true },
  })
  expect(res.blocked).toEqual([])
  expect(res.succeeded).toHaveLength(1)
  const jobId = res.succeeded[0]!.jobId
  await waitJobs(api, projectId, { allowFailed: true, timeoutMs: 30_000 })
  return api.call('jobs.get', { params: { jobId } })
}

describe('submit-time faults (image)', () => {
  const cases: Array<[FaultKind, string, string, boolean]> = [
    ['rate_limit', 'generation_failed', 'HTTP_429', false],
    ['reject', 'generation_failed', 'HTTP_400', false],
    ['upstream_failed', 'generation_failed', 'HTTP_422', false],
    ['server_error', 'submission_unknown', 'HTTP_500', false],
    ['drop_connection', 'submission_unknown', '', false],
    ['bad_output', 'submission_unknown', 'UNREADABLE_RESPONSE', false],
  ]
  for (const [i, [fault, category, code]] of cases.entries()) {
    real(`image ${fault} → ${category}${code ? ` ${code}` : ''}`, async () => {
      const job = await inject(fault, 'image', {
        kind: 'shot_image',
        shotId: shots[i % shots.length]!,
      })
      expect(job.status).toBe('failed')
      expect(job.error?.category).toBe(category)
      if (code) expect(job.error?.code).toBe(code)
      expect(job.needsAttention).toBe(true)
    })
  }
})

describe('video faults', () => {
  real('submit rate limit → generation_failed (nothing was charged)', async () => {
    const job = await inject(
      'rate_limit',
      'video',
      { kind: 'shot_video', shotId: shots[0]! },
      ids.vid,
    )
    expect(job.error).toMatchObject({
      category: 'generation_failed',
      code: 'HTTP_429',
      recoverable: false,
    })
    expect(job.providerJobId).toBeUndefined()
  })

  real('submit 500 → submission_unknown (never auto-resubmitted)', async () => {
    const before = mock.counts().video
    const job = await inject(
      'server_error',
      'video',
      { kind: 'shot_video', shotId: shots[1]! },
      ids.vid,
    )
    expect(job.error).toMatchObject({ category: 'submission_unknown', code: 'HTTP_500' })
    expect(job.providerJobId).toBeUndefined()
    await new Promise((r) => setTimeout(r, 200))
    expect(mock.counts().video - before).toBe(1)
  })

  real('upstream says the task failed → generation_failed UPSTREAM_FAILED', async () => {
    const job = await inject(
      'upstream_failed',
      'video',
      { kind: 'shot_video', shotId: shots[2]! },
      ids.vid,
    )
    expect(job.error).toMatchObject({
      category: 'generation_failed',
      code: 'UPSTREAM_FAILED',
      recoverable: false,
    })
    expect(job.providerJobId).toBeTruthy()
  })

  real(
    'polling keeps failing → delivery_failed POLL_FAILED; once upstream recovers, resume continues the SAME task',
    async () => {
      const before = mock.counts().video
      const job = await inject(
        'poll_error',
        'video',
        { kind: 'shot_video', shotId: shots[3]! },
        ids.vid,
      )
      expect(job.error).toMatchObject({
        category: 'delivery_failed',
        code: 'POLL_FAILED',
        recoverable: true,
      })
      expect(job.providerJobId).toBeTruthy()
      mock.heal()
      await api.call('jobs.resume', { params: { jobId: job.id } })
      await waitJobs(api, projectId, { allowFailed: true })
      const done = await api.call('jobs.get', { params: { jobId: job.id } })
      expect(done.status).toBe('succeeded')
      expect(mock.counts().video - before).toBe(1) // 没有重新提交
    },
  )

  real(
    'finished upstream but the download 404s → delivery_failed HTTP_404; resume downloads again',
    async () => {
      const before = mock.counts().video
      const job = await inject(
        'download_error',
        'video',
        { kind: 'shot_video', shotId: shots[4]! },
        ids.vid,
      )
      expect(job.error).toMatchObject({
        category: 'delivery_failed',
        code: 'HTTP_404',
        recoverable: true,
      })
      mock.heal()
      await api.call('jobs.resume', { params: { jobId: job.id } })
      await waitJobs(api, projectId, { allowFailed: true })
      expect((await api.call('jobs.get', { params: { jobId: job.id } })).status).toBe('succeeded')
      expect(mock.counts().video - before).toBe(1)
    },
  )

  real(
    'a long queue keeps the job running (with its upstream id) and it completes once the queue clears',
    async () => {
      mock.configure({ slowQueueMs: 500 })
      mock.addRule({ fault: 'slow_queue', on: 'video', times: 1 })
      const res = await api.call('generate.submit', {
        params: { projectId },
        body: {
          items: [
            { target: { kind: 'shot_video' as const, shotId: shots[5]! }, providerId: ids.vid },
          ],
          confirmUnverified: true,
        },
      })
      const jobId = res.succeeded[0]!.jobId
      await new Promise((r) => setTimeout(r, 250))
      const waiting = await api.call('jobs.get', { params: { jobId } })
      expect(waiting.status).toBe('running')
      expect(waiting.providerJobId).toBeTruthy()
      await waitJobs(api, projectId, { allowFailed: true })
      expect((await api.call('jobs.get', { params: { jobId } })).status).toBe('succeeded')
      mock.configure({ slowQueueMs: 120_000 })
    },
  )
})

describe('other kinds', () => {
  real('TTS rate limit → generation_failed', async () => {
    const { items } = await api.call('episodes.list', { params: { projectId } })
    const detail = await api.call('episodes.get', { params: { episodeId: items[0]!.id } })
    const shot = detail.shots.find((s) => s.narration)
    expect(shot, 'the story should produce at least one narrated shot').toBeDefined()
    const job = await inject('rate_limit', 'tts', { kind: 'shot_audio', shotId: shot!.id }, ids.tts)
    expect(job.error).toMatchObject({ category: 'generation_failed', code: 'HTTP_429' })
  })

  real('LLM rate limit fails the text step (and leaves existing shots alone)', async () => {
    const { items } = await api.call('episodes.list', { params: { projectId } })
    const episodeId = items[0]!.id
    const before = (await api.call('episodes.get', { params: { episodeId } })).shots.length
    mock.addRule({ fault: 'rate_limit', on: 'llm', times: 1 })
    const { job } = await api.call('episodes.generatePrompts', {
      params: { episodeId },
      body: { onlyMissing: false },
    })
    await waitJobs(api, projectId, { allowFailed: true })
    const failed = await api.call('jobs.get', { params: { jobId: job.id } })
    expect(failed.status).toBe('failed')
    expect(failed.error?.message).toContain('429')
    expect((await api.call('episodes.get', { params: { episodeId } })).shots).toHaveLength(before)
  })

  real(
    'LLM bad output → the step fails with a clear reason (after the model gets a second try)',
    async () => {
      const { items } = await api.call('episodes.list', { params: { projectId } })
      const before = mock.counts().llm
      mock.addRule({ fault: 'bad_output', on: 'llm', times: 2 })
      const { job } = await api.call('episodes.generatePrompts', {
        params: { episodeId: items[0]!.id },
        body: { onlyMissing: false },
      })
      await waitJobs(api, projectId, { allowFailed: true })
      const failed = await api.call('jobs.get', { params: { jobId: job.id } })
      expect(failed.status).toBe('failed')
      expect(failed.error?.message).toMatch(/JSON|shots\.frames/)
      expect(mock.counts().llm - before).toBe(2) // 第一次不合格，带着问题重问了一次，仍不合格
    },
  )
})
