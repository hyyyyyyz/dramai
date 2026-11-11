import { ProviderError } from './errors.ts'
import type {
  AuthContext,
  GenerateParse,
  HttpRequestSpec,
  MediaProtocol,
  OutputRef,
  PollParse,
  RawResponse,
} from './types.ts'

/**
 * 统一执行器：协议适配器是纯函数，网络都在这里。`fetch` 与 `sleep` 可注入。
 *
 * 阶段：submit（提交）→ poll（轮询，仅异步协议）→ download（取成品）。
 * 提交后**立刻**通过 `onSubmitted(taskId)` 回调把上游任务号交给调用方做检查点——
 * 这是"重启后续轮询、绝不重投"的前提。
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ExecutorDeps {
  fetch?: FetchLike
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface PollOptions {
  intervalMs: number
  maxAttempts: number
  /** 连续多少次轮询请求失败（网络/5xx/解析）才放弃。默认 5。 */
  maxConsecutiveErrors?: number
}

export const POLL_DEFAULTS = {
  image: { intervalMs: 5_000, maxAttempts: 120 },
  video: { intervalMs: 10_000, maxAttempts: 300 },
} as const

export interface GenerateOptions {
  signal?: AbortSignal
  /** 单次 HTTP 请求的超时。默认 120s。 */
  requestTimeoutMs?: number
  poll?: PollOptions
  /** 异步协议：拿到上游任务号后立刻调用。必须完成持久化后才返回。 */
  onSubmitted?: (taskId: string) => void | Promise<void>
  /** 每次轮询后的回调（进度/阶段）。 */
  onPoll?: (state: PollParse, attempt: number) => void | Promise<void>
  /** 恢复：跳过提交，直接用这个任务号继续轮询。 */
  resumeTaskId?: string
  /** 恢复：上游已给出结果地址，只重走下载。 */
  resumeOutputs?: OutputRef[]
  /** 上游已成功但下载的是 URL 输出时的回调（在下载前，便于写检查点）。 */
  onResult?: (outputs: OutputRef[]) => void | Promise<void>
  /** 是否下载 URL 输出（默认 true）。 */
  download?: boolean
}

export interface DownloadedOutput {
  bytes: Uint8Array
  mime: string
  /** 原始 URL 输出的地址（若有）。 */
  sourceUrl?: string
}

export interface GenerateResult {
  outputs: DownloadedOutput[]
  taskId?: string
  durationSec?: number
}

const DEFAULT_TIMEOUT = 120_000

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError(): ProviderError {
  return new ProviderError('cancelled', '已取消', { code: 'CANCELLED' })
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/** 发出一个请求并读成 RawResponse。网络层错误抛 ProviderError(network)。 */
export async function sendRequest(
  spec: HttpRequestSpec,
  deps: ExecutorDeps,
  options: { signal?: AbortSignal; timeoutMs?: number; binary?: boolean } = {},
): Promise<RawResponse> {
  const doFetch = deps.fetch ?? fetch
  const init: RequestInit = {
    method: spec.method,
    headers: spec.headers,
    signal: withTimeout(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT),
  }
  if (spec.body?.type === 'json') init.body = JSON.stringify(spec.body.value)
  else if (spec.body?.type === 'form') init.body = spec.body.value

  let res: Response
  try {
    res = await doFetch(spec.url, init)
  } catch (err) {
    if (options.signal?.aborted) throw abortError()
    if (isAbort(err)) {
      throw new ProviderError('network', '请求超时', { cause: err, code: 'TIMEOUT' })
    }
    const msg = err instanceof Error ? err.message : String(err)
    throw new ProviderError('network', `网络错误：${msg}`, { cause: err, code: 'NETWORK' })
  }

  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v
  })

  try {
    if (options.binary && res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      return { status: res.status, headers, text: '', bytes }
    }
    const text = await res.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    return { status: res.status, headers, text, json }
  } catch (err) {
    if (options.signal?.aborted) throw abortError()
    throw new ProviderError(
      'network',
      `读取响应失败：${err instanceof Error ? err.message : err}`,
      {
        cause: err,
        status: res.status,
        code: 'NETWORK',
      },
    )
  }
}

