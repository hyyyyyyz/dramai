import { ProviderError } from './errors.ts'
import type { ExecutorDeps } from './executor.ts'
import { buildChatRequest, extractContentDelta, extractUsage } from './protocols/openai-chat.ts'
import type { ChatInput, ChatResult } from './protocols/openai-chat.ts'
import type { AuthContext, ProtocolId } from './types.ts'
import {
  buildResponsesRequest,
  parseResponsesErrorBody,
  parseResponsesEvent,
  responsesProviderError,
} from './protocols/openai-responses.ts'
import type { DroppedParam } from './protocols/openai-responses.ts'
import {
  anthropicProviderError,
  anthropicUsage,
  buildMessagesRequest,
  parseMessagesErrorBody,
  parseMessagesEvent,
} from './protocols/anthropic-messages.ts'
import {
  buildGeminiRequest,
  GEMINI_BLOCKED_FINISH,
  geminiProviderError,
  parseGeminiChunk,
  parseGeminiErrorBody,
} from './protocols/gemini-chat.ts'
import { parseSseJson } from '../util/sse.ts'
import { ThinkTagStripper } from '../util/think-tags.ts'

export interface ChatChunk {
  /** 本次增量。 */
  delta: string
  /** 累计已收到的文本。 */
  accumulated: string
  finishReason?: string | null
}

/** 文本调用的附加依赖：可注入 fetch、取消信号，以及"协议层丢弃了参数"的记录回调。 */
export type LlmCallDeps = ExecutorDeps & {
  signal?: AbortSignal
  /** 协议层因为鉴权方式不支持而丢弃了参数时调用（只含参数名和原因，不含内容和凭据）。 */
  onDropped?: (info: { protocol: ProtocolId; dropped: DroppedParam[] }) => void
}

async function postStream(
  spec: ReturnType<typeof buildChatRequest>,
  deps: LlmCallDeps,
  describeError: (status: number, bodyText: string) => ProviderError,
  meta?: { contentType?: string },
): Promise<ReadableStream<Uint8Array>> {
  const doFetch = deps.fetch ?? fetch
  let res: Response
  try {
    res = await doFetch(spec.url, {
      method: 'POST',
      headers: spec.headers,
      body: JSON.stringify(spec.body?.type === 'json' ? spec.body.value : undefined),
      signal: deps.signal,
    })
  } catch (err) {
    if (deps.signal?.aborted) throw new ProviderError('cancelled', '已取消', { code: 'CANCELLED' })
    throw new ProviderError('network', `网络错误：${err instanceof Error ? err.message : err}`, {
      cause: err,
      code: 'NETWORK',
    })
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 400)
    } catch {
      /* ignore */
    }
    throw describeError(res.status, detail)
  }
  if (!res.body) throw new ProviderError('parse', 'LLM 响应为空（无 body 流）')
  if (meta) meta.contentType = res.headers.get('content-type') ?? ''
  return res.body
}

/**
 * OpenAI 兼容 chat completions，流式。返回值（generator 的 return）是最终结果。
 * 流式 LLM 请求发出后若失败，不属于"付费图/视频任务"的提交语义，按普通错误处理。
 */
export async function* streamChat(
  auth: AuthContext,
  input: ChatInput,
  deps: LlmCallDeps = {},
): AsyncGenerator<ChatChunk, ChatResult, void> {
  const spec = buildChatRequest(auth, { ...input, stream: true })
  const body = await postStream(
    spec,
    deps,
    (status, detail) =>
      new ProviderError('http', `LLM 请求失败：HTTP ${status}${detail ? ` · ${detail}` : ''}`, {
        status,
        body: detail,
      }),
  )

  let accumulated = ''
  let finishReason: string | null | undefined
  let usage: ChatResult['usage']
  const strip = new ThinkTagStripper()
  for await (const frame of parseSseJson(body)) {
    usage = extractUsage(frame.data) ?? usage
    const { delta: raw, finishReason: fr } = extractContentDelta(frame.data)
    if (fr !== undefined && fr !== null) finishReason = fr
    const delta = strip.push(raw)
    if (!delta) continue
    accumulated += delta
    yield { delta, accumulated, finishReason: fr }
  }
  const tail = strip.flush()
  if (tail) {
    accumulated += tail
    yield { delta: tail, accumulated }
  }
  // 输出被长度截断而且一个字都没有：思考把额度吃光了（国内带思考的模型常见）。给出明确的错误，
  // 不要把空字符串交给后面的 JSON 解析，让用户看到一串莫名其妙的解析失败。
  if (accumulated === '' && finishReason === 'length') {
    throw new ProviderError(
      'upstream_failed',
      '模型输出被长度限制截断，而且没有正文：可能是思考用光了额度。请关闭思考（预设里的"额外请求体"）或调大输出长度',
      { code: 'EMPTY_OUTPUT_TRUNCATED' },
    )
  }
  return { text: accumulated, finishReason: finishReason ?? 'stop', usage }
}

