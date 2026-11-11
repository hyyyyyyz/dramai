import { describe, expect, it } from 'vitest'
import {
  InFlightConflictError,
  JobFailure,
  JobQueue,
  JobWorker,
  queuePositions,
  runProviderJob,
  recoverRunningJobs,
  checkProviderSnapshot,
  canTransition,
  needsAttention,
} from '../src/jobs/index.ts'
import type { Job, JobContext, JobHandler, JobType } from '../src/jobs/index.ts'
import type { NewJob } from '../src/jobs/queue.ts'
import { ProviderError } from '../src/providers/errors.ts'
import type { FetchLike } from '../src/providers/executor.ts'
import { aliyunVideo } from '../src/providers/protocols/index.ts'
import type { ProviderConfig } from '../src/providers/types.ts'
import { checkJobRepoContract, createMemoryPorts } from '../src/testing/index.ts'

const SNAPSHOT = {
  providerConfigId: 'cfg-1',
  protocol: 'aliyun-video',
  baseUrl: 'https://api.302ai.cn',
  model: 'wan2.2-i2v-flash',
}
const CONFIG: ProviderConfig = {
  id: 'cfg-1',
  label: 'Wan',
  kind: 'video',
  protocol: 'aliyun-video',
  baseUrl: 'https://api.302ai.cn',
  model: 'wan2.2-i2v-flash',
  enabled: true,
}

function setup(
  options: {
    configs?: ProviderConfig[]
    handlers?: Record<string, JobHandler>
    lanes?: Partial<Record<JobType, number>>
  } = {},
) {
  const ports = createMemoryPorts()
  const queue = new JobQueue({
    jobs: ports.store.jobs,
    clock: ports.clock,
    ids: ports.ids,
    events: ports.events,
  })
  const configs = options.configs ?? [CONFIG]
  const worker = new JobWorker({
    jobs: ports.store.jobs,
    clock: ports.clock,
    events: ports.events,
    handlers: options.handlers ?? {},
    lanes: options.lanes,
    recovery: { listProviderConfigs: async () => configs },
    sleep: () => new Promise((r) => setTimeout(r, 1)),
    intervalMs: 1,
  })
  const recoveryDeps = {
    jobs: ports.store.jobs,
    clock: ports.clock,
    events: ports.events,
    listProviderConfigs: async () => configs,
  }
  return { ports, queue, worker, recoveryDeps, jobs: ports.store.jobs }
}

const job = (over: Partial<NewJob> = {}): NewJob => ({
  type: 'image',
  operation: 'op',
  projectId: 'p1',
  ...over,
})

/** 受控的“长任务”：start 后一直挂着，直到 release()。 */
function gate() {
  let release!: () => void
  const promise = new Promise<void>((r) => (release = r))
  return { promise, release }
}

async function waitFor(cond: () => Promise<boolean> | boolean, timeoutMs = 2000) {
  const start = Date.now()
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 2))
  }
}

describe('state machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('queued', 'running')).toBe(true)
    expect(canTransition('queued', 'cancelled')).toBe(true)
    expect(canTransition('queued', 'succeeded')).toBe(false)
    expect(canTransition('running', 'cancelled')).toBe(false) // 运行中不可取消
    expect(canTransition('running', 'succeeded')).toBe(true)
    expect(canTransition('running', 'failed')).toBe(true)
    expect(canTransition('failed', 'queued')).toBe(true) // 重试/恢复
    expect(canTransition('succeeded', 'queued')).toBe(false)
    expect(canTransition('cancelled', 'queued')).toBe(false)
  })
})

