import type { QueryClient } from '@tanstack/react-query'
import type { CallOutput, DramaiClient, ServerEvent } from '@dramai/api'
import { qk } from './keys'

/**
 * SSE 事件 → 前端状态。规则来自 packages/server/README.md：
 * - 事件只是“提示”，真相在接口里；缓存里的东西以重新取到的为准。
 * - 收到 resync（服务重启 / 缓冲溢出），或 hello 里的 epoch 与已知的不同：所有查询失效重取。
 * - job.updated 带完整任务：直接改写任务列表的缓存，再补一次（节流的）重取，校正排队位置。
 * - text.delta 是文本步骤的流式输出，约 100ms 一条，**不补发**：只在内存里累积，不进查询缓存。
 * - data.changed {entity, ids, projectId}：失效对应的查询。
 */

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

export interface StreamState {
  jobId: string
  operation: string
  task: string
  text: string
  chars: number
  updatedAt: number
}

export interface Notice {
  /** 本地用的编号（关掉某一条用）。 */
  id: number
  level: 'info' | 'warning'
  code: string
  message: string
  projectId: string
  jobId?: string
  shotId?: string
}

export interface EventSnapshot {
  status: ConnectionStatus
  /** 本次连接里看到的服务纪元；变了说明服务重启过。 */
  epoch?: string
  streams: Readonly<Record<string, StreamState>>
  /** 最近一次 worker 报错（job.worker_error，执行器自己出了错），任务面板里显示。 */
  workerError?: string
  /**
   * 提示（job.notice）：任务本身的结果是对的，只是某个附带步骤没完成（例如视频已保存，自动静音没设上）。
   * 只在内存里，刷新页面就没了；最新的在最后，最多保留这么多条。
   */
  notices: readonly Notice[]
  /** 最近一次整体刷新（用于测试和调试）。 */
  lastResync?: string
}

/** 流式文本在内存里最多保留这么多字（够界面显示最后一段）。 */
const MAX_STREAM_CHARS = 60_000
const MAX_STREAMS = 20
const MAX_NOTICES = 20

type Listener = () => void

