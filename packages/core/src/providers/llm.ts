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
import { parseSseJson } from '../util/sse.ts'

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
  for await (const frame of parseSseJson(body)) {
    usage = extractUsage(frame.data) ?? usage
    const { delta, finishReason: fr } = extractContentDelta(frame.data)
    if (fr !== undefined) finishReason = fr
    if (!delta) continue
    accumulated += delta
    yield { delta, accumulated, finishReason: fr }
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

/** 按协议选文本流。 */
export function streamText(
  protocol: ProtocolId,
  auth: AuthContext,
  input: ChatInput,
  deps: LlmCallDeps = {},
): AsyncGenerator<ChatChunk, ChatResult, void> {
  return protocol === 'openai-responses'
    ? streamResponses(auth, input, deps)
    : streamChat(auth, input, deps)
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