describe('lanes', () => {
  it('runs each lane independently up to its own limit', async () => {
    const g = gate()
    const started: string[] = []
    const handler: JobHandler = async (ctx) => {
      started.push(ctx.job.id)
      await g.promise
    }
    const { queue, worker } = setup({ handlers: { op: handler }, lanes: { image: 2, video: 3 } })
    const ids: Record<string, string[]> = { image: [], video: [], audio: [] }
    for (const type of ['image', 'video', 'audio'] as const) {
      for (let i = 0; i < 5; i++) ids[type].push((await queue.enqueue(job({ type }))).job.id)
    }
    await worker.tick()
    await waitFor(() => started.length === 2 + 3 + 2)
    const byLane = (type: string) => started.filter((id) => ids[type].includes(id)).length
    expect(byLane('image')).toBe(2)
    expect(byLane('video')).toBe(3)
    expect(byLane('audio')).toBe(2) // 默认 2
    g.release()
    await worker.idle()
  })

  it('render lane is fixed at one at a time, whatever the config says', async () => {
    const g = gate()
    let running = 0
    let maxRunning = 0
    const handler: JobHandler = async () => {
      running++
      maxRunning = Math.max(maxRunning, running)
      await g.promise
      running--
    }
    const { queue, worker } = setup({ handlers: { op: handler }, lanes: { render: 8 } })
    expect(worker.laneLimit('render')).toBe(1)
    for (let i = 0; i < 3; i++) await queue.enqueue(job({ type: 'render', paid: false }))
    await worker.tick()
    await waitFor(() => running === 1)
    await worker.tick()
    expect(maxRunning).toBe(1)
    g.release()
    await worker.idle()
    await worker.tick()
    await worker.idle()
    await worker.tick()
    await worker.idle()
    expect(maxRunning).toBe(1)
  })

  it('a finished job frees its slot for the next one, oldest first', async () => {
    const order: string[] = []
    const gates = [gate(), gate(), gate()]
    let n = 0
    const handler: JobHandler = async (ctx) => {
      order.push(ctx.job.id)
      await gates[n++].promise
    }
    const { queue, worker } = setup({ handlers: { op: handler }, lanes: { image: 1 } })
    const a = (await queue.enqueue(job())).job
    const b = (await queue.enqueue(job())).job
    const c = (await queue.enqueue(job())).job
    await worker.tick()
    await waitFor(() => order.length === 1)
    gates[0].release()
    await worker.idle()
    await worker.tick()
    await waitFor(() => order.length === 2)
    gates[1].release()
    await worker.idle()
    await worker.tick()
    await waitFor(() => order.length === 3)
    gates[2].release()
    await worker.idle()
    expect(order).toEqual([a.id, b.id, c.id])
  })

  it('reports queue positions per lane', async () => {
    const { queue } = setup()
    const a = (await queue.enqueue(job({ type: 'image' }))).job
    const v = (await queue.enqueue(job({ type: 'video' }))).job
    const b = (await queue.enqueue(job({ type: 'image' }))).job
    const listed = await queue.list({ projectId: 'p1' })
    expect(Object.fromEntries(listed.map((j) => [j.id, j.queuePosition]))).toEqual({
      [a.id]: 1,
      [v.id]: 1,
      [b.id]: 2,
    })
    expect(queuePositions(listed).get(b.id)).toBe(2)
  })

  it('de-duplicates in-flight jobs with the same dedupe key', async () => {
    const { queue } = setup()
    const first = await queue.enqueue(job({ dedupeKey: 'shot_video:s1#abc' }))
    const second = await queue.enqueue(job({ dedupeKey: 'shot_video:s1#abc' }))
    expect(second.deduped).toBe(true)
    expect(second.job.id).toBe(first.job.id)
    const other = await queue.enqueue(job({ dedupeKey: 'shot_video:s1#def' }))
    expect(other.deduped).toBe(false)
  })
})

describe('cancel semantics: only queued jobs; a running job keeps its result', () => {
  it('cancels a queued job and never runs it', async () => {
    let calls = 0
    const { queue, worker } = setup({ handlers: { op: async () => void calls++ } })
    const { job: j } = await queue.enqueue(job())
    const res = await queue.cancel(j.id)
    expect(res).toMatchObject({ ok: true, job: { status: 'cancelled' } })
    await worker.tick()
    await worker.idle()
    expect(calls).toBe(0)
    expect((await queue.get(j.id))?.status).toBe('cancelled')
  })

  it('refuses to cancel a running job, which then finishes and keeps its result', async () => {
    const g = gate()
    const { queue, worker } = setup({
      handlers: {
        op: async () => {
          await g.promise
          return { result: { versionId: 'v9' } }
        },
      },
    })
    const { job: j } = await queue.enqueue(job())
    await worker.tick()
    await waitFor(async () => (await queue.get(j.id))?.status === 'running')
    expect(await queue.cancel(j.id)).toEqual({ ok: false, reason: 'RUNNING_NOT_CANCELLABLE' })
    g.release()
    await worker.idle()
    const done = await queue.get(j.id)
    expect(done?.status).toBe('succeeded')
    expect(done?.result).toEqual({ versionId: 'v9' })
  })

  it('reports finished and unknown jobs', async () => {
    const { queue, worker } = setup({ handlers: { op: async () => {} } })
    const { job: j } = await queue.enqueue(job())
    await worker.tick()
    await worker.idle()
    expect(await queue.cancel(j.id)).toEqual({ ok: false, reason: 'ALREADY_FINISHED' })
    expect(await queue.cancel('nope')).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })

  it('loses the race gracefully when the worker starts the job between read and cancel', async () => {
    const { queue, jobs, ports } = setup()
    const { job: j } = await queue.enqueue(job())
    // 模拟：cancel 读到的是 queued，但在比较并更新之前 worker 已把它置为 running
    const realGet = jobs.get.bind(jobs)
    jobs.get = async (id) => {
      const cur = await realGet(id)
      await jobs.transition(id, ['queued'], { status: 'running', updatedAt: ports.clock.now() })
      return cur
    }
    expect(await queue.cancel(j.id)).toEqual({ ok: false, reason: 'RUNNING_NOT_CANCELLABLE' })
    expect((await realGet(j.id))?.status).toBe('running')
  })
})

