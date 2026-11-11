import { ProviderError } from './errors.ts'
import type { ExecutorDeps } from './executor.ts'
import { buildChatRequest, extractContentDelta, extractUsage } from './protocols/openai-chat.ts'
import type { ChatInput, ChatResult } from './protocols/openai-chat.ts'
import type { AuthContext } from './types.ts'
import { parseSseJson } from '../util/sse.ts'

export interface ChatChunk {
  /** 本次增量。 */
  delta: string
  /** 累计已收到的文本。 */
  accumulated: string
  finishReason?: string | null
}

/**
 * OpenAI 兼容 chat completions，流式。返回值（generator 的 return）是最终结果。
 * 流式 LLM 请求发出后若失败，不属于"付费图/视频任务"的提交语义，按普通错误处理。
 */
export async function* streamChat(
  auth: AuthContext,
  input: ChatInput,
  deps: ExecutorDeps & { signal?: AbortSignal } = {},
): AsyncGenerator<ChatChunk, ChatResult, void> {
  const spec = buildChatRequest(auth, { ...input, stream: true })
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
    throw new ProviderError(
      'http',
      `LLM 请求失败：HTTP ${res.status}${detail ? ` · ${detail}` : ''}`,
      {
        status: res.status,
        body: detail,
      },
    )
  }
  if (!res.body) throw new ProviderError('parse', 'LLM 响应为空（无 body 流）')

  let accumulated = ''
  let finishReason: string | null | undefined
  let usage: ChatResult['usage']
  for await (const frame of parseSseJson(res.body)) {
    usage = extractUsage(frame.data) ?? usage
    const { delta, finishReason: fr } = extractContentDelta(frame.data)
    if (fr !== undefined) finishReason = fr
    if (!delta) continue
    accumulated += delta
    yield { delta, accumulated, finishReason: fr }
  }
  return { text: accumulated, finishReason: finishReason ?? 'stop', usage }
}

/** 一次性收集流式输出。 */
export async function chatOnce(
  auth: AuthContext,
  input: ChatInput,
  deps: ExecutorDeps & { signal?: AbortSignal } = {},
): Promise<ChatResult> {
  const it = streamChat(auth, input, deps)
  while (true) {
    const next = await it.next()
    if (next.done) return next.value
  }
}
