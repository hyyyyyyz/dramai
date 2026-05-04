import type { Provider } from '@/types/domain'
import type { ChatChunk, ChatRequest, ChatResult } from '@/core/llm/types'
import { extractContentDelta, parseOpenAISseStream } from '@/core/llm/sse'

export class LLMRequestError extends Error {
  readonly status?: number
  readonly body?: string

  constructor(message: string, status?: number, body?: string) {
    super(message)
    this.name = 'LLMRequestError'
    this.status = status
    this.body = body
  }
}

/**
 * OpenAI 兼容 chat completions 客户端。
 * 用 provider 信息 + ChatRequest 调用 `${baseUrl}/chat/completions`，
 * 返回流式 AsyncIterable。
 */
export async function* streamChat(
  provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>,
  request: ChatRequest,
): AsyncGenerator<ChatChunk, ChatResult, void> {
  const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model: request.model || provider.model,
    messages: request.messages,
    stream: true,
  }
  if (request.temperature !== undefined) body.temperature = request.temperature
  if (request.topP !== undefined) body.top_p = request.topP
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
  if (request.jsonMode) body.response_format = { type: 'json_object' }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: request.signal,
  })

  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 400)
    } catch {
      // ignore
    }
    throw new LLMRequestError(
      `LLM 请求失败：HTTP ${res.status}${detail ? ` · ${detail}` : ''}`,
      res.status,
      detail,
    )
  }
  if (!res.body) {
    throw new LLMRequestError('LLM 响应为空（无 body 流）')
  }

  let accumulated = ''
  let finalFinishReason: string | null | undefined

  for await (const frame of parseOpenAISseStream(res.body)) {
    const { delta, finishReason } = extractContentDelta(frame.data)
    if (finishReason !== undefined) finalFinishReason = finishReason
    if (!delta) continue
    accumulated += delta
    yield { delta, accumulated, finishReason, raw: frame.data }
  }

  return {
    text: accumulated,
    finishReason: finalFinishReason ?? 'stop',
  }
}

/**
 * 一次性收集流式输出（便于测试与不需要增量渲染的调用方）。
 */
export async function chatOnce(
  provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>,
  request: ChatRequest,
): Promise<ChatResult> {
  const iterator = streamChat(provider, request)
  let text = ''
  let finishReason: string | null | undefined
  while (true) {
    const next = await iterator.next()
    if (next.done) {
      const result = next.value
      return {
        text: result?.text ?? text,
        finishReason: result?.finishReason ?? finishReason ?? 'stop',
      }
    }
    text = next.value.accumulated
    finishReason = next.value.finishReason
  }
}
