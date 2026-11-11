import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type ServerEvent } from '@dramai/api'
import {
  EventStore,
  Invalidator,
  keysForChange,
  routeEvent,
  startEventSync,
  STREAM_LINGER_MS,
} from '@/data/events'
import { qk } from '@/data/keys'
import { failedJob, makeJob, makeSystem } from './fixtures'

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  const store = new EventStore()
  const invalidator = new Invalidator(queryClient, 10)
  const invalidated: unknown[] = []
  const spy = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async (filters) => {
    invalidated.push(filters?.queryKey ?? 'ALL')
  })
  const deps = { queryClient, store, invalidator, now: () => 1000 }
  const send = (e: ServerEvent) => routeEvent(e, deps)
  return { queryClient, store, invalidator, invalidated, spy, send }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('resync and epoch', () => {
  it('resync invalidates every query', () => {
    const t = setup()
    t.send({ type: 'resync', reason: 'buffer_overflow' })
    vi.advanceTimersByTime(20)
    expect(t.invalidated).toEqual(['ALL'])
    expect(t.store.getSnapshot().lastResync).toBe('buffer_overflow')
  })

  it('hello with a different epoch than the cached /api/system means the server restarted: refetch everything', () => {
    const t = setup()
    t.queryClient.setQueryData(qk.system, makeSystem({ epoch: 'old' }))
    t.send({ type: 'hello', epoch: 'new', serverTime: 1 })
    vi.advanceTimersByTime(20)
    expect(t.invalidated).toEqual(['ALL'])
    expect(t.store.getSnapshot().epoch).toBe('new')
  })

  it('hello with the same epoch does not refetch', () => {
    const t = setup()
    t.queryClient.setQueryData(qk.system, makeSystem({ epoch: 'same' }))
    t.send({ type: 'hello', epoch: 'same', serverTime: 1 })
    vi.advanceTimersByTime(20)
    expect(t.invalidated).toEqual([])
  })

  it('a burst of events becomes one round of invalidation, and ALL swallows the rest', () => {
    const t = setup()
    for (let i = 0; i < 30; i++)
      t.send({ type: 'data.changed', projectId: 'p1', entity: 'shot', ids: [`s${i}`] })
    vi.advanceTimersByTime(20)
    expect(t.invalidated.length).toBeLessThan(6)
    t.invalidated.length = 0
    t.send({ type: 'data.changed', projectId: 'p1', entity: 'asset' })
    t.send({ type: 'resync', reason: 'epoch_changed' })
    t.send({ type: 'data.changed', projectId: 'p1', entity: 'asset' })
    vi.advanceTimersByTime(20)
    expect(t.invalidated).toEqual(['ALL'])
  })
})

describe('cache invalidation per entity', () => {
  const keys = (e: Parameters<typeof keysForChange>[0]) =>
    keysForChange(e).map((k) => JSON.stringify(k))
  it('asset changes refresh the asset list, candidates and the per-episode progress', () => {
    const k = keys({ type: 'data.changed', entity: 'asset', projectId: 'p1' })
    expect(k).toContain(JSON.stringify(qk.assets('p1')))
    expect(k).toContain(JSON.stringify(qk.episodes('p1')))
    expect(k).toContain(JSON.stringify(['candidates']))
  })
  it('candidate changes also refresh assets (accepting creates one)', () => {
    const k = keys({ type: 'data.changed', entity: 'candidate', projectId: 'p1' })
    expect(k).toContain(JSON.stringify(qk.candidates('p1')))
    expect(k).toContain(JSON.stringify(qk.assets('p1')))
  })
  it('material changes refresh materials, the project list and the project', () => {
    const k = keys({ type: 'data.changed', entity: 'material', projectId: 'p1' })
    expect(k).toEqual(
      expect.arrayContaining([
        JSON.stringify(qk.materials('p1')),
        JSON.stringify(qk.projects),
        JSON.stringify(qk.project('p1')),
      ]),
    )
  })
  it('without a projectId the prefix is used so nothing stays stale', () => {
    const k = keys({ type: 'data.changed', entity: 'episode' })
    expect(k).toContain(JSON.stringify(['episodes']))
    expect(k).toContain(JSON.stringify(['episode']))
  })
  it('project / provider / settings / timeline map to their own queries', () => {
    expect(keys({ type: 'data.changed', entity: 'project', ids: ['p1'] })).toContain(
      JSON.stringify(qk.project('p1')),
    )
    expect(keys({ type: 'data.changed', entity: 'provider' })).toEqual(
      expect.arrayContaining([JSON.stringify(qk.providers), JSON.stringify(qk.settings)]),
    )
    expect(keys({ type: 'data.changed', entity: 'settings' })).toEqual([
      JSON.stringify(qk.settings),
    ])
    expect(keys({ type: 'data.changed', entity: 'timeline' })).toContain(
      JSON.stringify(qk.timeline),
    )
  })
  it('the invalidator really targets the matching queries (prefix match)', () => {
    const t = setup()
    t.send({ type: 'data.changed', entity: 'candidate', projectId: 'p1' })
    vi.advanceTimersByTime(20)
    expect(t.invalidated).toContainEqual(qk.candidates('p1'))
    expect(t.invalidated).not.toContainEqual(qk.candidates('p2'))
  })
  it('artifact.changed refreshes artifacts and the episode progress of that project', () => {
    const t = setup()
    t.send({ type: 'artifact.changed', projectId: 'p1', key: 'shot_video:s1' })
    vi.advanceTimersByTime(20)
    expect(t.invalidated).toEqual(expect.arrayContaining([qk.artifacts, qk.episodes('p1')]))
  })
})