describe('ignoring the result of a running paid job', () => {
  const running = async () => {
    const g = gate()
    const env = setup({ handlers: { op: async () => void (await g.promise) } })
    const { job: j } = await env.queue.enqueue(job())
    await env.worker.tick()
    await waitFor(async () => (await env.queue.get(j.id))?.status === 'running')
    return { ...env, j, g }
  }

  it('flags a running paid media job; the job still runs to the end', async () => {
    const { queue, worker, j, g } = await running()
    const res = await queue.ignoreResult(j.id)
    expect(res).toMatchObject({
      ok: true,
      changed: true,
      job: { ignoreResult: true, status: 'running' },
    })
    expect((await queue.get(j.id))?.ignoredAt).toBeTypeOf('number')
    g.release()
    await worker.idle()
    expect((await queue.get(j.id))?.status).toBe('succeeded')
  })

  it('is idempotent and can be undone while the job is running', async () => {
    const { queue, j } = await running()
    await queue.ignoreResult(j.id)
    expect(await queue.ignoreResult(j.id)).toMatchObject({ ok: true, changed: false })
    expect(await queue.ignoreResult(j.id, false)).toMatchObject({ ok: true, changed: true })
    expect((await queue.get(j.id))?.ignoreResult).toBeUndefined()
    expect(await queue.ignoreResult(j.id, false)).toMatchObject({ ok: true, changed: false })
  })

  it('refuses queued jobs (cancel them), finished jobs (switch the version instead), unknown ids and non-media jobs', async () => {
    const { queue, worker } = setup({ handlers: { op: async () => {} } })
    const { job: queued } = await queue.enqueue(job())
    expect(await queue.ignoreResult(queued.id)).toEqual({ ok: false, reason: 'NOT_RUNNING' })
    await worker.tick()
    await worker.idle()
    expect(await queue.ignoreResult(queued.id)).toEqual({ ok: false, reason: 'ALREADY_FINISHED' })
    expect(await queue.ignoreResult('nope')).toEqual({ ok: false, reason: 'NOT_FOUND' })
    const { job: text } = await queue.enqueue(job({ type: 'text', paid: false, operation: 'x' }))
    expect(await queue.ignoreResult(text.id)).toEqual({ ok: false, reason: 'NOT_APPLICABLE' })
    const { job: render } = await queue.enqueue(job({ type: 'render', operation: 'compose' }))
    expect(await queue.ignoreResult(render.id)).toEqual({ ok: false, reason: 'NOT_APPLICABLE' })
  })

  it('retry and resume of a failed job start clean (the flag does not leak into the next attempt)', async () => {
    const { queue, jobs, ports } = setup()
    const { job: j } = await queue.enqueue(job())
    await jobs.transition(j.id, ['queued'], { status: 'running', updatedAt: ports.clock.now() })
    await queue.ignoreResult(j.id)
    await jobs.transition(j.id, ['running'], {
      status: 'failed',
      providerJobId: 'up-1',
      error: { category: 'delivery_failed', code: 'POLL_FAILED', message: 'x', recoverable: true },
      updatedAt: ports.clock.now(),
    })
    expect(await queue.resume(j.id)).toMatchObject({ ok: true })
    expect((await queue.get(j.id))?.ignoreResult).toBeUndefined()
  })
})

describe('failure mapping in the worker', () => {
  const run = async (handler: JobHandler, over: Partial<NewJob> = {}) => {
    const env = setup({ handlers: { op: handler } })
    const { job: j } = await env.queue.enqueue(job(over))
    await env.worker.tick()
    await env.worker.idle()
    return { ...env, job: (await env.queue.get(j.id))! }
  }

  it('upstream-confirmed failure → generation_failed', async () => {
    const { job: j } = await run(async () => {
      throw new ProviderError('upstream_failed', 'policy', { code: 'UPSTREAM_FAILED' })
    })
    expect(j).toMatchObject({
      status: 'failed',
      error: { category: 'generation_failed', recoverable: false, code: 'UPSTREAM_FAILED' },
    })
  })

  it('unknown submission outcome → submission_unknown', async () => {
    const { job: j } = await run(async () => {
      throw new ProviderError('network', 'down', { submission: 'unknown' })
    })
    expect(j.error?.category).toBe('submission_unknown')
  })

  it('JobFailure carries its own classification', async () => {
    const { job: j } = await run(async () => {
      throw new JobFailure({
        category: 'invalid_input',
        code: 'FILE_GONE',
        message: 'x',
        recoverable: false,
      })
    })
    expect(j.error).toMatchObject({ category: 'invalid_input', code: 'FILE_GONE' })
  })

  it('a plain exception before any upstream id → internal', async () => {
    const { job: j } = await run(async () => {
      throw new Error('boom')
    })
    expect(j.error).toMatchObject({ category: 'internal', message: 'boom' })
  })

  it('a plain exception AFTER the upstream id was checkpointed → delivery_failed (safe to resume)', async () => {
    const { job: j } = await run(async (ctx) => {
      await ctx.checkpoint({ providerJobId: 'up-1' })
      throw new Error('disk full')
    })
    expect(j.error).toMatchObject({ category: 'delivery_failed', recoverable: true })
    expect(j.providerJobId).toBe('up-1')
  })

  it('an operation without a handler fails cleanly instead of hanging', async () => {
    const env = setup()
    const { job: j } = await env.queue.enqueue(job({ operation: 'unregistered' }))
    await env.worker.tick()
    await env.worker.idle()
    expect((await env.queue.get(j.id))?.error?.code).toBe('NO_HANDLER')
  })

  it('stage and progress updates are persisted and emitted', async () => {
    const env = setup({
      handlers: {
        op: async (ctx) => {
          await ctx.setStage('polling', 0.4)
          await ctx.setStage('downloading')
        },
      },
    })
    const { job: j } = await env.queue.enqueue(job())
    await env.worker.tick()
    await env.worker.idle()
    const done = await env.queue.get(j.id)
    expect(done).toMatchObject({ status: 'succeeded', stage: 'completed', progress: 1 })
    expect(env.ports.events.ofType('job.progress').map((e) => e.progress)).toContain(0.4)
    expect(env.ports.events.ofType('job.updated').length).toBeGreaterThan(3)
  })
})

