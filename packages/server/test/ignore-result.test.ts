import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'
import { addProviders, prepareEpisodeViaApi, waitJobsIdle } from './api-flow.ts'
import { fakeLlm, fakeProviders, locateMedia, mediaFactory } from './fakes.ts'
import type { MediaEnv } from './fakes.ts'

/**
 * “忽略结果”：对运行中的付费任务，用户能做的不是取消，而是忽略结果。
 * 任务照常跑完，产物照常保存进版本历史（钱已经花了），但不自动成为当前版本、也不登记为当前产物。
 */
let media: MediaEnv | undefined
beforeAll(async () => {
  media = await locateMedia()
  if (!media) console.warn('[ignore-result] SKIPPED: ffmpeg not found')
})
afterEach(cleanupAll)

const tick = () => new Promise<void>((r) => setTimeout(r, 5))
const until = async (pred: () => Promise<boolean>, label: string, ms = 20_000) => {
  const end = Date.now() + ms
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}

async function setup() {
  const providers = fakeProviders(mediaFactory(media!.bins), { videoHasAudio: true })
  const h = await startServer({
    llm: fakeLlm().client,
    executor: { fetch: providers.fetch, sleep: tick },
    workerIntervalMs: 20,
  })
  const ids = await addProviders(h)
  const { projectId, episode } = await prepareEpisodeViaApi(h, ids, { chapters: 2, fill: 1 })
  const detail = await h.client.call('episodes.get', { params: { episodeId: episode.id } })
  const shots = detail.shots.slice(0, 2).map((s) => s.id)
  const { items: assets } = await h.client.call('assets.list', { params: { projectId } })
  await h.client.call('generate.submit', {
    params: { projectId },
    body: {
      items: assets.map((a) => ({ target: { kind: 'asset_sheet' as const, assetId: a.id } })),
    },
  })
  await waitJobsIdle(h, projectId)
  await h.client.call('generate.submit', {
    params: { projectId },
    body: { items: shots.map((shotId) => ({ target: { kind: 'shot_image' as const, shotId } })) },
  })
  await waitJobsIdle(h, projectId)
  return { providers, h, ids, projectId, episodeId: episode.id, shots, assets }
}

const submitVideo = async (h: Harness, projectId: string, shotId: string, providerId: string) => {
  const res = await h.client.call('generate.submit', {
    params: { projectId },
    body: {
      items: [{ target: { kind: 'shot_video' as const, shotId }, providerId, resolution: '720p' }],
      confirmUnverified: true,
    },
  })
  return res.succeeded[0]!.jobId
}

const real = (name: string, fn: () => Promise<void>) =>
  it(
    name,
    async (ctx) => {
      if (!media) return ctx.skip()
      await fn()
    },
    120_000,
  )

