import type { z } from 'zod'
import { apiErrorBody } from './schemas.ts'
import { serverEvent } from './events.ts'
import type { ServerEvent } from './events.ts'
import { fileRoutes, routes } from './routes.ts'
import type { RouteDef, RouteName, Routes } from './routes.ts'

/** 接口返回非 2xx 时抛出。 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export type PathParams<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? { [K in Name]: string } & PathParams<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? { [K in Name]: string }
    : unknown

type HasKeys<T> = [keyof T] extends [never] ? false : true

type ParamsPart<R extends RouteDef> =
  HasKeys<PathParams<R['path']>> extends true ? { params: PathParams<R['path']> } : unknown
type QueryPart<R extends RouteDef> = R['query'] extends z.ZodType
  ? { query?: z.input<R['query']> }
  : unknown
type BodyPart<R extends RouteDef> = R['body'] extends z.ZodType
  ? { body: z.input<R['body']> }
  : R['body'] extends 'multipart'
    ? { form: FormData }
    : unknown

export type CallInput<N extends RouteName> = ParamsPart<Routes[N]> &
  QueryPart<Routes[N]> &
  BodyPart<Routes[N]>
export type CallOutput<N extends RouteName> = z.output<Routes[N]['response']>

type Required_<I> = I extends { params: unknown } | { body: unknown } | { form: unknown }
  ? true
  : false
type CallArgs<N extends RouteName> =
  HasKeys<CallInput<N>> extends false
    ? [input?: undefined]
    : Required_<CallInput<N>> extends true
      ? [input: CallInput<N>]
      : [input?: CallInput<N>]

export interface ClientOptions {
  /** 服务地址。同源（浏览器里由服务托管前端）时留空。 */
  baseUrl?: string
  /** 访问令牌（监听非回环地址时必需）。浏览器里通常用 cookie，不用传。 */
  token?: string
  fetch?: typeof fetch
  /**
   * 内置数据（风格预设名称、服务商备注、演示提示语……）要哪种语言：`zh` / `en`。
   * 发成请求头 `X-Dramai-Locale`；不给则服务端依次看应用设置里的语言、`Accept-Language`，最后用中文。
   * 用户自己填写的内容永远原样返回，不受它影响。
   */
  locale?: string
  /** 用 schema 校验响应（默认开：服务端和前端漂移时第一时间发现）。 */
  validate?: boolean
}

export interface EventsHandlers {
  onEvent: (event: ServerEvent) => void
  /**
   * 需要整体刷新：服务重启过（epoch 变了），或服务端补不齐你错过的事件。
   * 前端的做法：让所有查询失效重取（任务列表、项目列表……）。
   */
  onResync?: (reason: 'epoch_changed' | 'buffer_overflow' | 'first_connect_after_gap') => void
  onStatus?: (status: 'connecting' | 'open' | 'closed') => void
  /** 重连退避，毫秒。默认从 1000 起、翻倍、封顶 10000。 */
  retry?: { initialMs?: number; maxMs?: number }
}

function expandPath(template: string, params: Record<string, string> | undefined): string {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
    const v = params?.[name]
    if (v === undefined) throw new Error(`missing path parameter: ${name}`)
    return encodeURIComponent(v)
  })
}

function toQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null) sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export function createClient(options: ClientOptions = {}) {
  const base = (options.baseUrl ?? '').replace(/\/+$/, '')
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const validate = options.validate !== false

  const authHeaders = (): Record<string, string> => ({
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.locale ? { 'X-Dramai-Locale': options.locale } : {}),
  })

  async function call<N extends RouteName>(name: N, ...args: CallArgs<N>): Promise<CallOutput<N>> {
    const def = routes[name] as RouteDef
    const input = (args[0] ?? {}) as {
      params?: Record<string, string>
      query?: Record<string, unknown>
      body?: unknown
      form?: FormData
    }
    const url = base + expandPath(def.path, input.params) + toQuery(input.query)
    const headers: Record<string, string> = { Accept: 'application/json', ...authHeaders() }
    let body: FormData | string | undefined
    if (def.body === 'multipart') {
      if (!input.form) throw new Error(`${name} needs a FormData in "form"`)
      body = input.form
    } else if (def.body) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(def.body.parse(input.body))
    }
    const res = await doFetch(url, {
      method: def.method,
      headers,
      body,
      credentials: 'same-origin',
    })
    const text = await res.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    if (!res.ok) {
      const parsed = apiErrorBody.safeParse(json)
      if (parsed.success)
        throw new ApiError(
          res.status,
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.details,
        )
      throw new ApiError(res.status, 'HTTP_ERROR', text.slice(0, 200) || res.statusText)
    }
    return (validate ? def.response.parse(json) : json) as CallOutput<N>
  }

  /** 项目文件（图 / 视频 / 音频 / 素材）的地址，给 <img> <video> <audio> 用；支持 Range。`path` 是实体里 FileRef.path。 */
  function fileUrl(projectId: string, path: string): string {
    return `${base}${fileRoutes.file.replace(':projectId', encodeURIComponent(projectId)).replace('*', path.split('/').map(encodeURIComponent).join('/'))}`
  }

  function exportUrl(kind: 'srt' | 'vtt' | 'package' | 'cut', episodeId: string): string {
    return `${base}${fileRoutes[kind].replace(':episodeId', encodeURIComponent(episodeId))}`
  }

  /**
   * 订阅 SSE。用 fetch 流实现（浏览器和 Node 都能用），自动重连并带上 `Last-Event-ID`：
   * 服务端补发错过的事件；补不齐就发 `resync`，这里转成 `onResync`。
   */
  function connectEvents(handlers: EventsHandlers): { close: () => void } {
    let closed = false
    let lastId: string | undefined
    let lastEpoch: string | undefined
    let controller: AbortController | undefined
    const retry = {
      initialMs: handlers.retry?.initialMs ?? 1000,
      maxMs: handlers.retry?.maxMs ?? 10_000,
    }

    const run = async () => {
      let delay = retry.initialMs
      let hadConnection = false
      while (!closed) {
        controller = new AbortController()
        handlers.onStatus?.('connecting')
        try {
          const res = await doFetch(`${base}${fileRoutes.events}`, {
            headers: {
              Accept: 'text/event-stream',
              ...(lastId ? { 'Last-Event-ID': lastId } : {}),
              ...authHeaders(),
            },
            signal: controller.signal,
            credentials: 'same-origin',
          })
          if (!res.ok || !res.body) throw new Error(`events: HTTP ${res.status}`)
          handlers.onStatus?.('open')
          delay = retry.initialMs
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          let cur: { id?: string; event?: string; data: string[] } = { data: [] }
          while (!closed) {
            const { value, done } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const lines = buf.split(/\r\n|\n|\r/)
            buf = lines.pop() ?? ''
            for (const line of lines) {
              if (line === '') {
                if (cur.data.length > 0) {
                  if (cur.id) lastId = cur.id
                  let parsed: ServerEvent | undefined
                  try {
                    const r = serverEvent.safeParse(JSON.parse(cur.data.join('\n')))
                    parsed = r.success ? r.data : undefined
                  } catch {
                    parsed = undefined
                  }
                  if (parsed) {
                    if (parsed.type === 'hello') {
                      if (lastEpoch !== undefined && lastEpoch !== parsed.epoch)
                        handlers.onResync?.('epoch_changed')
                      else if (lastEpoch === undefined && hadConnection)
                        handlers.onResync?.('first_connect_after_gap')
                      lastEpoch = parsed.epoch
                    } else if (parsed.type === 'resync') {
                      handlers.onResync?.(parsed.reason)
                    }
                    handlers.onEvent(parsed)
                  }
                }
                cur = { data: [] }
              } else if (line.startsWith(':')) {
                // 注释 / 心跳
              } else {
                const i = line.indexOf(':')
                const field = i < 0 ? line : line.slice(0, i)
                const v = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '')
                if (field === 'data') cur.data.push(v)
                else if (field === 'id') cur.id = v
                else if (field === 'event') cur.event = v
              }
            }
          }
          hadConnection = true
        } catch {
          if (closed) break
        }
        if (closed) break
        handlers.onStatus?.('closed')
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(retry.maxMs, delay * 2)
      }
      handlers.onStatus?.('closed')
    }
    void run()
    return {
      close() {
        closed = true
        controller?.abort()
      },
    }
  }

  return { call, fileUrl, exportUrl, connectEvents, eventsUrl: () => `${base}${fileRoutes.events}` }
}

export type DramaiClient = ReturnType<typeof createClient>