describe('retry / resume', () => {
  async function failedJob(over: Partial<Job> = {}, newJob: Partial<NewJob> = {}) {
    const env = setup()
    const { job: j } = await env.queue.enqueue(
      job({ type: 'video', providerSnapshot: SNAPSHOT, ...newJob }),
    )
    await env.jobs.patch(j.id, { status: 'failed', finishedAt: 5, ...over })
    return { ...env, id: j.id }
  }
  const err = (category: NonNullable<Job['error']>['category'], recoverable = false) => ({
    category,
    code: 'X',
    message: 'm',
    recoverable,
  })

  it('retries an upstream-confirmed failure as a new attempt without confirmation', async () => {
    const { queue, id } = await failedJob({
      error: err('generation_failed'),
      providerJobId: 'up-1',
    })
    const res = await queue.retry(id)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.job).toMatchObject({
        status: 'queued',
        attempt: 2,
        providerJobId: undefined,
        previousProviderJobIds: ['up-1'],
      })
      expect(res.job.error).toBeUndefined()
    }
  })

  it('requires a recharge confirmation when the job already has an upstream id (resume first)', async () => {
    const { queue, id } = await failedJob({
      error: err('delivery_failed', true),
      providerJobId: 'up-2',
    })
    const refused = await queue.retry(id)
    expect(refused).toMatchObject({ ok: false, reason: 'CONFIRM_RECHARGE_REQUIRED' })
    expect((await queue.get(id))?.status).toBe('failed')
    const confirmed = await queue.retry(id, { confirmRecharge: true })
    expect(confirmed.ok).toBe(true)
  })

  it('requires confirmation to retry a submission_unknown job', async () => {
    const { queue, id } = await failedJob({ error: err('submission_unknown') })
    expect(await queue.retry(id)).toMatchObject({ ok: false, reason: 'CONFIRM_RECHARGE_REQUIRED' })
    expect((await queue.retry(id, { confirmRecharge: true })).ok).toBe(true)
  })

  it('does not need confirmation for unpaid jobs', async () => {
    const { queue, id } = await failedJob(
      { error: err('internal') },
      { type: 'render', paid: false },
    )
    expect((await queue.retry(id)).ok).toBe(true)
  })

  it('refuses to retry or resume jobs that are not failed', async () => {
    const env = setup()
    const { job: j } = await env.queue.enqueue(job())
    expect(await env.queue.retry(j.id)).toMatchObject({ ok: false, reason: 'NOT_FAILED' })
    expect(await env.queue.resume(j.id)).toMatchObject({ ok: false, reason: 'NOT_FAILED' })
    expect(await env.queue.retry('zzz')).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
  })

  it('resumes the original upstream task: poll when only the id is known, download when a result URL is', async () => {
    const a = await failedJob({ error: err('delivery_failed', true), providerJobId: 'up-3' })
    const ra = await a.queue.resume(a.id)
    expect(ra.ok && ra.job).toMatchObject({
      status: 'queued',
      resumeFrom: 'poll',
      providerJobId: 'up-3',
      attempt: 1,
    })
    const b = await failedJob({
      error: err('delivery_failed', true),
      providerJobId: 'up-4',
      resultUrl: 'https://cdn/x.mp4',
    })
    const rb = await b.queue.resume(b.id)
    expect(rb.ok && rb.job.resumeFrom).toBe('download')
  })

  it('cannot resume without anything to resume, or after an upstream-confirmed failure', async () => {
    const a = await failedJob({ error: err('submission_unknown') })
    expect(await a.queue.resume(a.id)).toMatchObject({ ok: false, reason: 'NOTHING_TO_RESUME' })
    const b = await failedJob({ error: err('generation_failed'), providerJobId: 'up-5' })
    expect(await b.queue.resume(b.id)).toMatchObject({ ok: false, reason: 'NOTHING_TO_RESUME' })
  })
})

