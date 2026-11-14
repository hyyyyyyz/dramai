import { afterEach, describe, expect, it } from 'vitest'
import { serverEvent } from '@dramai/api'
import { EventBus } from '../src/events/event-bus.ts'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

const job = (id: string) => ({ id }) as never

describe('EventBus', () => {
  it('numbers events per epoch and replays what a client missed', () => {
    const bus = new EventBus({ epoch: 'e1' })
    bus.publish({ type: 'job.worker_error', message: 'a' })
    bus.publish({ type: 'job.worker_error', message: 'b' })
    bus.publish({ type: 'job.worker_error', message: 'c' })
    const r = bus.replaySince('e1:1')
    expect(r.kind).toBe('replay')
    if (r.kind === 'replay') expect(r.events.map((e) => e.id)).toEqual(['e1:2', 'e1:3'])
    expect(bus.replaySince('e1:3')).toEqual({ kind: 'replay', events: [] })
    expect(bus.replaySince(undefined)).toEqual({ kind: 'none' })
    expect(bus.replaySince('garbage')).toEqual({ kind: 'none' })
  })

  it('asks for a resync after a restart (epoch change) or a buffer overflow', () => {
    const bus = new EventBus({ epoch: 'e2', capacity: 3 })
    for (let i = 0; i < 10; i++) bus.publish({ type: 'job.worker_error', message: String(i) })
    expect(bus.replaySince('old-epoch:4')).toEqual({ kind: 'resync', reason: 'epoch_changed' })
    expect(bus.replaySince('e2:99')).toEqual({ kind: 'resync', reason: 'epoch_changed' })
    expect(bus.replaySince('e2:2')).toEqual({ kind: 'resync', reason: 'buffer_overflow' })
    const edge = bus.replaySince('e2:7') // 环里是 8..10，7 之后的刚好都在
    expect(edge.kind).toBe('replay')
    if (edge.kind === 'replay') expect(edge.events.map((e) => e.seq)).toEqual([8, 9, 10])
  })

  it('a core timeline.changed event reaches clients as data.changed for the timeline of that episode', () => {
    const bus = new EventBus({ epoch: 'e4' })
    const seen: unknown[] = []
    bus.subscribe((e) => seen.push(e.event))
    bus.emit({ type: 'timeline.changed', projectId: 'p1', episodeId: 'ep1' })
    expect(seen).toEqual([
      { type: 'data.changed', entity: 'timeline', projectId: 'p1', ids: ['ep1'], op: 'updated' },
    ])
  })

  it('a core job.notice reaches clients as a job.notice (a hint, never a job.worker_error) and is accepted by the contract', () => {
    const bus = new EventBus({ epoch: 'e5' })
    const seen: unknown[] = []
    bus.subscribe((e) => seen.push(e.event))
    bus.emit({
      type: 'job.notice',
      level: 'warning',
      code: 'native_audio_default_failed',
      message: '时间线默认静音没有完成（视频已保存）：TypeError',
      projectId: 'p1',
      jobId: 'j1',
      shotId: 's1',
    })
    bus.emit({
      type: 'job.notice',
      level: 'info',
      code: 'x',
      message: 'm',
      projectId: 'p1',
    })
    expect(seen).toEqual([
      {
        type: 'job.notice',
        level: 'warning',
        code: 'native_audio_default_failed',
        message: '时间线默认静音没有完成（视频已保存）：TypeError',
        projectId: 'p1',
        jobId: 'j1',
        shotId: 's1',
      },
      { type: 'job.notice', level: 'info', code: 'x', message: 'm', projectId: 'p1' },
    ])
    for (const e of seen) expect(serverEvent.safeParse(e).success).toBe(true)
    expect(seen.some((e) => (e as { type: string }).type === 'job.worker_error')).toBe(false)
  })

  it('coalesces text deltas, keeps order, and does not replay them', async () => {
    const bus = new EventBus({ epoch: 'e3', deltaFlushMs: 20 })
    const seen: string[] = []
    bus.subscribe((e) =>
      seen.push(
        e.event.type === 'text.delta' ? `delta:${e.event.delta}:${e.event.chars}` : e.event.type,
      ),
    )
    for (const [i, d] of ['你', '好', '，', '世界'].entries()) {
      bus.textDelta({ jobId: 'j1', operation: 'episodes_plan', task: 't', delta: d, chars: i + 1 })
    }
    expect(seen).toEqual([]) // 窗口内合并，还没发出
    await new Promise((r) => setTimeout(r, 60))
    expect(seen).toEqual(['delta:你好，世界:4'])
    // 非 delta 事件到来时先把挂起的 delta 刷出去，保证先后顺序
    bus.textDelta({ jobId: 'j1', operation: 'episodes_plan', task: 't', delta: 'x', chars: 5 })
    bus.emit({ type: 'job.updated', job: job('j1') })
    expect(seen.slice(-2)).toEqual(['delta:x:5', 'job.updated'])
    const r = bus.replaySince('e3:0')
    expect(r.kind).toBe('replay')
    if (r.kind === 'replay') expect(r.events.every((e) => e.event.type !== 'text.delta')).toBe(true)
    bus.dispose()
  })

  it('maps core events to server events', () => {
    const bus = new EventBus({ epoch: 'e4' })
    const types: string[] = []
    bus.subscribe((e) => types.push(e.event.type))
    bus.emit({ type: 'job.progress', jobId: 'j', progress: 0.5 })
    bus.emit({ type: 'artifact.changed', projectId: 'p', key: 'k' })
    bus.emit({ type: 'project.changed', projectId: 'p' })
    expect(types).toEqual(['job.progress', 'artifact.changed', 'data.changed'])
  })
})