function snippet(raw: RawResponse): string {
  return raw.text.slice(0, 280)
}

function submissionOutcomeForStatus(status: number): 'rejected' | 'unknown' {
  // 4xx：上游明确拒绝，没有任务、没有费用。5xx：不知道有没有受理。
  return status >= 400 && status < 500 ? 'rejected' : 'unknown'
}

/** 下载 URL 输出。 */
export async function downloadOutput(
  output: OutputRef,
  deps: ExecutorDeps,
  options: {
    signal?: AbortSignal
    timeoutMs?: number
    retries?: number
    sleep?: ExecutorDeps['sleep']
  } = {},
): Promise<DownloadedOutput> {
  if (output.kind === 'bytes') return { bytes: output.bytes, mime: output.mime }
  const retries = options.retries ?? 2
  const sleep = options.sleep ?? deps.sleep ?? defaultSleep
  let last: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const raw = await sendRequest({ method: 'GET', url: output.url, headers: {} }, deps, {
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? 300_000,
        binary: true,
      })
      if (raw.status < 200 || raw.status >= 300 || !raw.bytes) {
        throw new ProviderError('download_failed', `下载成品失败：HTTP ${raw.status}`, {
          status: raw.status,
          recoverable: true,
          code: `HTTP_${raw.status}`,
        })
      }
      const mime =
        output.mime ??
        raw.headers['content-type']?.split(';')[0]?.trim() ??
        'application/octet-stream'
      return { bytes: raw.bytes, mime, sourceUrl: output.url }
    } catch (err) {
      if (err instanceof ProviderError && err.kind === 'cancelled') throw err
      last = err
      if (attempt < retries) await sleep(1000 * (attempt + 1), options.signal)
    }
  }
  if (last instanceof ProviderError && last.kind === 'download_failed') throw last
  throw new ProviderError(
    'download_failed',
    `下载成品失败：${last instanceof Error ? last.message : String(last)}`,
    { recoverable: true, cause: last, code: 'DOWNLOAD_FAILED' },
  )
}

async function submit<I>(
  protocol: MediaProtocol<I>,
  auth: AuthContext,
  input: I,
  deps: ExecutorDeps,
  options: GenerateOptions,
): Promise<GenerateParse> {
  const spec = protocol.buildGenerateRequest(auth, input)
  let raw: RawResponse
  try {
    raw = await sendRequest(spec, deps, {
      signal: options.signal,
      timeoutMs: options.requestTimeoutMs,
      binary: protocol.responseType === 'binary',
    })
  } catch (err) {
    if (err instanceof ProviderError && err.kind === 'network') {
      // 请求可能已送达并计费，只是我们没拿到响应。
      throw new ProviderError('network', err.message, {
        cause: err,
        submission: 'unknown',
        code: err.code,
      })
    }
    throw err
  }
  if (raw.status < 200 || raw.status >= 300) {
    throw new ProviderError('http', `HTTP ${raw.status}${raw.text ? ` · ${snippet(raw)}` : ''}`, {
      status: raw.status,
      body: snippet(raw),
      submission: submissionOutcomeForStatus(raw.status),
    })
  }
  let parsed: GenerateParse
  try {
    parsed = protocol.parseGenerateResponse(raw)
  } catch (err) {
    throw new ProviderError(
      'parse',
      `无法解析提交响应：${err instanceof Error ? err.message : err}`,
      {
        cause: err,
        submission: 'unknown',
      },
    )
  }
  if (parsed.status === 'failed') {
    // 2xx 但读不出任务号/结果：请求已被受理的可能性不能排除。
    throw new ProviderError('parse', parsed.message, {
      body: snippet(raw),
      submission: 'unknown',
      code: 'UNREADABLE_RESPONSE',
    })
  }
  return parsed
}