describe('restart recovery', () => {
  /** 构造一个“服务被杀时正在运行”的任务。 */
  async function runningJob(
    env: ReturnType<typeof setup>,
    over: Partial<Job> = {},
    newJob: Partial<NewJob> = {},
  ) {
    const { job: j } = await env.queue.enqueue(
      job({ type: 'video', operation: 'shot_video', providerSnapshot: SNAPSHOT, ...newJob }),
    )
    await env.jobs.patch(j.id, { status: 'running', stage: 'polling', startedAt: 1, ...over })
    return j.id
  }

  it('resumes polling a job that has an upstream id — with the handler told to resume, not to resubmit', async () => {
    const seen: Array<{ resume?: string; providerJobId?: string }> = []
    const env = setup({
      handlers: {
        shot_video: async (ctx) => {
          seen.push({ resume: ctx.resume, providerJobId: ctx.job.providerJobId })
        },
      },
    })
    const id = await runningJob(env, { providerJobId: 'up-1' })
    const report = await recoverRunningJobs(env.recoveryDeps)
    expect(report.resumed).toEqual([id])
    expect(await env.queue.get(id)).toMatchObject({ status: 'queued', resumeFrom: 'poll' })
    await env.worker.tick()
    await env.worker.idle()
    expect(seen).toEqual([{ resume: 'poll', providerJobId: 'up-1' }])
    expect((await env.queue.get(id))?.status).toBe('succeeded')
  })

  it('a job with a known result URL only re-downloads', async () => {
    const env = setup()
    const id = await runningJob(env, {
      providerJobId: 'up-1',
      resultUrl: 'https://cdn/x.mp4',
      stage: 'downloading',
    })
    await recoverRunningJobs(env.recoveryDeps)
    expect(await env.queue.get(id)).toMatchObject({ status: 'queued', resumeFrom: 'download' })
  })

  it('marks a PAID job without an upstream id as submission_unknown and NEVER resubmits it', async () => {
    let submitted = 0
    const env = setup({ handlers: { shot_video: async () => void submitted++ } })
    const id = await runningJob(env, { providerJobId: undefined, stage: 'submitting' })
    const report = await recoverRunningJobs(env.recoveryDeps)
    expect(report.unknown).toEqual([id])
    const j = (await env.queue.get(id))!
    expect(j).toMatchObject({
      status: 'failed',
      error: { category: 'submission_unknown', recoverable: false },
    })

    // 重启后反复跑 worker（包括出错重扫路径）也不会再碰它
    for (let i = 0; i < 5; i++) {
      await env.worker.tick()
      await env.worker.idle()
      await env.worker.reconcileOrphans()
    }
    expect(submitted).toBe(0)
    expect((await env.queue.get(id))?.status).toBe('failed')
    // 用户若坚持，必须显式确认可能再次计费
    expect(await env.queue.retry(id)).toMatchObject({
      ok: false,
      reason: 'CONFIRM_RECHARGE_REQUIRED',
    })
  })

  it('the same holds for paid image and audio jobs', async () => {
    const env = setup()
    const a = await runningJob(env, {}, { type: 'image', operation: 'shot_image' })
    const b = await runningJob(env, {}, { type: 'audio', operation: 'shot_audio' })
    const r = await recoverRunningJobs(env.recoveryDeps)
    expect(r.unknown.sort()).toEqual([a, b].sort())
  })

  it('requeues an unpaid local job (render) automatically', async () => {
    const env = setup()
    const id = await runningJob(
      env,
      {},
      { type: 'render', operation: 'compose', paid: false, providerSnapshot: undefined },
    )
    const r = await recoverRunningJobs(env.recoveryDeps)
    expect(r.requeued).toEqual([id])
    expect((await env.queue.get(id))?.status).toBe('queued')
  })

  it('fails with recovery_failed if the original provider config is gone, or its address/protocol changed — never queries another provider', async () => {
    const cases: Array<[string, ProviderConfig[]]> = [
      ['gone', []],
      ['other id only', [{ ...CONFIG, id: 'cfg-other' }]],
      ['baseUrl changed', [{ ...CONFIG, baseUrl: 'https://api.302.ai' }]],
      ['protocol changed', [{ ...CONFIG, protocol: 'volcengine-video' }]],
    ]
    for (const [name, configs] of cases) {
      const env = setup({ configs })
      const id = await runningJob(env, { providerJobId: 'up-1' })
      const r = await recoverRunningJobs(env.recoveryDeps)
      expect(r.failed, name).toEqual([id])
      expect((await env.queue.get(id))?.error, name).toMatchObject({ category: 'recovery_failed' })
    }
  })

  it('tolerates a trailing slash / case difference in the base URL', async () => {
    const env = setup({ configs: [{ ...CONFIG, baseUrl: 'HTTPS://api.302ai.cn/' }] })
    const id = await runningJob(env, { providerJobId: 'up-1' })
    expect((await recoverRunningJobs(env.recoveryDeps)).resumed).toEqual([id])
  })

  it('legacy jobs without a config id resume only when exactly one enabled config matches', () => {
    const legacy = {
      providerSnapshot: { protocol: 'aliyun-video', baseUrl: 'https://api.302ai.cn', model: 'm' },
    } as Job
    expect(checkProviderSnapshot(legacy, [CONFIG]).ok).toBe(true)
    expect(checkProviderSnapshot(legacy, [CONFIG, { ...CONFIG, id: 'cfg-2' }]).ok).toBe(false)
    expect(checkProviderSnapshot(legacy, [{ ...CONFIG, enabled: false }]).ok).toBe(false)
    expect(checkProviderSnapshot(legacy, []).ok).toBe(false)
    expect(checkProviderSnapshot({} as Job, [CONFIG]).ok).toBe(false) // 连快照都没有
  })

  it('leaves queued, succeeded, failed and cancelled jobs alone', async () => {
    const env = setup()
    const q = (await env.queue.enqueue(job())).job.id
    const s = (await env.queue.enqueue(job())).job.id
    const f = (await env.queue.enqueue(job())).job.id
    await env.jobs.patch(s, { status: 'succeeded' })
    await env.jobs.patch(f, { status: 'failed' })
    const r = await recoverRunningJobs(env.recoveryDeps)
    expect(r).toEqual({ resumed: [], unknown: [], requeued: [], failed: [] })
    expect((await env.queue.get(q))?.status).toBe('queued')
  })

  it('skips jobs the live worker is actually running (reconcile only touches orphans)', async () => {
    const env = setup()
    const id = await runningJob(env, {})
    const r = await recoverRunningJobs(env.recoveryDeps, { skip: new Set([id]) })
    expect(r.unknown).toEqual([])
    expect((await env.queue.get(id))?.status).toBe('running')
  })
})

