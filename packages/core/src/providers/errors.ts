import type { JobError } from '../jobs/types.ts'

export type ProviderErrorKind =
  | 'http' // 非 2xx
  | 'network' // fetch 抛错（连接/超时），请求可能已送达
  | 'parse' // 响应读不懂
  | 'upstream_failed' // 上游明确说生成失败
  | 'poll_failed' // 连续轮询失败
  | 'poll_timeout' // 轮询次数耗尽
  | 'download_failed' // 上游成功但取不到成品
  | 'capability' // 模型缺少所需能力
  | 'cancelled'

/**
 * 提交请求是否可能已被上游受理（从而可能计费）。
 * - rejected：上游明确拒绝（4xx）或明确说失败——没有任务、没有费用。
 * - unknown：请求可能已送达（网络错误、5xx、响应读不懂）。**不得自动重投**。
 * - none：不是提交阶段的错误。
 */
export type SubmissionOutcome = 'rejected' | 'unknown' | 'none'

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly status?: number
  readonly body?: string
  readonly submission: SubmissionOutcome
  /** 已有上游任务号/结果地址，可以续上。 */
  readonly recoverable: boolean
  readonly code: string

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options: {
      status?: number
      body?: string
      submission?: SubmissionOutcome
      recoverable?: boolean
      code?: string
      cause?: unknown
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ProviderError'
    this.kind = kind
    this.status = options.status
    this.body = options.body
    this.submission = options.submission ?? 'none'
    this.recoverable = options.recoverable ?? false
    this.code =
      options.code ?? (options.status !== undefined ? `HTTP_${options.status}` : kind.toUpperCase())
  }
}

/** 把执行器抛出的错误映射成 Job 的失败分类。 */
export function toJobError(err: unknown): JobError {
  if (err instanceof ProviderError) {
    if (err.kind === 'upstream_failed') {
      return {
        category: 'generation_failed',
        code: err.code,
        message: err.message,
        recoverable: false,
      }
    }
    if (err.submission === 'unknown') {
      return {
        category: 'submission_unknown',
        code: err.code,
        message: err.message,
        recoverable: false,
      }
    }
    if (
      err.kind === 'poll_failed' ||
      err.kind === 'poll_timeout' ||
      err.kind === 'download_failed'
    ) {
      return {
        category: 'delivery_failed',
        code: err.code,
        message: err.message,
        recoverable: true,
      }
    }
    if (err.kind === 'capability') {
      return { category: 'invalid_input', code: err.code, message: err.message, recoverable: false }
    }
    // 4xx 拒绝：没发起任务，没有费用。
    return {
      category: 'generation_failed',
      code: err.code,
      message: err.message,
      recoverable: err.recoverable,
    }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { category: 'internal', code: 'INTERNAL', message, recoverable: false }
}
