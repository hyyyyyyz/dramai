import { randomBytes } from 'node:crypto'
import { formatEventId, parseEventId } from '@dramai/api'
import type { ServerEvent } from '@dramai/api'
import type { CoreEvent, EventSink } from '@dramai/core'

export interface BufferedEvent {
  seq: number
  id: string
  event: ServerEvent
}

export type Replay =
  | { kind: 'none' }
  | { kind: 'replay'; events: BufferedEvent[] }
  | { kind: 'resync'; reason: 'epoch_changed' | 'buffer_overflow' }

export interface EventBusOptions {
  /** 环形缓冲区容量（默认 3000）。 */
  capacity?: number
  /** text.delta 合并窗口（毫秒，默认 100）。 */
  deltaFlushMs?: number
  epoch?: string
}

/**
 * 服务端事件总线：给 SSE 用。
 *
 * **补发 / 重连**：每条事件有 id `<epoch>:<seq>`，最近 `capacity` 条留在内存环里。
 * 客户端带 `Last-Event-ID` 重连：epoch 相同且缺的事件还在环里 → 按序补发；
 * epoch 不同（服务重启过）或缺的已经被挤出环 → 发 `resync`，前端整体重新取数。
 * `text.delta` 不参与补发（它是瞬时的流式输出，任务状态才是真相），但占序号。
 */
export class EventBus implements EventSink {
  readonly epoch: string
  private seq = 0
  private readonly ring: BufferedEvent[] = []
  private readonly capacity: number
  private readonly flushMs: number
  private readonly listeners = new Set<(e: BufferedEvent) => void>()
  private readonly pendingDeltas = new Map<
    string,
    { jobId: string; operation: string; task: string; delta: string; chars: number }
  >()
  private flushTimer?: ReturnType<typeof setTimeout>

  constructor(options: EventBusOptions = {}) {
    this.epoch = options.epoch ?? randomBytes(6).toString('hex')
    this.capacity = options.capacity ?? 3000
    this.flushMs = options.deltaFlushMs ?? 100
  }

  get lastSeq(): number {
    return this.seq
  }

  /** core 的事件出口（任务状态、进度、artifact 变化）。 */
  emit(event: CoreEvent): void {
    switch (event.type) {
      case 'job.updated':
        this.publish({ type: 'job.updated', job: event.job as never })
        break
      case 'job.progress':
        this.publish({
          type: 'job.progress',
          jobId: event.jobId,
          progress: event.progress,
          ...(event.message === undefined ? {} : { message: event.message }),
        })
        break
      case 'job.worker_error':
        this.publish({ type: 'job.worker_error', message: event.message })
        break
      case 'job.notice':
        this.publish({
          type: 'job.notice',
          level: event.level,
          code: event.code,
          message: event.message,
          projectId: event.projectId,
          ...(event.jobId === undefined ? {} : { jobId: event.jobId }),
          ...(event.shotId === undefined ? {} : { shotId: event.shotId }),
        })
        break
      case 'artifact.changed':
        this.publish({ type: 'artifact.changed', projectId: event.projectId, key: event.key })
        break
      case 'timeline.changed':
        this.changed('timeline', {
          projectId: event.projectId,
          ids: [event.episodeId],
          op: 'updated',
        })
        break
      case 'project.changed':
        this.publish({
          type: 'data.changed',
          projectId: event.projectId,
          entity: 'project',
          op: 'updated',
        })
        break
    }
  }

  publish(event: ServerEvent): BufferedEvent {
    // 先把挂起的 delta 刷出去，保证 delta 不会落在它所属任务的“完成”事件之后。
    if (event.type !== 'text.delta') this.flushDeltas()
    const seq = ++this.seq
    const buffered: BufferedEvent = { seq, id: formatEventId(this.epoch, seq), event }
    this.ring.push(buffered)
    if (this.ring.length > this.capacity) this.ring.splice(0, this.ring.length - this.capacity)
    for (const l of [...this.listeners]) {
      try {
        l(buffered)
      } catch {
        /* 一个订阅者出错不影响其他人 */
      }
    }
    return buffered
  }

  /** 数据变更通知的快捷入口。 */
  changed(
    entity: Extract<ServerEvent, { type: 'data.changed' }>['entity'],
    opts: { projectId?: string; ids?: string[]; op?: 'created' | 'updated' | 'deleted' } = {},
  ): void {
    this.publish({ type: 'data.changed', entity, ...opts })
  }

  /** 流式文本：窗口内的同一次调用的 delta 合并成一条。 */
  textDelta(input: {
    jobId: string
    operation: string
    task: string
    delta: string
    chars: number
  }): void {
    const key = `${input.jobId}\u0000${input.task}`
    const cur = this.pendingDeltas.get(key)
    if (cur) {
      cur.delta += input.delta
      cur.chars = input.chars
    } else {
      this.pendingDeltas.set(key, { ...input })
    }
    this.flushTimer ??= setTimeout(() => this.flushDeltas(), this.flushMs)
    this.flushTimer.unref?.()
  }

  flushDeltas(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    if (this.pendingDeltas.size === 0) return
    const pending = [...this.pendingDeltas.values()]
    this.pendingDeltas.clear()
    for (const p of pending) this.publish({ type: 'text.delta', ...p })
  }

  subscribe(listener: (e: BufferedEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 给定客户端上次收到的 id，算出该补发什么。 */
  replaySince(lastEventId: string | null | undefined): Replay {
    const parsed = parseEventId(lastEventId)
    if (!parsed) return { kind: 'none' }
    if (parsed.epoch !== this.epoch) return { kind: 'resync', reason: 'epoch_changed' }
    if (parsed.seq > this.seq) return { kind: 'resync', reason: 'epoch_changed' }
    if (parsed.seq === this.seq) return { kind: 'replay', events: [] }
    const oldest = this.ring[0]?.seq ?? this.seq + 1
    if (parsed.seq < oldest - 1) return { kind: 'resync', reason: 'buffer_overflow' }
    return {
      kind: 'replay',
      events: this.ring.filter((e) => e.seq > parsed.seq && e.event.type !== 'text.delta'),
    }
  }

  dispose(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    this.pendingDeltas.clear()
    this.listeners.clear()
  }
}