describe('worker loop survives errors', () => {
  it('keeps going after a tick throws, reports it, and still runs later jobs', async () => {
    const done: string[] = []
    const env = setup({ handlers: { op: async (ctx) => void done.push(ctx.job.id) } })
    const realList = env.jobs.list.bind(env.jobs)
    let failures = 2
    env.jobs.list = async (f) => {
      if (failures-- > 0) throw new Error('database is locked')
      return realList(f)
    }
    const { job: j } = await env.queue.enqueue(job())
    env.worker.start()
    await waitFor(() => done.length === 1)
    await env.worker.stop()
    expect((await env.queue.get(j.id))?.status).toBe('succeeded')
    const errors = env.ports.events.ofType('job.worker_error')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0].message).toContain('database is locked')
  })

  it('rescans orphaned running jobs after an errored round (paid, no upstream id → submission_unknown)', async () => {
    const env = setup()
    const { job: orphan } = await env.queue.enqueue(
      job({ type: 'video', operation: 'shot_video', providerSnapshot: SNAPSHOT }),
    )
    await env.jobs.patch(orphan.id, { status: 'running' }) // 上一轮出错留下的
    const realList = env.jobs.list.bind(env.jobs)
    let first = true
    env.jobs.list = async (f) => {
      if (first) {
        first = false
        throw new Error('connection reset')
      }
      return realList(f)
    }
    env.worker.start()
    await waitFor(async () => (await env.queue.get(orphan.id))?.status === 'failed')
    await env.worker.stop()
    expect((await env.queue.get(orphan.id))?.error?.category).toBe('submission_unknown')
  })

  it('a handler crash does not stop other jobs', async () => {
    const env = setup({
      handlers: {
        bad: async () => {
          throw new Error('kaput')
        },
        good: async () => ({ result: { ok: true } }),
      },
    })
    const bad = (await env.queue.enqueue(job({ operation: 'bad' }))).job
    const good = (await env.queue.enqueue(job({ operation: 'good' }))).job
    await env.worker.tick()
    await env.worker.idle()
    expect((await env.queue.get(bad.id))?.status).toBe('failed')
    expect((await env.queue.get(good.id))?.status).toBe('succeeded')
  })

  it('when even recording the failure fails, the job stays running and is later reconciled', async () => {
    const env = setup({
      handlers: {
        op: async () => {
          throw new Error('x')
        },
      },
    })
    const { job: j } = await env.queue.enqueue(job({ type: 'video', providerSnapshot: SNAPSHOT }))
    const realTransition = env.jobs.transition.bind(env.jobs)
    let broken = true
    env.jobs.transition = async (id, from, patch) => {
      if (broken && patch.status === 'failed') throw new Error('disk I/O error')
      return realTransition(id, from, patch)
    }
    await env.worker.tick()
    await env.worker.idle()
    expect((await env.queue.get(j.id))?.status).toBe('running')
    expect(env.ports.events.ofType('job.worker_error')).toHaveLength(1)
    broken = false
    await env.worker.reconcileOrphans()
    expect((await env.queue.get(j.id))?.status).toBe('failed')
  })

  it('stop() waits for running jobs', async () => {
    const g = gate()
    let finished = false
    const env = setup({
      handlers: {
        op: async () => {
          await g.promise
          finished = true
        },
      },
    })
    await env.queue.enqueue(job())
    env.worker.start()
    await waitFor(() => env.worker.runningCount === 1)
    const stopping = env.worker.stop()
    g.release()
    await stopping
    expect(finished).toBe(true)
  })
})