/** OpenAI Responses，流式（见 protocols/openai-responses.ts）。只有收到 `response.completed` 才算成功。 */
export async function* streamResponses(
  auth: AuthContext,
  input: ChatInput,
  deps: LlmCallDeps = {},
): AsyncGenerator<ChatChunk, ChatResult, void> {
  const { spec, dropped } = buildResponsesRequest(auth, input)
  if (dropped.length > 0) deps.onDropped?.({ protocol: 'openai-responses', dropped })
  const body = await postStream(spec, deps, (status, detail) => {
    const parsed = parseResponsesErrorBody(detail)
    return responsesProviderError(parsed, { status, where: 'http' })
  })

  let accumulated = ''
  let usage: ChatResult['usage']
  let completed = false
  for await (const frame of parseSseJson(body)) {
    const ev = parseResponsesEvent(frame.data, frame.event)
    switch (ev.kind) {
      case 'delta':
        accumulated += ev.text
        yield { delta: ev.text, accumulated }
        break
      case 'completed':
        completed = true
        usage = ev.usage ?? usage
        break
      case 'failed':
        throw responsesProviderError(ev.error, { where: 'stream' })
      case 'incomplete':
        throw new ProviderError(
          'upstream_failed',
          `Responses 没有完整返回${ev.reason ? `（${ev.reason}）` : ''}`,
          { code: 'RESPONSE_INCOMPLETE' },
        )
      default:
        break
    }
    if (completed) break
  }
  if (!completed) {
    throw new ProviderError('parse', 'Responses 流在收到 response.completed 之前就结束了', {
      code: 'STREAM_INTERRUPTED',
    })
  }
  return { text: accumulated, finishReason: 'stop', usage }
}

const emptyTruncated = () =>
  new ProviderError(
    'upstream_failed',
    '模型输出被长度限制截断，而且没有正文：可能是思考用光了额度。请调大输出长度或关闭思考',
    { code: 'EMPTY_OUTPUT_TRUNCATED' },
  )

/** Anthropic Messages，流式（见 protocols/anthropic-messages.ts）。以 `message_stop` 为成功。 */
export async function* streamAnthropic(
  auth: AuthContext,
  input: ChatInput,
  deps: LlmCallDeps = {},
): AsyncGenerator<ChatChunk, ChatResult, void> {
  const { spec, dropped } = buildMessagesRequest(auth, input)
  if (dropped.length > 0) deps.onDropped?.({ protocol: 'anthropic-messages', dropped })
  const body = await postStream(spec, deps, (status, detail) =>
    anthropicProviderError(parseMessagesErrorBody(detail), status),
  )
  let accumulated = ''
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let stopReason: string | undefined
  let completed = false
  for await (const frame of parseSseJson(body)) {
    const ev = parseMessagesEvent(frame.data, frame.event)
    switch (ev.kind) {
      case 'start':
        inputTokens = ev.inputTokens ?? inputTokens
        break
      case 'delta':
        accumulated += ev.text
        yield { delta: ev.text, accumulated }
        break
      case 'stop_info':
        stopReason = ev.stopReason ?? stopReason
        outputTokens = ev.outputTokens ?? outputTokens // 累计值，取最后一个
        break
      case 'completed':
        completed = true
        break
      case 'error':
        throw anthropicProviderError({ type: ev.type, message: ev.message })
      default:
        break
    }
    if (completed) break
  }
  if (!completed) {
    throw new ProviderError('parse', 'Anthropic 流在收到 message_stop 之前就结束了', {
      code: 'STREAM_INTERRUPTED',
    })
  }
  if (accumulated === '' && stopReason === 'max_tokens') throw emptyTruncated()
  return {
    text: accumulated,
    finishReason: stopReason ?? 'end_turn',
    usage: anthropicUsage(inputTokens, outputTokens),
  }
}