interface Frame {
  id?: string
  event?: string
  data?: string
  comment?: string
}

/** 极简 SSE 读取器：按空行切帧，解析 id / event / data / 注释。 */
async function openSse(url: string, headers: Record<string, string> = {}) {
  const ac = new AbortController()
  const res = await fetch(url, {
    headers: { Accept: 'text/event-stream', ...headers },
    signal: ac.signal,
  })
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const frames: Frame[] = []
  const waiters: Array<() => void> = []
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const f: Frame = {}
          for (const line of raw.split('\n')) {
            if (line.startsWith(':')) f.comment = line.slice(1).trim()
            else if (line.startsWith('id:')) f.id = line.slice(3).trim()
            else if (line.startsWith('event:')) f.event = line.slice(6).trim()
            else if (line.startsWith('data:'))
              f.data = (f.data ? f.data + '\n' : '') + line.slice(5).trim()
          }
          frames.push(f)
          for (const w of waiters.splice(0)) w()
        }
      }
    } catch {
      /* aborted */
    }
  })()
  const waitFor = async (pred: (f: Frame) => boolean, ms = 3000): Promise<Frame> => {
    const deadline = Date.now() + ms
    for (;;) {
      const hit = frames.find(pred)
      if (hit) return hit
      if (Date.now() > deadline)
        throw new Error(`timeout waiting for frame; got ${JSON.stringify(frames)}`)
      await new Promise<void>((r) => {
        waiters.push(r)
        setTimeout(r, 50)
      })
    }
  }
  return { res, frames, waitFor, close: () => ac.abort() }
}

describe('GET /api/events', () => {
  it('sends hello with the epoch, then live events with ids, and heartbeats', async () => {
    const h = await startServer({ sseHeartbeatMs: 80 })
    const sse = await openSse(`${h.server.url}/api/events`)
    expect(sse.res.headers.get('content-type')).toContain('text/event-stream')
    expect(sse.res.headers.get('cache-control')).toContain('no-cache')
    const hello = await sse.waitFor((f) => f.event === 'hello')
    expect(JSON.parse(hello.data!)).toMatchObject({ type: 'hello', epoch: h.server.ctx.bus.epoch })

    h.server.ctx.bus.changed('project', { projectId: 'p1', op: 'created' })
    const changed = await sse.waitFor((f) => f.event === 'data.changed')
    expect(changed.id).toMatch(new RegExp(`^${h.server.ctx.bus.epoch}:\\d+$`))
    expect(JSON.parse(changed.data!)).toMatchObject({
      type: 'data.changed',
      entity: 'project',
      projectId: 'p1',
    })

    await sse.waitFor((f) => f.comment === 'ping')
    sse.close()
  })

  it('replays missed events from Last-Event-ID, in order, without duplicating live ones', async () => {
    const h = await startServer()
    const bus = h.server.ctx.bus
    bus.publish({ type: 'job.worker_error', message: 'one' })
    const afterFirst = `${bus.epoch}:${bus.lastSeq}`
    bus.publish({ type: 'job.worker_error', message: 'two' })
    bus.publish({ type: 'job.worker_error', message: 'three' })

    const sse = await openSse(`${h.server.url}/api/events`, { 'Last-Event-ID': afterFirst })
    await sse.waitFor((f) => f.event === 'hello')
    await sse.waitFor((f) => f.event === 'job.worker_error' && f.data!.includes('three'))
    bus.publish({ type: 'job.worker_error', message: 'four' })
    await sse.waitFor((f) => f.data?.includes('four') === true)
    const msgs = sse.frames
      .filter((f) => f.event === 'job.worker_error')
      .map((f) => JSON.parse(f.data!).message)
    expect(msgs).toEqual(['two', 'three', 'four'])
    expect(sse.frames.some((f) => f.event === 'resync')).toBe(false)
    sse.close()
  })

  it('sends resync when the client comes from another epoch (server restarted)', async () => {
    const h = await startServer()
    const sse = await openSse(`${h.server.url}/api/events`, { 'Last-Event-ID': 'deadbeef:42' })
    const resync = await sse.waitFor((f) => f.event === 'resync')
    expect(JSON.parse(resync.data!)).toEqual({ type: 'resync', reason: 'epoch_changed' })
    sse.close()
  })

  it('streams text deltas and job updates produced by the server', async () => {
    const h = await startServer()
    const sse = await openSse(`${h.server.url}/api/events`)
    await sse.waitFor((f) => f.event === 'hello')
    h.server.ctx.bus.textDelta({
      jobId: 'j1',
      operation: 'episodes_plan',
      task: 'episodes.plan',
      delta: '第一',
      chars: 2,
    })
    h.server.ctx.bus.textDelta({
      jobId: 'j1',
      operation: 'episodes_plan',
      task: 'episodes.plan',
      delta: '集',
      chars: 3,
    })
    const d = await sse.waitFor((f) => f.event === 'text.delta')
    expect(JSON.parse(d.data!)).toMatchObject({ jobId: 'j1', delta: '第一集', chars: 3 })
    sse.close()
  })

  it('closes open streams when the server shuts down', async () => {
    const h = await startServer()
    const sse = await openSse(`${h.server.url}/api/events`)
    await sse.waitFor((f) => f.event === 'hello')
    await h.stop()
    await new Promise((r) => setTimeout(r, 50))
    sse.close()
  })
})