describe('end to end with the provider executor: checkpoint, fail, resume — one submission only', () => {
  const png = { bytes: new Uint8Array([1]), mime: 'image/png' }
  const auth = { baseUrl: 'https://api.302ai.cn', model: 'wan2.2-i2v-flash', apiKey: 'k' }

  it('submits once; poll failures leave a resumable job; resume polls the same task id', async () => {
    const calls: Array<{ method?: string; url: string }> = []
    let phase: 'flaky' | 'good' = 'flaky'
    const fetch: FetchLike = async (url, init) => {
      calls.push({ method: init?.method, url })
      if (init?.method === 'POST')
        return new Response(
          JSON.stringify({ output: { task_id: 'up-77', task_status: 'PENDING' } }),
        )
      if (url.endsWith('.mp4'))
        return new Response(new Uint8Array([5, 5]), { headers: { 'content-type': 'video/mp4' } })
      if (phase === 'flaky') return new Response('bad gateway', { status: 502 })
      return new Response(
        JSON.stringify({ output: { task_status: 'SUCCEEDED', video_url: 'https://cdn/v.mp4' } }),
      )
    }
    const handler: JobHandler = async (ctx: JobContext) => {
      const r = await runProviderJob(
        ctx,
        aliyunVideo,
        auth,
        { prompt: 'p', image: png },
        { fetch, sleep: async () => {} },
        { poll: { intervalMs: 1, maxAttempts: 10, maxConsecutiveErrors: 3 } },
      )
      return { result: { bytes: r.outputs[0].bytes.byteLength } }
    }
    const env = setup({ handlers: { shot_video: handler } })
    const { job: j } = await env.queue.enqueue(
      job({ type: 'video', operation: 'shot_video', providerSnapshot: SNAPSHOT }),
    )

    await env.worker.tick()
    await env.worker.idle()
    const failed = (await env.queue.get(j.id))!
    expect(failed).toMatchObject({
      status: 'failed',
      providerJobId: 'up-77',
      error: { category: 'delivery_failed', recoverable: true },
    })

    phase = 'good'
    expect((await env.queue.resume(j.id)).ok).toBe(true)
    await env.worker.tick()
    await env.worker.idle()
    const done = (await env.queue.get(j.id))!
    expect(done).toMatchObject({ status: 'succeeded', result: { bytes: 2 } })
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1) // 只提交过一次
    expect(calls.filter((c) => c.url.includes('/tasks/up-77')).length).toBeGreaterThan(3)
  })

  it('the task id is persisted before polling starts (so a crash mid-poll can resume)', async () => {
    const env = setup()
    let idAtFirstPoll: string | undefined
    const fetch: FetchLike = async (_url, init) => {
      if (init?.method === 'POST')
        return new Response(JSON.stringify({ output: { task_id: 'up-5' } }))
      idAtFirstPoll = (await env.jobs.list({ status: 'running' }))[0]?.providerJobId
      throw new Error('process killed') // 模拟在轮询中崩溃
    }
    const handler: JobHandler = async (ctx) => {
      await runProviderJob(
        ctx,
        aliyunVideo,
        auth,
        { prompt: 'p', image: png },
        { fetch, sleep: async () => {} },
        { poll: { intervalMs: 1, maxAttempts: 2, maxConsecutiveErrors: 1 } },
      )
    }
    const w = new JobWorker({
      jobs: env.jobs,
      clock: env.ports.clock,
      handlers: { shot_video: handler },
    })
    await env.queue.enqueue(
      job({ type: 'video', operation: 'shot_video', providerSnapshot: SNAPSHOT }),
    )
    await w.tick()
    await w.idle()
    expect(idAtFirstPoll).toBe('up-5')
  })
})

describe('acknowledging failed jobs ("已知悉")', () => {
  async function failed(category: 'submission_unknown' | 'generation_failed' | 'delivery_failed') {
    const env = setup()
    const { job: j } = await env.queue.enqueue(job({ type: 'video', providerSnapshot: SNAPSHOT }))
    await env.jobs.patch(j.id, {
      status: 'failed',
      providerJobId: category === 'delivery_failed' ? 'up-1' : undefined,
      error: { category, code: 'X', message: 'm', recoverable: category === 'delivery_failed' },
    })
    return { ...env, id: j.id }
  }

  it('marks a failed job (including "submission outcome unknown") as acknowledged and stops it needing attention', async () => {
    for (const category of [
      'submission_unknown',
      'generation_failed',
      'delivery_failed',
    ] as const) {
      const env = await failed(category)
      expect(needsAttention((await env.queue.get(env.id))!)).toBe(true)
      const res = await env.queue.acknowledge(env.id)
      expect(res).toMatchObject({ ok: true, alreadyAcknowledged: false })
      const after = (await env.queue.get(env.id))!
      expect(after.acknowledgedAt).toBe(env.ports.clock.now())
      expect(after.status).toBe('failed') // 状态不变，只是不再提醒
      expect(after.error?.category).toBe(category)
      expect(needsAttention(after)).toBe(false)
    }
  })

  it('is idempotent and keeps the first acknowledgement time', async () => {
    const env = await failed('submission_unknown')
    await env.queue.acknowledge(env.id)
    const first = (await env.queue.get(env.id))!.acknowledgedAt
    env.ports.clock.advance(5000)
    expect(await env.queue.acknowledge(env.id)).toMatchObject({
      ok: true,
      alreadyAcknowledged: true,
    })
    expect((await env.queue.get(env.id))!.acknowledgedAt).toBe(first)
  })

  it('only applies to failed jobs', async () => {
    const env = setup()
    const { job: q } = await env.queue.enqueue(job())
    expect(await env.queue.acknowledge(q.id)).toEqual({ ok: false, reason: 'NOT_FAILED' })
    await env.jobs.patch(q.id, { status: 'succeeded' })
    expect(await env.queue.acknowledge(q.id)).toEqual({ ok: false, reason: 'NOT_FAILED' })
    expect(await env.queue.acknowledge('nope')).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })

  it('does not stop retry / resume from working, and a new failure alerts again', async () => {
    const env = await failed('delivery_failed')
    await env.queue.acknowledge(env.id)
    const resumed = await env.queue.resume(env.id)
    expect(resumed.ok && resumed.job.acknowledgedAt).toBeUndefined()
    await env.jobs.patch(env.id, {
      status: 'failed',
      error: { category: 'delivery_failed', code: 'X', message: 'again', recoverable: true },
    })
    expect(needsAttention((await env.queue.get(env.id))!)).toBe(true)
    await env.queue.acknowledge(env.id)
    const retried = await env.queue.retry(env.id, { confirmRecharge: true })
    expect(retried.ok && retried.job.acknowledgedAt).toBeUndefined()
  })

  it('acknowledging a submission_unknown job does not make it safe to resubmit without confirmation', async () => {
    const env = await failed('submission_unknown')
    await env.queue.acknowledge(env.id)
    expect(await env.queue.retry(env.id)).toMatchObject({
      ok: false,
      reason: 'CONFIRM_RECHARGE_REQUIRED',
    })
  })

  it('emits an update event so the task panel can drop the reminder', async () => {
    const env = await failed('submission_unknown')
    env.ports.events.events.length = 0
    await env.queue.acknowledge(env.id)
    expect(env.ports.events.ofType('job.updated')[0].job.acknowledgedAt).toBeDefined()
  })

  it('"needs attention" is exactly: failed and not acknowledged', () => {
    expect(needsAttention({ status: 'failed' })).toBe(true)
    expect(needsAttention({ status: 'failed', acknowledgedAt: 1 })).toBe(false)
    for (const status of ['queued', 'running', 'succeeded', 'cancelled'] as const) {
      expect(needsAttention({ status })).toBe(false)
    }
  })
})