/** Gemini generateContent，流式（见 protocols/gemini-chat.ts）。 */
export async function* streamGemini(
  auth: AuthContext,
  input: ChatInput,
  deps: LlmCallDeps = {},
): AsyncGenerator<ChatChunk, ChatResult, void> {
  const { spec, dropped } = buildGeminiRequest(auth, input)
  if (dropped.length > 0) deps.onDropped?.({ protocol: 'gemini-chat', dropped })
  const meta: { contentType?: string } = {}
  const body = await postStream(
    spec,
    deps,
    (status, detail) => geminiProviderError(parseGeminiErrorBody(detail), status),
    meta,
  )

  // 官方参考页没写 alt=sse 的格式：是 SSE 就按 SSE 读；不是（服务端返回 JSON 数组）就整个读完再解析
  async function* chunks(): AsyncGenerator<unknown, void, void> {
    if ((meta.contentType ?? '').includes('text/event-stream')) {
      for await (const frame of parseSseJson(body)) yield frame.data
      return
    }
    const text = await new Response(body).text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new ProviderError('parse', 'Gemini 响应不是 SSE 也不是 JSON', {
        code: 'GEMINI_BAD_RESPONSE',
      })
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) yield item
  }

  let accumulated = ''
  let usage: ChatResult['usage']
  let finishReason: string | undefined
  let sawFinish = false
  for await (const chunk of chunks()) {
    for (const ev of parseGeminiChunk(chunk)) {
      switch (ev.kind) {
        case 'text':
          accumulated += ev.text
          yield { delta: ev.text, accumulated }
          break
        case 'meta':
          usage = ev.usage ?? usage
          if (ev.finishReason) {
            finishReason = ev.finishReason
            sawFinish = true
            if (GEMINI_BLOCKED_FINISH.has(ev.finishReason)) {
              throw new ProviderError(
                'upstream_failed',
                `Gemini 没有返回内容（${ev.finishReason}）：被安全或内容策略拦截`,
                { code: `GEMINI_${ev.finishReason}` },
              )
            }
          }
          break
        case 'blocked':
          throw new ProviderError('upstream_failed', `Gemini 拒绝了这个提示词（${ev.reason}）`, {
            code: `GEMINI_PROMPT_${ev.reason}`,
          })
        case 'error':
          throw geminiProviderError(ev)
        default:
          break
      }
    }
  }
  // 没有结束原因就断了 = 流被中断（Gemini 没有单独的"完成"事件，最后一个 chunk 带 finishReason）
  if (!sawFinish) {
    throw new ProviderError('parse', 'Gemini 流在收到结束原因之前就结束了', {
      code: 'STREAM_INTERRUPTED',
    })
  }
  if (accumulated === '' && finishReason === 'MAX_TOKENS') throw emptyTruncated()
  return { text: accumulated, finishReason: finishReason ?? 'STOP', usage }
}

/** 按协议选文本流。 */
export function streamText(
  protocol: ProtocolId,
  auth: AuthContext,
  input: ChatInput,
  deps: LlmCallDeps = {},
): AsyncGenerator<ChatChunk, ChatResult, void> {
  switch (protocol) {
    case 'openai-responses':
      return streamResponses(auth, input, deps)
    case 'anthropic-messages':
      return streamAnthropic(auth, input, deps)
    case 'gemini-chat':
      return streamGemini(auth, input, deps)
    default:
      return streamChat(auth, input, deps)
  }
}

/** 一次性收集流式输出。 */
export async function chatOnce(
  auth: AuthContext,
  input: ChatInput,
  deps: LlmCallDeps = {},
  protocol: ProtocolId = 'openai-chat',
): Promise<ChatResult> {
  const it = streamText(protocol, auth, input, deps)
  while (true) {
    const next = await it.next()
    if (next.done) return next.value
  }
}
