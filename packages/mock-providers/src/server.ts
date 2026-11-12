import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createAdaptorServer } from '@hono/node-server'
import { Hono } from 'hono'
import type { Context } from 'hono'
import { DEFAULT_CONFIG, FaultEngine, FAULT_KINDS } from './config.ts'
import type { FaultKind, FaultRule, MockConfig, MockKind } from './config.ts'
import { answer, detectTask, LlmMemory } from './llm/tasks.ts'
import type { ChatMessage } from './llm/tasks.ts'
import { hash32, placeholderPng, pngSize } from './media/png.ts'
import { locateMedia, renderPlaceholderVideo } from './media/video.ts'
import type { MediaEnv } from './media/video.ts'
import { placeholderWav } from './media/wav.ts'

export interface RequestLogEntry {
  at: number
  method: string
  path: string
  kind?: MockKind
  fault?: FaultKind
  status: number
}

export interface MockProviders {
  /** 例如 `http://127.0.0.1:8788`。把它填进服务商配置的 baseUrl。 */
  url: string
  host: string
  port: number
  /** 当前生效的配置（对象是活的，改它立刻生效）。 */
  config: MockConfig
  configure(patch: Partial<MockConfig>): void
  addRule(rule: FaultRule): void
  clearRules(): void
  /** 清掉已经存在的视频任务身上的故障（演练“上游恢复了，续上原任务”）。 */
  heal(): void
  requests: RequestLogEntry[]
  /** 收到过多少次各类请求（含出故障的）。 */
  counts(): Record<MockKind, number>
  close(): Promise<void>
}

export interface StartOptions {
  /** 0 = 系统分配。 */
  port?: number
  config?: Partial<MockConfig>
  /** 每个请求一行日志。 */
  log?: (line: string) => void
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface VideoTask {
  id: string
  createdAt: number
  fault?: FaultKind
  bytes?: Promise<Uint8Array>
  failed?: string
  polls: number
}

function parseRatio(ratio: string | undefined): { w: number; h: number } {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio ?? '')
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1, h: 1 }
}

function fitSize(
  w: number,
  h: number,
  longSide: number,
  downOnly = false,
): { width: number; height: number } {
  const k = downOnly ? Math.min(1, longSide / Math.max(w, h)) : longSide / Math.max(w, h)
  return { width: Math.max(16, Math.round(w * k)), height: Math.max(16, Math.round(h * k)) }
}

function dataUrlBytes(url: unknown): Uint8Array | undefined {
  if (typeof url !== 'string') return undefined
  const m = /^data:[^;,]+;base64,(.*)$/s.exec(url)
  return m ? new Uint8Array(Buffer.from(m[1]!, 'base64')) : undefined
}

const SHEET_HINT = /设定图|三视图|多视图|角色设定|参考图板|turnaround|character sheet|sheet/i

/**
 * 本地模拟服务商：按真实协议应答，生成占位内容。**只监听回环地址。**
 * 它是开发 / 演示工具——本地服务通过正常的服务商配置去调它，中间没有任何特殊分支。
 */