async function pollUntilDone<I>(
  protocol: MediaProtocol<I>,
  auth: AuthContext,
  taskId: string,
  deps: ExecutorDeps,
  options: GenerateOptions,
  defaults: PollOptions,
): Promise<Extract<PollParse, { status: 'completed' }>> {
  if (!protocol.buildPollRequest || !protocol.parsePollResponse) {
    throw new ProviderError('capability', `协议 ${protocol.id} 不支持轮询`)
  }
  const poll = options.poll ?? defaults
  const maxErrors = poll.maxConsecutiveErrors ?? 5
  const sleep = deps.sleep ?? defaultSleep
  let consecutiveErrors = 0
  for (let attempt = 1; attempt <= poll.maxAttempts; attempt++) {
    if (options.signal?.aborted) throw abortError()
    try {
      const raw = await sendRequest(protocol.buildPollRequest(auth, taskId), deps, {
        signal: options.signal,
        timeoutMs: options.requestTimeoutMs,
      })
      if (raw.status >= 400 && raw.status < 500 && raw.status !== 429) {
        throw new ProviderError('http', `轮询被拒绝：HTTP ${raw.status} · ${snippet(raw)}`, {
          status: raw.status,
          body: snippet(raw),
          recoverable: raw.status !== 404 && raw.status !== 410,
        })
      }
      if (raw.status < 200 || raw.status >= 300) {
        throw new PollTransient(`HTTP ${raw.status}`)
      }
      let parsed: PollParse
      try {
        parsed = protocol.parsePollResponse(raw)
      } catch (err) {
        throw new PollTransient(`无法解析轮询响应：${err instanceof Error ? err.message : err}`)
      }
      consecutiveErrors = 0
      await options.onPoll?.(parsed, attempt)
      if (parsed.status === 'completed') return parsed
      if (parsed.status === 'failed') {
        throw new ProviderError('upstream_failed', parsed.message, { code: 'UPSTREAM_FAILED' })
      }
    } catch (caught) {
      // 轮询时的网络错误/超时是暂时性的：任务已经在上游了，继续轮询。
      const err =
        caught instanceof ProviderError && caught.kind === 'network'
          ? new PollTransient(caught.message)
          : caught
      if (err instanceof ProviderError) throw err
      if (err instanceof PollTransient) {
        consecutiveErrors++
        if (consecutiveErrors >= maxErrors) {
          throw new ProviderError(
            'poll_failed',
            `连续 ${consecutiveErrors} 次轮询失败：${err.message}`,
            {
              recoverable: true,
              code: 'POLL_FAILED',
            },
          )
        }
      } else {
        throw err
      }
    }
    if (attempt < poll.maxAttempts) await sleep(poll.intervalMs, options.signal)
  }
  throw new ProviderError('poll_timeout', `轮询 ${poll.maxAttempts} 次仍未完成`, {
    recoverable: true,
    code: 'POLL_TIMEOUT',
  })
}

class PollTransient extends Error {}

/**
 * 一次完整的生成：提交 →（轮询）→ 下载。同步协议跳过轮询。
 */
export async function runGeneration<I>(
  protocol: MediaProtocol<I>,
  auth: AuthContext,
  input: I,
  deps: ExecutorDeps = {},
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const defaults = protocol.media === 'video' ? POLL_DEFAULTS.video : POLL_DEFAULTS.image
  let taskId = options.resumeTaskId
  let outputs: OutputRef[] | undefined = options.resumeOutputs
  let durationSec: number | undefined

  if (!outputs) {
    if (!taskId) {
      const parsed = await submit(protocol, auth, input, deps, options)
      if (parsed.status === 'sync') {
        outputs = parsed.outputs
      } else if (parsed.status === 'async') {
        taskId = parsed.taskId
        await options.onSubmitted?.(taskId)
      }
    }
    if (!outputs) {
      const done = await pollUntilDone(protocol, auth, taskId!, deps, options, defaults)
      outputs = done.outputs
      durationSec = done.durationSec
    }
    await options.onResult?.(outputs)
  }

  if (options.download === false) {
    return {
      outputs: outputs.map((o) =>
        o.kind === 'bytes'
          ? { bytes: o.bytes, mime: o.mime }
          : { bytes: new Uint8Array(), mime: o.mime ?? '', sourceUrl: o.url },
      ),
      taskId,
      durationSec,
    }
  }
  const downloaded: DownloadedOutput[] = []
  for (const o of outputs) {
    downloaded.push(await downloadOutput(o, deps, { signal: options.signal }))
  }
  return { outputs: downloaded, taskId, durationSec }
}
