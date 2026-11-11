import { ProviderError } from '@dramai/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'
import { addProviders, prepareEpisodeViaApi, waitJobsIdle } from './api-flow.ts'
import { fakeLlm, fakeProviders, locateMedia, mediaFactory } from './fakes.ts'
import type { MediaEnv } from './fakes.ts'

/**
 * 重启恢复（真实 SQLite + 真实文件夹，进程内“杀掉”服务再用同一个数据目录重新启动）：
 * - 视频任务已拿到上游任务号 → 重启后继续轮询，**只提交过一次**；
 * - 付费任务还没拿到上游任务号（请求发出、结果不明）→ 重启后绝不重投，标记“结果不明”等用户决定。
 */
let media: MediaEnv | undefined
beforeAll(async () => {
  media = await locateMedia()
  if (!media) console.warn('[server recovery] SKIPPED: ffmpeg not found')
})
afterEach(cleanupAll)

const tick = () => new Promise<void>((r) => setTimeout(r, 5))

async function untilJob(
  h: Harness,
  projectId: string,
  pred: (j: { providerJobId?: string; status: string }) => boolean,
  label: string,
) {
  const deadline = Date.now() + 30_000
  for (;;) {
    const { items } = await h.client.call('jobs.list', { query: { projectId } })
    const video = items.find((j) => j.operation === 'shot_video')
    if (video && pred(video)) return video
    if (Date.now() > deadline) throw new Error(`timeout: ${label}; saw ${JSON.stringify(video)}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function setup() {
  const providers = fakeProviders(mediaFactory(media!.bins), { videoHasAudio: true })
  const options = {
    llm: fakeLlm().client,
    executor: { fetch: providers.fetch, sleep: tick },
    workerIntervalMs: 20,
  }
  const h1 = await startServer(options)
  const ids = await addProviders(h1)
  const { projectId, episode } = await prepareEpisodeViaApi(h1, ids, { chapters: 2, fill: 1 })
  const detail = await h1.client.call('episodes.get', { params: { episodeId: episode.id } })
  const shot = detail.shots[0]!
  const { items: assets } = await h1.client.call('assets.list', { params: { projectId } })
  await h1.client.call('generate.submit', {
    params: { projectId },
    body: {
      items: assets.map((a) => ({ target: { kind: 'asset_sheet' as const, assetId: a.id } })),
    },
  })
  await waitJobsIdle(h1, projectId)
  await h1.client.call('generate.submit', {
    params: { projectId },
    body: { items: [{ target: { kind: 'shot_image' as const, shotId: shot.id } }] },
  })
  await waitJobsIdle(h1, projectId)
  return { providers, options, h1, ids, projectId, shot }
}

const submitVideo = (h: Harness, projectId: string, shotId: string, providerId: string) =>
  h.client.call('generate.submit', {
    params: { projectId },
    body: {
      items: [{ target: { kind: 'shot_video' as const, shotId }, providerId, resolution: '720p' }],
      confirmUnverified: true,
    },
  })

const real = (name: string, fn: () => Promise<void>) =>
  it(
    name,
    async (ctx) => {
      if (!media) return ctx.skip()
      await fn()
    },
    180_000,
  )

describe('restart recovery', () => {
  real(
    'a video job that already has an upstream id resumes polling after a restart and is submitted exactly once',
    async () => {
      const { providers, options, h1, ids, projectId, shot } = await setup()
      providers.faults.holdPolls = true
      await submitVideo(h1, projectId, shot.id, ids.seedance!)
      const running = await untilJob(
        h1,
        projectId,
        (j) => j.status === 'running' && !!j.providerJobId,
        'upstream id checkpointed',
      )
      expect(providers.posts('/contents/generations/tasks')).toHaveLength(1)

      await h1.stop({ graceful: false }) // 进程被杀：任务停在 running，没有结局
      providers.faults.holdPolls = false

      const h2 = await startServer({ ...options, dataDir: h1.dataDir })
      const done = await waitJobsIdle(h2, projectId)
      const video = done.find((j) => j.operation === 'shot_video')!
      expect(video.id).toBe(running.id)
      expect(video.status).toBe('succeeded')
      expect(video.providerJobId).toBe(running.providerJobId)
      // 关键：整个过程里，视频只向上游提交过一次
      expect(providers.posts('/contents/generations/tasks')).toHaveLength(1)
      const after = await h2.client.call('shots.get', { params: { shotId: shot.id } })
      expect(after.shot.video.versions.length).toBeGreaterThan(0)
    },
  )

  real(
    'a paid job without an upstream id is NOT resubmitted after a restart; the user decides',
    async () => {
      const { providers, options, h1, ids, projectId, shot } = await setup()
      providers.faults.holdSubmits = true
      await submitVideo(h1, projectId, shot.id, ids.seedance!)
      const deadline = Date.now() + 30_000
      while (providers.posts('/contents/generations/tasks').length < 1) {
        if (Date.now() > deadline) throw new Error('submit never reached the provider')
        await new Promise((r) => setTimeout(r, 10))
      }
      await h1.stop({ graceful: false }) // 请求已送达上游，但没拿到任务号就被杀了
      providers.faults.holdSubmits = false

      const h2 = await startServer({ ...options, dataDir: h1.dataDir })
      const jobs = await waitJobsIdle(h2, projectId, { allowFailed: true })
      const video = jobs.find((j) => j.operation === 'shot_video')!
      expect(video.status).toBe('failed')
      expect(video.error?.category).toBe('submission_unknown')
      expect(video.needsAttention).toBe(true)
      expect(providers.posts('/contents/generations/tasks')).toHaveLength(1) // 没有重投

      // 用户要重来：必须明确确认“可能再次计费”
      await expect(
        h2.client.call('jobs.retry', { params: { jobId: video.id }, body: {} }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'CONFIRM_RECHARGE_REQUIRED',
      })
      expect(providers.posts('/contents/generations/tasks')).toHaveLength(1)
      await h2.client.call('jobs.retry', {
        params: { jobId: video.id },
        body: { confirmRecharge: true },
      })
      await waitJobsIdle(h2, projectId)
      expect(providers.posts('/contents/generations/tasks')).toHaveLength(2)
    },
  )

  it('text steps are paid:false and are simply re-queued after a restart', async () => {
    const h1 = await startServer({
      llm: fakeLlm().client,
      workerIntervalMs: 20,
      extraHandlers: {
        test_text_step: async (ctx) => {
          await ctx.setStage('processing')
          await new Promise((_r, reject) =>
            ctx.signal.addEventListener('abort', () =>
              reject(new ProviderError('cancelled', '已取消', { code: 'CANCELLED' })),
            ),
          )
        },
      },
    })
    const { job } = await h1.server.ctx.queue.enqueue({
      type: 'text',
      operation: 'test_text_step',
      projectId: 'p-none',
      paid: false,
    })
    const deadline = Date.now() + 10_000
    while ((await h1.server.ctx.store.jobs.get(job.id))?.status !== 'running') {
      if (Date.now() > deadline) throw new Error('never started')
      await new Promise((r) => setTimeout(r, 10))
    }
    await h1.stop({ graceful: false })
    const ran: string[] = []
    const h2 = await startServer({
      llm: fakeLlm().client,
      dataDir: h1.dataDir,
      workerIntervalMs: 20,
      extraHandlers: {
        test_text_step: async (ctx) => {
          ran.push(ctx.job.id)
        },
      },
    })
    const end = Date.now() + 10_000
    while ((await h2.server.ctx.store.jobs.get(job.id))?.status !== 'succeeded') {
      if (Date.now() > end) throw new Error('not re-run')
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(ran).toEqual([job.id])
  })
})
