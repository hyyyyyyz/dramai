export type MockKind = 'llm' | 'image' | 'video' | 'tts'

/**
 * 可注入的故障。落到任务上的失败分类（取决于 core 的执行器，测试里逐条核对）：
 *
 * | 故障              | 发生在       | 上游表现                         | 任务落到                                   |
 * | ----------------- | ------------ | -------------------------------- | ------------------------------------------ |
 * | `rate_limit`      | 提交         | HTTP 429 + Retry-After           | generation_failed `HTTP_429`（明确拒绝）    |
 * | `reject`          | 提交         | HTTP 400                         | generation_failed `HTTP_400`（明确拒绝）    |
 * | `server_error`    | 提交         | HTTP 500                         | submission_unknown `HTTP_500`（不得重投）   |
 * | `drop_connection` | 提交         | 连接被掐断                        | submission_unknown（不得重投）             |
 * | `bad_output`      | 提交         | 200 但读不懂                      | submission_unknown `UNREADABLE_RESPONSE`   |
 * | `upstream_failed` | 视频轮询     | 任务状态 FAILED                   | generation_failed `UPSTREAM_FAILED`        |
 * | `poll_error`      | 视频轮询     | 轮询一直 502                      | delivery_failed `POLL_FAILED`（可续上）     |
 * | `download_error`  | 视频下载     | 成品地址 404                      | delivery_failed `DOWNLOAD_FAILED`（可续上） |
 * | `slow_queue`      | 视频轮询     | 长时间 PENDING，之后正常完成       | 一直排队中，之后成功（或轮询耗尽 POLL_TIMEOUT）|
 *
 * 文本（llm）：`bad_output` = 回一段不是 JSON 的话（走“让模型重来一次”的路径，仍不合格则该步骤失败）。
 * 图片 / 配音是同步的，没有轮询阶段：`upstream_failed` 在它们身上表现为 HTTP 422（明确拒绝）。
 */
export const FAULT_KINDS = [
  'rate_limit',
  'reject',
  'server_error',
  'drop_connection',
  'bad_output',
  'upstream_failed',
  'poll_error',
  'download_error',
  'slow_queue',
] as const
export type FaultKind = (typeof FAULT_KINDS)[number]

export interface FaultRule {
  fault: FaultKind
  /** 只对这一类请求生效（缺省 = 任何）。 */
  on?: MockKind | 'any'
  /** 请求体（提示词）里包含这段文字才生效。 */
  promptIncludes?: string
  /** 这一类的第 N 个请求（从 1 数）。 */
  nth?: number
  /** 这一类每 N 个请求一次。 */
  every?: number
  /** 最多触发几次（缺省不限）。 */
  times?: number
}

export interface MockConfig {
  /** 每个请求的固定延迟（毫秒）。 */
  latencyMs: number
  /** 在固定延迟之上再随机加 0..jitterMs。 */
  jitterMs: number
  /** 流式回复每块之间的间隔（毫秒）。 */
  streamChunkMs: number
  /** 视频任务从提交到完成要多久（毫秒）。 */
  videoMs: number
  /** `slow_queue` 的任务在队里排多久（毫秒）。 */
  slowQueueMs: number
  /** 随机失败的概率（0..1），在 `failureOn` 这些类别上、从 `failureKinds` 里随机选一种。 */
  failureRate: number
  failureKinds: FaultKind[]
  failureOn: MockKind[]
  /** 指定请求的失败规则，按顺序，第一条命中的生效。 */
  rules: FaultRule[]
  /** 随机数种子：同样的种子 + 同样的请求顺序 = 同样的失败。 */
  seed: number
}

export const DEFAULT_CONFIG: MockConfig = {
  latencyMs: 0,
  jitterMs: 0,
  streamChunkMs: 15,
  videoMs: 3000,
  slowQueueMs: 120_000,
  failureRate: 0,
  failureKinds: ['rate_limit', 'server_error', 'upstream_failed'],
  failureOn: ['image', 'video', 'tts'],
  rules: [],
  seed: 1,
}

const SYNC_ONLY_NOT: ReadonlySet<FaultKind> = new Set([
  'poll_error',
  'download_error',
  'slow_queue',
])

/** 这种故障能不能用在这一类请求上（轮询 / 下载阶段的故障只有视频有）。 */
export function applies(fault: FaultKind, kind: MockKind): boolean {
  if (SYNC_ONLY_NOT.has(fault)) return kind === 'video'
  if (fault === 'upstream_failed') return kind !== 'llm'
  return true
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MARKER = /\[\[mock:([a-z_]+)\]\]/

/** 决定一个请求要不要出故障。 */
export class FaultEngine {
  private rng: () => number
  private readonly counters = new Map<MockKind, number>()
  private readonly fired = new Map<FaultRule, number>()

  private readonly getConfig: () => MockConfig

  constructor(getConfig: () => MockConfig) {
    this.getConfig = getConfig
    this.rng = mulberry32(getConfig().seed)
  }

  reseed(seed: number): void {
    this.rng = mulberry32(seed)
  }

  reset(): void {
    this.counters.clear()
    this.fired.clear()
    this.rng = mulberry32(this.getConfig().seed)
  }

  decide(kind: MockKind, bodyText: string, header?: string): FaultKind | undefined {
    const config = this.getConfig()
    const n = (this.counters.get(kind) ?? 0) + 1
    this.counters.set(kind, n)

    // 1. 请求自己指定：请求头或提示词里的 [[mock:xxx]]
    const asked = header ?? MARKER.exec(bodyText)?.[1]
    if (asked && (FAULT_KINDS as readonly string[]).includes(asked)) {
      const f = asked as FaultKind
      return applies(f, kind) ? f : undefined
    }
    // 2. 规则
    for (const rule of config.rules) {
      if (rule.on && rule.on !== 'any' && rule.on !== kind) continue
      if (!applies(rule.fault, kind)) continue
      if (rule.promptIncludes && !bodyText.includes(rule.promptIncludes)) continue
      if (rule.nth !== undefined && rule.nth !== n) continue
      if (rule.every !== undefined && n % rule.every !== 0) continue
      const used = this.fired.get(rule) ?? 0
      if (rule.times !== undefined && used >= rule.times) continue
      this.fired.set(rule, used + 1)
      return rule.fault
    }
    // 3. 随机
    if (config.failureRate > 0 && config.failureOn.includes(kind)) {
      const pool = config.failureKinds.filter((f) => applies(f, kind))
      const roll = this.rng()
      if (pool.length > 0 && roll < config.failureRate) {
        return pool[Math.floor(this.rng() * pool.length)]
      }
    }
    return undefined
  }
}
