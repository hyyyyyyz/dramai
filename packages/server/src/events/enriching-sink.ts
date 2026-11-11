import type { CoreEvent, EventSink, Job } from '@dramai/core'
import type { JobTarget } from '@dramai/api'
import type { EventBus } from './event-bus.ts'

/**
 * core 的事件出口。`job.updated` 要带上任务的目标（结构化，需要查库），所以事件走一条串行链：
 * 先查、再发，保证事件顺序不乱。其余事件原样转给总线。
 */
export class EnrichingEventSink implements EventSink {
  private tail: Promise<void> = Promise.resolve()
  private readonly bus: EventBus
  private readonly resolve: (job: Job) => Promise<JobTarget>

  constructor(bus: EventBus, resolve: (job: Job) => Promise<JobTarget>) {
    this.bus = bus
    this.resolve = resolve
  }

  emit(event: CoreEvent): void {
    this.tail = this.tail.then(async () => {
      if (event.type === 'job.updated') {
        const target = await this.resolve(event.job).catch(() => undefined)
        this.bus.publish({
          type: 'job.updated',
          job: event.job as never,
          ...(target ? { target } : {}),
        })
      } else {
        this.bus.emit(event)
      }
    })
  }

  /** 等已经排队的事件都发完（关闭服务前调用）。 */
  idle(): Promise<void> {
    return this.tail
  }
}