describe('jobs', () => {
  const seedJobs = (
    t: ReturnType<typeof setup>,
    items = [makeJob({ id: 'a', status: 'queued', queuePosition: 1 })],
  ) => t.queryClient.setQueryData(qk.jobs, { items })

  it('job.updated rewrites the cached task and recomputes needsAttention', () => {
    const t = setup()
    seedJobs(t)
    const failed = failedJob('submission_unknown', { id: 'a' })
    t.send({ type: 'job.updated', job: failed })
    const cached = t.queryClient.getQueryData<{ items: ReturnType<typeof makeJob>[] }>(qk.jobs)!
    expect(cached.items[0]).toMatchObject({
      id: 'a',
      status: 'failed',
      needsAttention: true,
      queuePosition: undefined,
    })
    // 用户已知悉 → 不再需要处理
    t.send({ type: 'job.updated', job: { ...failed, acknowledgedAt: 5 } })
    expect(
      t.queryClient.getQueryData<{ items: ReturnType<typeof makeJob>[] }>(qk.jobs)!.items[0]!
        .needsAttention,
    ).toBe(false)
  })

  it('a job the cache has not seen is added at the front, and a refetch is scheduled', () => {
    const t = setup()
    seedJobs(t)
    t.send({ type: 'job.updated', job: makeJob({ id: 'new', status: 'running' }) })
    const ids = t.queryClient
      .getQueryData<{ items: { id: string }[] }>(qk.jobs)!
      .items.map((j) => j.id)
    expect(ids).toEqual(['new', 'a'])
    vi.advanceTimersByTime(20)
    expect(t.invalidated).toContainEqual(qk.jobs)
  })

  it('a finished job also refreshes the episode progress of its project', () => {
    const t = setup()
    seedJobs(t)
    t.send({ type: 'job.updated', job: makeJob({ id: 'a', status: 'succeeded', projectId: 'p9' }) })
    vi.advanceTimersByTime(20)
    expect(t.invalidated).toContainEqual(qk.episodes('p9'))
  })

  it('job.progress updates only that job', () => {
    const t = setup()
    seedJobs(t, [makeJob({ id: 'a', status: 'running' }), makeJob({ id: 'b', status: 'running' })])
    t.send({ type: 'job.progress', jobId: 'b', progress: 0.4 })
    const items = t.queryClient.getQueryData<{ items: { id: string; progress?: number }[] }>(
      qk.jobs,
    )!.items
    expect(items.find((j) => j.id === 'a')!.progress).toBeUndefined()
    expect(items.find((j) => j.id === 'b')!.progress).toBe(0.4)
  })

  it('before the job list is loaded, events do not invent a cache entry', () => {
    const t = setup()
    t.send({ type: 'job.updated', job: makeJob({ id: 'x' }) })
    expect(t.queryClient.getQueryData(qk.jobs)).toBeUndefined()
  })
})

describe('streamed text', () => {
  const delta = (text: string, chars: number): ServerEvent => ({
    type: 'text.delta',
    jobId: 'j1',
    operation: 'episodes_plan',
    task: 'episodes.plan',
    delta: text,
    chars,
  })

  it('accumulates per job and stays out of the query cache', () => {
    const t = setup()
    t.send(delta('{"epi', 5))
    t.send(delta('sodes"', 11))
    expect(t.store.getSnapshot().streams['j1']).toMatchObject({
      text: '{"episodes"',
      chars: 11,
      operation: 'episodes_plan',
    })
    expect(t.invalidated).toEqual([])
  })

  it('keeps only a bounded tail', () => {
    const t = setup()
    t.send(delta('x'.repeat(50_000), 50_000))
    t.send(delta('y'.repeat(50_000), 100_000))
    const s = t.store.getSnapshot().streams['j1']!
    expect(s.text.length).toBeLessThanOrEqual(60_000)
    expect(s.text.endsWith('y')).toBe(true)
    expect(s.chars).toBe(100_000)
  })

  it('is cleared a while after the job finishes, not immediately', () => {
    const t = setup()
    t.queryClient.setQueryData(qk.jobs, { items: [makeJob({ id: 'j1', status: 'running' })] })
    t.send(delta('abc', 3))
    t.send({ type: 'job.updated', job: makeJob({ id: 'j1', status: 'succeeded' }) })
    expect(t.store.getSnapshot().streams['j1']).toBeDefined()
    vi.advanceTimersByTime(STREAM_LINGER_MS + 1)
    expect(t.store.getSnapshot().streams['j1']).toBeUndefined()
  })

  it('worker errors surface in the store', () => {
    const t = setup()
    t.send({ type: 'job.worker_error', message: 'boom' })
    expect(t.store.getSnapshot().workerError).toBe('boom')
  })
})