describe('ignoring the result of a running paid job', () => {
  real(
    'video: runs to the end, lands in the version history, but is not adopted; the user can still pick it later',
    async () => {
      const { providers, h, ids, projectId, episodeId, shots } = await setup()
      providers.faults.holdPolls = true
      const jobId = await submitVideo(h, projectId, shots[0]!, ids.seedance!)
      await until(
        async () => !!(await h.client.call('jobs.get', { params: { jobId } })).providerJobId,
        'upstream id',
      )
      const seen: Array<{ type: string; job?: { id: string; ignoreResult?: boolean } }> = []
      h.server.ctx.bus.subscribe((b) => seen.push(b.event as never))

      const marked = await h.client.call('jobs.ignoreResult', { params: { jobId }, body: {} })
      expect(marked).toMatchObject({ status: 'running', ignoreResult: true, resultIgnored: true })
      await h.server.ctx.events.idle()
      expect(
        seen.some((e) => e.type === 'job.updated' && e.job?.id === jobId && e.job.ignoreResult),
      ).toBe(true)

      providers.faults.holdPolls = false // 上游完成了
      await waitJobsIdle(h, projectId)
      const done = await h.client.call('jobs.get', { params: { jobId } })
      expect(done).toMatchObject({ status: 'succeeded', resultIgnored: true })
      expect(done.result).toMatchObject({ ignored: true })

      const { shot } = await h.client.call('shots.get', { params: { shotId: shots[0]! } })
      expect(shot.video.versions).toHaveLength(1) // 钱花了，成品不丢
      expect(shot.video.currentVersionId).toBeNull() // 但不自动成为当前版本
      expect(
        await h.server.ctx.files.exists(shot.projectId, shot.video.versions[0]!.file.path),
      ).toBe(true)
      expect(
        await h.server.ctx.store.artifacts.get(projectId, `shot_video:${shots[0]}`),
      ).toBeUndefined()
      const artifacts = (await h.client.call('episodes.artifacts', { params: { episodeId } })).items
      expect(artifacts.find((a) => a.key === `shot_video:${shots[0]}`)?.status).not.toBe('current')

      // 之后用户改主意：从版本历史里手动选用，它就成为当前版本、并登记产物
      await h.client.call('shots.setCurrentVersion', {
        params: { shotId: shots[0]! },
        body: { slot: 'video', versionId: shot.video.versions[0]!.id },
      })
      const after = (await h.client.call('shots.get', { params: { shotId: shots[0]! } })).shot
      expect(after.video.currentVersionId).toBe(shot.video.versions[0]!.id)
      expect(
        await h.server.ctx.store.artifacts.get(projectId, `shot_video:${shots[0]}`),
      ).toBeDefined()
    },
  )

  real('image/sheet: ignored too — a version is kept, none becomes current', async () => {
    const { providers, h, projectId, assets } = await setup()
    const asset = assets[0]!
    let release!: () => void
    providers.faults.imageGate = new Promise<void>((r) => (release = r))
    const res = await h.client.call('generate.submit', {
      params: { projectId },
      body: { items: [{ target: { kind: 'asset_sheet' as const, assetId: asset.id } }] },
    })
    const jobId = res.succeeded[0]!.jobId
    await until(
      async () => (await h.client.call('jobs.get', { params: { jobId } })).status === 'running',
      'running',
    )
    const before = (await h.client.call('assets.get', { params: { assetId: asset.id } })).asset
    const oldCurrent = before.sheet.currentVersionId
    await h.client.call('jobs.ignoreResult', { params: { jobId }, body: { ignore: true } })
    release()
    await waitJobsIdle(h, projectId)
    const after = (await h.client.call('assets.get', { params: { assetId: asset.id } })).asset
    expect(after.sheet.versions).toHaveLength(before.sheet.versions.length + 1)
    expect(after.sheet.currentVersionId).toBe(oldCurrent) // 没动
    expect((await h.client.call('jobs.get', { params: { jobId } })).result).toMatchObject({
      ignored: true,
    })
  })

  real('can be undone while running: then the result is adopted as usual', async () => {
    const { providers, h, ids, projectId, shots } = await setup()
    providers.faults.holdPolls = true
    const jobId = await submitVideo(h, projectId, shots[1]!, ids.seedance!)
    await until(
      async () => !!(await h.client.call('jobs.get', { params: { jobId } })).providerJobId,
      'upstream id',
    )
    await h.client.call('jobs.ignoreResult', { params: { jobId }, body: {} })
    const undone = await h.client.call('jobs.ignoreResult', {
      params: { jobId },
      body: { ignore: false },
    })
    expect(undone).toMatchObject({ resultIgnored: false })
    expect(undone.ignoreResult).toBeUndefined()
    providers.faults.holdPolls = false
    await waitJobsIdle(h, projectId)
    const done = await h.client.call('jobs.get', { params: { jobId } })
    expect(done).toMatchObject({ status: 'succeeded', resultIgnored: false })
    const shot = (await h.client.call('shots.get', { params: { shotId: shots[1]! } })).shot
    expect(shot.video.currentVersionId).toBe(shot.video.versions[0]!.id)
    expect(
      await h.server.ctx.store.artifacts.get(projectId, `shot_video:${shots[1]}`),
    ).toBeDefined()
  })
})

describe('what ignore-result refuses (stable error codes)', () => {
  it('queued → NOT_RUNNING (cancel it instead), finished → ALREADY_FINISHED, text/render → NOT_APPLICABLE, unknown → 404', async () => {
    const h = await startServer({ startWorker: false })
    const q = h.server.ctx.queue
    const call = (jobId: string) =>
      h.client
        .call('jobs.ignoreResult', { params: { jobId }, body: {} })
        .catch((e) => e as { status: number; code: string })
    const { job: queued } = await q.enqueue({
      type: 'video',
      operation: 'shot_video',
      projectId: 'p',
    })
    expect(await call(queued.id)).toMatchObject({ status: 409, code: 'NOT_RUNNING' })
    await q.cancel(queued.id)
    expect(await call(queued.id)).toMatchObject({ status: 409, code: 'ALREADY_FINISHED' })
    const { job: text } = await q.enqueue({
      type: 'text',
      operation: 'episodes_plan',
      projectId: 'p',
      paid: false,
    })
    expect(await call(text.id)).toMatchObject({ status: 409, code: 'NOT_APPLICABLE' })
    const { job: render } = await q.enqueue({
      type: 'render',
      operation: 'compose',
      projectId: 'p',
    })
    expect(await call(render.id)).toMatchObject({ status: 409, code: 'NOT_APPLICABLE' })
    expect(await call('job_nope')).toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('a retry starts clean: the flag does not follow a failed job into its next attempt', async () => {
    const h = await startServer({ startWorker: false })
    const q = h.server.ctx.queue
    const store = h.server.ctx.store
    const { job } = await q.enqueue({
      type: 'video',
      operation: 'shot_video',
      projectId: 'p',
      paid: true,
    })
    await store.jobs.transition(job.id, ['queued'], { status: 'running', updatedAt: 1 })
    await h.client.call('jobs.ignoreResult', { params: { jobId: job.id }, body: {} })
    await store.jobs.transition(job.id, ['running'], {
      status: 'failed',
      providerJobId: 'up-1',
      error: { category: 'delivery_failed', code: 'POLL_FAILED', message: 'x', recoverable: true },
      updatedAt: 2,
    })
    const resumed = await h.client.call('jobs.resume', { params: { jobId: job.id } })
    expect(resumed.ignoreResult).toBeUndefined()
    expect(resumed.resultIgnored).toBe(false)
  })
})