describe('atomic in-flight dedupe and exclusivity', () => {
  it('concurrent enqueues of the same input create exactly one job', async () => {
    const { queue, jobs } = setup()
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        queue.enqueue(job({ type: 'video', dedupeKey: 'shot_video:s1#abc' })),
      ),
    )
    expect(results.filter((r) => !r.deduped)).toHaveLength(1)
    expect(new Set(results.map((r) => r.job.id)).size).toBe(1)
    expect(await jobs.list()).toHaveLength(1)
  })

  it('does not rely on reading the job list first: a stale (empty) read cannot cause a duplicate', async () => {
    const { queue, jobs } = setup()
    const realList = jobs.list.bind(jobs)
    let listCalls = 0
    jobs.list = async () => {
      listCalls++
      return [] // 过期的读：什么都看不到
    }
    const results = await Promise.all(
      Array.from({ length: 6 }, () => queue.enqueue(job({ dedupeKey: 'same' }))),
    )
    expect(results.filter((r) => !r.deduped)).toHaveLength(1)
    expect(listCalls).toBe(0)
    jobs.list = realList
    expect(await jobs.list()).toHaveLength(1)
  })

  it('concurrent enqueues for the same exclusive slot but different inputs: one wins, the rest get an explicit conflict', async () => {
    const { queue, jobs } = setup()
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        queue.enqueue(job({ type: 'video', dedupeKey: `in-${i}`, exclusiveKey: 'shot_video:s1' })),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(7)
    for (const r of rejected) expect(r.reason).toBeInstanceOf(InFlightConflictError)
    expect(await jobs.list()).toHaveLength(1)
  })

  it('the slot is released when the job finishes', async () => {
    const { queue, jobs } = setup()
    const { job: first } = await queue.enqueue(job({ exclusiveKey: 'x' }))
    await expect(queue.enqueue(job({ exclusiveKey: 'x' }))).rejects.toBeInstanceOf(
      InFlightConflictError,
    )
    await jobs.patch(first.id, { status: 'failed' })
    await expect(queue.enqueue(job({ exclusiveKey: 'x' }))).resolves.toBeDefined()
  })

  it('the in-memory JobRepo passes the shared contract (2C runs the same check against SQLite)', async () => {
    await checkJobRepoContract(() => createMemoryPorts().store.jobs)
  })
})

describe('recovery message for synchronous protocols', () => {
  it('says the call has no job id to look up and what to check, instead of the generic text', async () => {
    const env = setup()
    const asyncJob = (await env.queue.enqueue(job({ type: 'video', providerSnapshot: SNAPSHOT })))
      .job
    const syncJob = (
      await env.queue.enqueue(
        job({
          type: 'image',
          providerSnapshot: {
            ...SNAPSHOT,
            protocol: 'gemini-image',
            baseUrl: 'https://api.302.ai',
          },
        }),
      )
    ).job
    await env.jobs.patch(asyncJob.id, { status: 'running' })
    await env.jobs.patch(syncJob.id, { status: 'running' })
    await recoverRunningJobs(env.recoveryDeps)
    const a = (await env.queue.get(asyncJob.id))!.error!
    const s = (await env.queue.get(syncJob.id))!.error!
    expect(a).toMatchObject({ category: 'submission_unknown', code: 'SUBMISSION_UNKNOWN' })
    expect(s).toMatchObject({ category: 'submission_unknown', code: 'SYNC_CALL_INTERRUPTED' })
    expect(s.message).toContain('同步')
    expect(s.message).toContain('没有任务号')
    expect(a.message).not.toContain('同步')
  })
})