/** 用真实的 @dramai/api 客户端 + 假的 fetch 走一遍“断线 → 带 Last-Event-ID 重连 → epoch 变了 → 整体失效”。 */
describe('reconnect with the real client', () => {
  const enc = new TextEncoder()
  const frame = (id: string, e: ServerEvent) =>
    enc.encode(`id: ${id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)

  function sseHarness() {
    const requests: { lastEventId?: string }[] = []
    const streams: ReadableStreamDefaultController<Uint8Array>[] = []
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>
      requests.push({ lastEventId: h['Last-Event-ID'] })
      return new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            streams.push(c)
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    })
    const client = createClient({ fetch: fetchImpl as unknown as typeof fetch })
    return { client, requests, streams }
  }
  const tick = async (ms = 0) => {
    await vi.advanceTimersByTimeAsync(ms)
  }

  it('resumes with the last event id, and invalidates everything when the epoch changed', async () => {
    const h = sseHarness()
    const queryClient = new QueryClient()
    const invalidated: unknown[] = []
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(
      async (f) => void invalidated.push(f?.queryKey ?? 'ALL'),
    )
    const store = new EventStore()
    const sync = startEventSync(h.client, { queryClient, store })
    await tick()
    expect(store.getSnapshot().status).toBe('open')

    h.streams[0]!.enqueue(frame('A:1', { type: 'hello', epoch: 'A', serverTime: 1 }))
    h.streams[0]!.enqueue(
      frame('A:2', { type: 'data.changed', projectId: 'p1', entity: 'material' }),
    )
    await tick(200)
    expect(store.getSnapshot().epoch).toBe('A')
    expect(invalidated).toContainEqual(qk.materials('p1'))
    invalidated.length = 0

    // 断线
    h.streams[0]!.close()
    await tick(50)
    expect(store.getSnapshot().status).toBe('closed')
    await tick(1500) // 退避后重连
    expect(h.requests).toHaveLength(2)
    expect(h.requests[1]!.lastEventId).toBe('A:2') // 带着最后一条事件 id

    // 服务重启过：epoch 变了 → 整体失效
    h.streams[1]!.enqueue(frame('B:1', { type: 'hello', epoch: 'B', serverTime: 2 }))
    await tick(200)
    expect(invalidated).toContain('ALL')
    expect(store.getSnapshot().epoch).toBe('B')
    expect(store.getSnapshot().lastResync).toBe('epoch_changed')
    sync.close()
  })

  it('a server-sent resync (buffer overflow) also invalidates everything', async () => {
    const h = sseHarness()
    const queryClient = new QueryClient()
    const invalidated: unknown[] = []
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(
      async (f) => void invalidated.push(f?.queryKey ?? 'ALL'),
    )
    const store = new EventStore()
    const sync = startEventSync(h.client, { queryClient, store })
    await tick()
    h.streams[0]!.enqueue(frame('A:1', { type: 'hello', epoch: 'A', serverTime: 1 }))
    h.streams[0]!.enqueue(frame('A:9', { type: 'resync', reason: 'buffer_overflow' }))
    await tick(200)
    expect(invalidated).toContain('ALL')
    expect(store.getSnapshot().lastResync).toBe('buffer_overflow')
    sync.close()
  })

  it('same epoch after a reconnect: replayed events are applied, nothing is thrown away', async () => {
    const h = sseHarness()
    const queryClient = new QueryClient()
    const invalidated: unknown[] = []
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(
      async (f) => void invalidated.push(f?.queryKey ?? 'ALL'),
    )
    const store = new EventStore()
    const sync = startEventSync(h.client, { queryClient, store })
    await tick()
    h.streams[0]!.enqueue(frame('A:1', { type: 'hello', epoch: 'A', serverTime: 1 }))
    await tick(50)
    h.streams[0]!.close()
    await tick(1600)
    h.streams[1]!.enqueue(frame('A:2', { type: 'hello', epoch: 'A', serverTime: 2 }))
    h.streams[1]!.enqueue(
      frame('A:3', { type: 'data.changed', projectId: 'p1', entity: 'candidate' }),
    ) // 补发的错过的事件
    await tick(200)
    expect(invalidated).not.toContain('ALL')
    expect(invalidated).toContainEqual(qk.candidates('p1'))
    sync.close()
  })
})