export async function startMockProviders(options: StartOptions = {}): Promise<MockProviders> {
  const host = '127.0.0.1'
  const config: MockConfig = {
    ...DEFAULT_CONFIG,
    ...options.config,
    rules: [...(options.config?.rules ?? [])],
  }
  const faults = new FaultEngine(() => config)
  const memory = new LlmMemory()
  const log = options.log
  const requests: RequestLogEntry[] = []
  const counts: Record<MockKind, number> = { llm: 0, image: 0, video: 0, tts: 0 }
  const tasks = new Map<string, VideoTask>()
  const media: { env?: Promise<MediaEnv | undefined> } = {}
  let imageCounter = 0
  let taskCounter = 0

  const app = new Hono()

  // 只接受回环名字的 Host（这是个本地开发工具，不该被别的机器或网页碰到）。
  app.use('*', async (c, next) => {
    const h = (c.req.header('host') ?? '').toLowerCase().replace(/:\d+$/, '')
    if (!LOOPBACK.has(h) && !h.endsWith('.localhost')) {
      return c.json({ error: { message: 'mock providers only answer on loopback' } }, 403)
    }
    await next()
  })

  const record = (c: Context, entry: Omit<RequestLogEntry, 'at' | 'method' | 'path'>) => {
    const e: RequestLogEntry = { at: Date.now(), method: c.req.method, path: c.req.path, ...entry }
    requests.push(e)
    if (requests.length > 2000) requests.splice(0, requests.length - 2000)
    log?.(
      `${e.method} ${e.path}${e.kind ? ` [${e.kind}]` : ''}${e.fault ? ` ⚡${e.fault}` : ''} → ${e.status}`,
    )
  }

  const delay = async () => {
    const wait = config.latencyMs + (config.jitterMs > 0 ? Math.random() * config.jitterMs : 0)
    if (wait > 0) await sleep(wait)
  }

  /** 提交类请求的公共入口：计数、延迟、决定故障、处理“提交阶段”的故障。返回 Response 表示已经处理完。 */
  const gate = async (
    c: Context,
    kind: MockKind,
    bodyText: string,
  ): Promise<{ fault?: FaultKind; early?: Response }> => {
    counts[kind]++
    await delay()
    const fault = faults.decide(kind, bodyText, c.req.header('x-mock-fault') ?? undefined)
    const fail = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      record(c, { kind, fault, status })
      return { fault, early: c.json(body as never, status as never, headers) }
    }
    switch (fault) {
      case 'rate_limit':
        return fail(
          429,
          { error: { message: '请求过于频繁，请稍后再试（模拟限流）', code: 'rate_limit' } },
          { 'Retry-After': '5' },
        )
      case 'reject':
        return fail(400, {
          error: {
            message: '请求被拒绝（模拟）：参数不合法或内容未通过审核',
            code: 'invalid_request',
          },
        })
      case 'server_error':
        return fail(500, { error: { message: '服务内部错误（模拟）' } })
      case 'drop_connection': {
        const incoming = (c.env as { incoming?: IncomingMessage }).incoming
        incoming?.socket.destroy()
        record(c, { kind, fault, status: 0 })
        return { fault, early: new Response(null, { status: 499 }) }
      }
      case 'bad_output':
        if (kind === 'llm') return { fault } // 由 LLM 路由自己回一段不是 JSON 的话
        record(c, { kind, fault, status: 200 })
        return {
          fault,
          early: new Response('<html>gateway ok</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
        }
      case 'upstream_failed':
        if (kind === 'video') return { fault } // 视频：提交成功，轮询时报失败
        return fail(422, {
          error: { message: '生成失败（模拟）：内容未通过审核', code: 'generation_failed' },
        })
      default:
        return { fault }
    }
  }

  const bodyOf = async (c: Context): Promise<{ text: string; json: Record<string, unknown> }> => {
    const text = await c.req.text()
    try {
      const json = JSON.parse(text) as unknown
      return {
        text,
        json: json && typeof json === 'object' ? (json as Record<string, unknown>) : {},
      }
    } catch {
      return { text, json: {} }
    }
  }

  /** 同一个处理函数挂在 `/x` 和 `/v1/x` 两个地址上（真实服务商的 baseUrl 有的带 /v1，有的不带）。 */
  const both = (
    method: 'get' | 'post',
    path: string,
    handler: (c: Context) => Promise<Response> | Response,
  ) => {
    app[method](path, handler)
    app[method](`/v1${path}`, handler)
  }

  // --- 大模型对话（OpenAI 兼容，流式）---
  both('post', '/chat/completions', async (c) => {
    const { text, json } = await bodyOf(c)
    const g = await gate(c, 'llm', text)
    if (g.early) return g.early
    const messages = (Array.isArray(json.messages) ? json.messages : []) as ChatMessage[]
    const flat = messages.map((m) => ({
      role: String(m.role),
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }))
    const task = detectTask(flat)
    let reply: string
    if (g.fault === 'bad_output') reply = '抱歉，这次我没法按要求输出（模拟的坏输出）。'
    else if (task) reply = JSON.stringify(answer(task, flat, memory))
    else reply = '（这是模拟服务商的回复：它只认识流水线里的几个步骤。）'
    const model = typeof json.model === 'string' ? json.model : 'mock-llm'
    const usage = {
      prompt_tokens: Math.ceil(text.length / 2),
      completion_tokens: Math.ceil(reply.length / 1.5),
      total_tokens: 0,
    }
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens
    record(c, { kind: 'llm', fault: g.fault, status: 200 })
    if (json.stream === false) {
      return c.json({
        id: 'mock-chatcmpl',
        object: 'chat.completion',
        model,
        choices: [
          { index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' },
        ],
        usage,
      })
    }
    const enc = new TextEncoder()
    const chars = [...reply]
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
        try {
          for (let i = 0; i < chars.length; i += 8) {
            if (i > 0 && config.streamChunkMs > 0) await sleep(config.streamChunkMs)
            send({
              id: 'mock-chatcmpl',
              object: 'chat.completion.chunk',
              model,
              choices: [
                {
                  index: 0,
                  delta: { content: chars.slice(i, i + 8).join('') },
                  finish_reason: null,
                },
              ],
            })
          }
          send({
            id: 'mock-chatcmpl',
            object: 'chat.completion.chunk',
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage,
          })
          controller.enqueue(enc.encode('data: [DONE]\n\n'))
        } finally {
          controller.close()
        }
      },
    })
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  })

  // 测试连接用的模型列表
  const modelList = (c: Context) => {
    record(c, { status: 200 })
    return c.json({
      object: 'list',
      data: [
        'deepseek-chat',
        'gemini-2.5-flash-image',
        'doubao-seedream-5-0-260128',
        'tts-1',
        'mock-llm',
      ].map((id) => ({ id, object: 'model' })),
      models: [{ name: 'models/gemini-2.5-flash-image' }],
    })
  }
  both('get', '/models', modelList)
  app.get('/v1beta/models', modelList)

  // --- 图片 ---
  const imageResponse = (
    c: Context,
    prompt: string,
    size: { width: number; height: number },
    fault?: FaultKind,
  ) => {
    const n = ++imageCounter
    const png = placeholderPng({
      ...size,
      seed: `${prompt}#${n}`,
      kind: SHEET_HINT.test(prompt) ? 'sheet' : 'shot',
      serial: n,
      code: hash32(prompt).toString(16).slice(0, 4).toUpperCase(),
    })
    record(c, { kind: 'image', fault, status: 200 })
    return png
  }

  app.post('/v1beta/models/:action', async (c) => {
    const { text, json } = await bodyOf(c)
    const g = await gate(c, 'image', text)
    if (g.early) return g.early
    const parts =
      (json.contents as Array<{ parts?: Array<{ text?: string }> }> | undefined)?.[0]?.parts ?? []
    const prompt = parts.map((p) => p.text ?? '').join('\n')
    const ratio = (json.generationConfig as { imageConfig?: { aspectRatio?: string } } | undefined)
      ?.imageConfig?.aspectRatio
    const { w, h } = parseRatio(ratio)
    const png = imageResponse(c, prompt, fitSize(w, h, 768), g.fault)
    return c.json({
      candidates: [
        {
          content: {
            parts: [
              {
                inline_data: { mime_type: 'image/png', data: Buffer.from(png).toString('base64') },
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    })
  })

  both('post', '/images/generations', async (c) => {
    const { text, json } = await bodyOf(c)
    const g = await gate(c, 'image', text)
    if (g.early) return g.early
    const m = /^(\d+)x(\d+)$/.exec(String(json.size ?? ''))
    const size = m ? fitSize(Number(m[1]), Number(m[2]), 1024, true) : { width: 768, height: 768 }
    const png = imageResponse(c, String(json.prompt ?? ''), size, g.fault)
    return c.json({
      created: Math.floor(Date.now() / 1000),
      data: [{ b64_json: Buffer.from(png).toString('base64') }],
    })
  })

  // --- 图生视频（异步任务 + 轮询）---
  const ensureMedia = (): Promise<MediaEnv | undefined> => (media.env ??= locateMedia())

  const submitVideo = async (
    input: { image?: Uint8Array; durationSec: number; withAudio: boolean },
    fault?: FaultKind,
  ) => {
    const env = await ensureMedia()
    const id = `mock-task-${++taskCounter}`
    const task: VideoTask = { id, createdAt: Date.now(), fault, polls: 0 }
    tasks.set(id, task)
    if (!env) {
      task.failed = '模拟服务商需要 ffmpeg 来生成占位视频，但在本机没找到'
    } else {
      const size = (input.image && pngSize(input.image)) ?? { width: 360, height: 640 }
      const k = 480 / Math.max(size.width, size.height)
      task.bytes = renderPlaceholderVideo(env, {
        image: input.image,
        durationSec: input.durationSec,
        width: Math.round(size.width * Math.min(1, k)),
        height: Math.round(size.height * Math.min(1, k)),
        withAudio: input.withAudio,
      })
      task.bytes.catch(() => {}) // 失败在轮询时报告
    }
    return task
  }

  /** 视频任务当前该报告的状态。 */
  const taskStatus = async (
    task: VideoTask,
  ): Promise<'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'POLL_ERROR'> => {
    task.polls++
    const elapsed = Date.now() - task.createdAt
    if (task.fault === 'poll_error') return 'POLL_ERROR'
    if (task.failed) return 'FAILED'
    const queued = task.fault === 'slow_queue' ? config.slowQueueMs : 0
    if (elapsed < queued) return 'PENDING'
    const run = elapsed - queued
    if (task.fault === 'upstream_failed') {
      if (run < config.videoMs * 0.5) return run < config.videoMs * 0.2 ? 'PENDING' : 'RUNNING'
      return 'FAILED'
    }
    if (run < config.videoMs * 0.4) return 'PENDING'
    if (run < config.videoMs) return 'RUNNING'
    try {
      await task.bytes
    } catch (err) {
      task.failed = `占位视频生成失败：${err instanceof Error ? err.message : String(err)}`
      return 'FAILED'
    }
    return 'SUCCEEDED'
  }
  const FAIL_MESSAGE = '生成失败（模拟）：内容未通过审核'
  const mediaUrl = (c: Context, id: string) => `${new URL(c.req.url).origin}/media/${id}.mp4`

  app.post('/aliyun/api/v1/services/aigc/video-generation/video-synthesis', async (c) => {
    const { text, json } = await bodyOf(c)
    const g = await gate(c, 'video', text)
    if (g.early) return g.early
    const input = (json.input ?? {}) as { img_url?: unknown }
    const params = (json.parameters ?? {}) as { duration?: number }
    const task = await submitVideo(
      {
        image: dataUrlBytes(input.img_url),
        durationSec: Number(params.duration ?? 5),
        withAudio: false,
      },
      g.fault,
    )
    record(c, { kind: 'video', fault: g.fault, status: 200 })
    return c.json({ request_id: 'mock', output: { task_id: task.id, task_status: 'PENDING' } })
  })

  app.get('/aliyun/api/v1/tasks/:id', async (c) => {
    const task = tasks.get(c.req.param('id'))
    if (!task) return c.json({ output: { task_status: 'UNKNOWN', message: 'no such task' } }, 404)
    const status = await taskStatus(task)
    record(c, { kind: 'video', fault: task.fault, status: status === 'POLL_ERROR' ? 502 : 200 })
    if (status === 'POLL_ERROR') return c.json({ error: { message: 'Bad Gateway（模拟）' } }, 502)
    if (status === 'SUCCEEDED')
      return c.json({
        output: { task_id: task.id, task_status: 'SUCCEEDED', video_url: mediaUrl(c, task.id) },
      })
    if (status === 'FAILED')
      return c.json({
        output: { task_id: task.id, task_status: 'FAILED', message: task.failed ?? FAIL_MESSAGE },
      })
    return c.json({ output: { task_id: task.id, task_status: status } })
  })

  app.post('/volcengine/api/v3/contents/generations/tasks', async (c) => {
    const { text, json } = await bodyOf(c)
    const g = await gate(c, 'video', text)
    if (g.early) return g.early
    const content = (Array.isArray(json.content) ? json.content : []) as Array<{
      type?: string
      image_url?: { url?: unknown }
    }>
    const image = dataUrlBytes(content.find((x) => x.type === 'image_url')?.image_url?.url)
    const task = await submitVideo(
      { image, durationSec: Number(json.duration ?? 5), withAudio: json.generate_audio === true },
      g.fault,
    )
    record(c, { kind: 'video', fault: g.fault, status: 200 })
    return c.json({ id: task.id })
  })

  app.get('/volcengine/api/v3/contents/generations/tasks/:id', async (c) => {
    const task = tasks.get(c.req.param('id'))
    if (!task) return c.json({ error: { message: 'no such task' } }, 404)
    const status = await taskStatus(task)
    record(c, { kind: 'video', fault: task.fault, status: status === 'POLL_ERROR' ? 502 : 200 })
    if (status === 'POLL_ERROR') return c.json({ error: { message: 'Bad Gateway（模拟）' } }, 502)
    if (status === 'SUCCEEDED')
      return c.json({
        id: task.id,
        status: 'succeeded',
        content: { video_url: mediaUrl(c, task.id) },
      })
    if (status === 'FAILED')
      return c.json({
        id: task.id,
        status: 'failed',
        error: { message: task.failed ?? FAIL_MESSAGE },
      })
    return c.json({ id: task.id, status: status === 'RUNNING' ? 'running' : 'queued' })
  })

  app.get('/media/:file', async (c) => {
    const id = c.req.param('file').replace(/\.mp4$/, '')
    const task = tasks.get(id)
    if (!task || task.fault === 'download_error' || !task.bytes) {
      record(c, { kind: 'video', fault: task?.fault, status: 404 })
      return c.json({ error: { message: 'not found（模拟）' } }, 404)
    }
    const bytes = await task.bytes
    record(c, { kind: 'video', fault: task.fault, status: 200 })
    return new Response(Buffer.from(bytes), {
      headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.byteLength) },
    })
  })

  // --- 配音 ---
  both('post', '/audio/speech', async (c) => {
    const { text, json } = await bodyOf(c)
    const g = await gate(c, 'tts', text)
    if (g.early) return g.early
    const wav = placeholderWav(
      String(json.input ?? ''),
      typeof json.speed === 'number' ? json.speed : 1,
    )
    record(c, { kind: 'tts', fault: g.fault, status: 200 })
    return new Response(Buffer.from(wav), {
      headers: { 'content-type': 'audio/wav', 'content-length': String(wav.byteLength) },
    })
  })

  // --- 控制面（演练界面状态用）---
  app.get('/__mock/state', (c) =>
    c.json({ config, counts, tasks: tasks.size, faults: FAULT_KINDS }),
  )
  app.put('/__mock/config', async (c) => {
    const patch = (await c.req.json()) as Partial<MockConfig>
    Object.assign(config, patch)
    if (patch.seed !== undefined) faults.reseed(patch.seed)
    return c.json({ config })
  })
  app.post('/__mock/rules', async (c) => {
    const rule = (await c.req.json()) as FaultRule
    if (!(FAULT_KINDS as readonly string[]).includes(rule.fault))
      return c.json({ error: { message: `unknown fault ${String(rule.fault)}` } }, 400)
    config.rules.push(rule)
    return c.json({ rules: config.rules })
  })
  app.delete('/__mock/rules', (c) => {
    config.rules.length = 0
    return c.json({ rules: config.rules })
  })
  app.post('/__mock/heal', (c) => {
    for (const t of tasks.values()) t.fault = undefined
    return c.json({ ok: true })
  })
  app.post('/__mock/reset', (c) => {
    faults.reset()
    tasks.clear()
    for (const k of Object.keys(counts) as MockKind[]) counts[k] = 0
    requests.length = 0
    return c.json({ ok: true })
  })
  app.get('/__mock/requests', (c) =>
    c.json({ items: requests.slice(-Number(c.req.query('limit') ?? 100)) }),
  )

  const server = createAdaptorServer({ fetch: app.fetch }) as Server
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://${host}:${port}`,
    host,
    port,
    config,
    configure: (patch) => {
      Object.assign(config, patch)
      if (patch.seed !== undefined) faults.reseed(patch.seed)
    },
    addRule: (rule) => void config.rules.push(rule),
    clearRules: () => void (config.rules.length = 0),
    heal: () => {
      for (const t of tasks.values()) t.fault = undefined
    },
    requests,
    counts: () => ({ ...counts }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