/** 事件相关的瞬时状态（不是服务端状态，所以不放进查询缓存）。可用 useSyncExternalStore 订阅。 */
export class EventStore {
  #snap: EventSnapshot = { status: 'connecting', streams: {}, notices: [] }
  #noticeId = 0
  #listeners = new Set<Listener>()

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }
  getSnapshot = (): EventSnapshot => this.#snap

  #set(patch: Partial<EventSnapshot>) {
    this.#snap = { ...this.#snap, ...patch }
    for (const fn of this.#listeners) fn()
  }

  setStatus(status: ConnectionStatus) {
    if (status !== this.#snap.status) this.#set({ status })
  }
  setEpoch(epoch: string) {
    if (epoch !== this.#snap.epoch) this.#set({ epoch })
  }
  setWorkerError(message: string | undefined) {
    this.#set({ workerError: message })
  }
  addNotice(e: Extract<ServerEvent, { type: 'job.notice' }>) {
    const { type: _type, ...rest } = e
    void _type
    // the same notice for the same job / shot twice is one notice
    const same = (n: Notice) =>
      n.code === rest.code && n.jobId === rest.jobId && n.shotId === rest.shotId
    const notices = [
      ...this.#snap.notices.filter((n) => !same(n)),
      { ...rest, id: ++this.#noticeId },
    ].slice(-MAX_NOTICES)
    this.#set({ notices })
  }
  dismissNotice(id: number) {
    this.#set({ notices: this.#snap.notices.filter((n) => n.id !== id) })
  }
  noteResync(reason: string) {
    this.#set({ lastResync: reason })
  }

  appendText(e: Extract<ServerEvent, { type: 'text.delta' }>, now: number) {
    const prev = this.#snap.streams[e.jobId]
    const text = ((prev?.text ?? '') + e.delta).slice(-MAX_STREAM_CHARS)
    const streams = { ...this.#snap.streams, [e.jobId]: { ...e, text, updatedAt: now } }
    const ids = Object.keys(streams)
    if (ids.length > MAX_STREAMS) {
      const oldest = ids.sort((a, b) => streams[a]!.updatedAt - streams[b]!.updatedAt)[0]!
      delete streams[oldest]
    }
    this.#set({ streams })
  }
  clearStream(jobId: string) {
    if (!(jobId in this.#snap.streams)) return
    const streams = { ...this.#snap.streams }
    delete streams[jobId]
    this.#set({ streams })
  }
}

type JobList = CallOutput<'jobs.list'>

/** 合并后的任务：保留列表里的排队位置，重新算“需处理”。 */
function mergeJob(
  old: JobList['items'][number] | undefined,
  job: Extract<ServerEvent, { type: 'job.updated' }>['job'],
  target?: JobList['items'][number]['target'],
): JobList['items'][number] {
  return {
    ...job,
    queuePosition: job.status === 'queued' ? old?.queuePosition : undefined,
    needsAttention: job.status === 'failed' && job.acknowledgedAt === undefined,
    // 目标（镜头 / 资产名……）事件里可能带着；没带就沿用列表里已有的，随后的补充重取会校正
    target: target ?? old?.target ?? { kind: 'project' },
    resultIgnored: Boolean(job.ignoreResult) || Boolean(old?.resultIgnored),
  }
}

/** 把一批失效请求合并成一次（批量任务会在一瞬间产生几十个事件）。 */
export class Invalidator {
  #pending = new Map<string, readonly unknown[] | 'all'>()
  #timer: ReturnType<typeof setTimeout> | undefined
  readonly #queryClient: QueryClient
  readonly #delayMs: number
  constructor(queryClient: QueryClient, delayMs = 80) {
    this.#queryClient = queryClient
    this.#delayMs = delayMs
  }

  add(key: readonly unknown[]) {
    if (!this.#pending.has('*')) this.#pending.set(JSON.stringify(key), key)
    this.#schedule()
  }
  all() {
    this.#pending.clear()
    this.#pending.set('*', 'all')
    this.#schedule()
  }
  flushNow() {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    const pending = [...this.#pending.values()]
    this.#pending.clear()
    for (const key of pending) {
      if (key === 'all') void this.#queryClient.invalidateQueries()
      else void this.#queryClient.invalidateQueries({ queryKey: key })
    }
  }
  dispose() {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    this.#pending.clear()
  }
  #schedule() {
    if (this.#timer) return
    this.#timer = setTimeout(() => this.flushNow(), this.#delayMs)
  }
}

/** data.changed → 要失效的查询。查询的键形状见 keys.ts。 */
export function keysForChange(
  e: Extract<ServerEvent, { type: 'data.changed' }>,
): (readonly unknown[])[] {
  const pid = e.projectId
  // 集的进度汇总（候选数、设定图数……）被很多实体影响，列表项也带它们
  const progress = [pid ? qk.episodes(pid) : ['episodes'], qk.projects]
  // 镜头卡的“不能生成”原因、过期原因都由这些派生：实体一变就要重算
  const derived = [qk.preflight, qk.artifacts]
  switch (e.entity) {
    case 'project':
      return [qk.projects, ...(e.ids?.length ? e.ids.map((id) => qk.project(id)) : [['project']])]
    case 'episode':
      return [...progress, ['episode'], ...(pid ? [qk.project(pid)] : [['project']])]
    case 'scene':
    case 'shot':
      return [...progress, ['episode'], ...derived]
    case 'asset':
      return [pid ? qk.assets(pid) : ['assets'], ['asset'], ...progress, ['candidates'], ...derived]
    case 'candidate':
      return [
        pid ? qk.candidates(pid) : ['candidates'],
        pid ? qk.assets(pid) : ['assets'],
        ...progress,
      ]
    case 'material':
      return [
        pid ? qk.materials(pid) : ['materials'],
        ...progress,
        pid ? qk.project(pid) : ['project'],
      ]
    case 'timeline':
      return [qk.timeline, ...progress]
    case 'provider':
      return [qk.providers, qk.settings, qk.preflight]
    case 'settings':
      return [qk.settings, qk.preflight]
    case 'import':
      return [qk.projects, ['episodes'], ['project']]
  }
}

export interface EventDeps {
  queryClient: QueryClient
  store: EventStore
  invalidator: Invalidator
  now?: () => number
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
/** 文本任务结束后，流式文本再保留一会儿，让用户看到最后的输出。 */
export const STREAM_LINGER_MS = 15_000

export function routeEvent(event: ServerEvent, deps: EventDeps): void {
  const { queryClient, store, invalidator } = deps
  const now = deps.now?.() ?? Date.now()
  switch (event.type) {
    case 'hello': {
      store.setEpoch(event.epoch)
      const known = queryClient.getQueryData<CallOutput<'system.get'>>(qk.system)
      if (known && known.epoch !== event.epoch) invalidator.all()
      return
    }
    case 'resync':
      store.noteResync(event.reason)
      invalidator.all()
      return
    case 'job.updated': {
      const job = event.job
      let found = false
      queryClient.setQueryData<JobList>(qk.jobs, (old) => {
        if (!old) return old
        const items = old.items.map((j) => {
          if (j.id !== job.id) return j
          found = true
          return mergeJob(j, job, event.target)
        })
        return { items: found ? items : [mergeJob(undefined, job, event.target), ...items] }
      })
      // 队列位置、新任务的完整信息：补一次节流的重取
      invalidator.add(qk.jobs)
      if (TERMINAL.has(job.status)) {
        // 任务结束，对应的实体和进度很可能变了（事件通常会先到，这里是兜底）
        invalidator.add(job.projectId ? qk.episodes(job.projectId) : ['episodes'])
        // 生成结束：镜头的版本、过期状态、能不能再生成都可能变了
        invalidator.add(['episode'])
        invalidator.add(qk.artifacts)
        invalidator.add(qk.preflight)
        invalidator.add(qk.timeline)
        // 设定图 / 候选也可能是这个任务产出的（服务端不一定另发 data.changed）
        invalidator.add(['asset'])
        invalidator.add(job.projectId ? qk.assets(job.projectId) : ['assets'])
        invalidator.add(job.projectId ? qk.candidates(job.projectId) : ['candidates'])
        setTimeout(() => store.clearStream(job.id), STREAM_LINGER_MS)
      }
      return
    }
    case 'job.progress': {
      queryClient.setQueryData<JobList>(qk.jobs, (old) =>
        old
          ? {
              items: old.items.map((j) =>
                j.id === event.jobId ? { ...j, progress: event.progress } : j,
              ),
            }
          : old,
      )
      return
    }
    case 'job.worker_error':
      store.setWorkerError(event.message)
      return
    case 'job.notice':
      store.addNotice(event)
      return
    case 'text.delta':
      store.appendText(event, now)
      return
    case 'data.changed':
      for (const key of keysForChange(event)) invalidator.add(key)
      return
    case 'artifact.changed':
      invalidator.add(qk.artifacts)
      invalidator.add(qk.episodes(event.projectId))
      return
  }
}

/**
 * 订阅 SSE（断线重连、Last-Event-ID 补发由 @dramai/api 的客户端负责），把事件接到缓存和瞬时状态上。
 * 重连成功后补一次 system 重取：epoch 变了就会走整体刷新。
 */
export function startEventSync(
  client: DramaiClient,
  deps: Omit<EventDeps, 'invalidator'> & { invalidator?: Invalidator },
) {
  const invalidator = deps.invalidator ?? new Invalidator(deps.queryClient)
  const full: EventDeps = { ...deps, invalidator }
  let lastStatus: ConnectionStatus = 'connecting'
  const conn = client.connectEvents({
    onEvent: (e) => routeEvent(e, full),
    onResync: (reason) => {
      full.store.noteResync(reason)
      invalidator.all()
    },
    onStatus: (status) => {
      full.store.setStatus(status)
      if (status === 'open' && lastStatus === 'closed') invalidator.add(qk.system)
      lastStatus = status
    },
  })
  return {
    close() {
      conn.close()
      invalidator.dispose()
    },
    invalidator,
  }
}
