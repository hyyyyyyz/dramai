import { deepMerge } from '../../util/merge.ts'
import { asRecord, joinUrl, jsonHeaders, jsonPost } from '../http.ts'
import type { HttpRequestSpec, AuthContext } from '../types.ts'

/**
 * OpenAI 兼容 chat completions 协议子集（只覆盖 dramai 实际用到的字段）。
 * LLM 与图像/视频不同：响应是 SSE 流，所以不套用 `MediaProtocol`，但同样是纯函数。
 */

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatTextPart {
  type: 'text'
  text: string
}
export interface ChatImageUrlPart {
  type: 'image_url'
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' }
}
export type ChatContentPart = ChatTextPart | ChatImageUrlPart

export interface ChatMessage {
  role: ChatRole
  content: string | ChatContentPart[]
}

export interface ChatInput {
  messages: ChatMessage[]
  temperature?: number
  topP?: number
  maxTokens?: number
  /** 强制 JSON 输出（response_format）。 */
  jsonMode?: boolean
  /** 默认 true。 */
  stream?: boolean
}

export interface ChatResult {
  text: string
  finishReason?: string | null
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

/** extraBody 不能覆盖的字段。 */
const CHAT_PROTECTED = ['model', 'messages', 'stream'] as const

export function buildChatRequest(auth: AuthContext, input: ChatInput): HttpRequestSpec {
  const dialect = auth.dialect
  const body: Record<string, unknown> = {
    model: auth.model,
    messages: input.messages,
    stream: input.stream ?? true,
  }
  if (input.temperature !== undefined) body.temperature = input.temperature
  if (input.topP !== undefined) body.top_p = input.topP
  // 输出长度字段名因服务商而异（OpenAI / Moonshot / MiniMax 用 max_completion_tokens，多数用 max_tokens）
  if (input.maxTokens !== undefined) body[dialect?.maxTokensField ?? 'max_tokens'] = input.maxTokens
  // 不支持 json_object 的服务商（prompt_only）：不发 response_format，靠提示词 + 解析重试
  if (input.jsonMode && dialect?.jsonMode !== 'prompt_only') {
    body.response_format = { type: 'json_object' }
  }
  return jsonPost(
    joinUrl(auth.baseUrl, '/chat/completions'),
    deepMerge(body, dialect?.extraBody, CHAT_PROTECTED),
    jsonHeaders(auth.apiKey),
  )
}

/**
 * 从一个 SSE chunk（或非流式响应）里抽取增量文本。容忍 OpenAI 标准与常见兼容服务的字段差异：
 * - `delta.content` 是字符串，或内容块数组（Mistral）——只取 `type:'text'` 的块，`thinking` 等块忽略；
 * - 思考字段（`reasoning_content`、`reasoning`、`reasoning_details`）一律不读，不会混进正文；
 * - 没有 `choices` 或 `choices` 为空的 chunk（只带 usage）返回空增量。
 */
export function extractContentDelta(chunk: unknown): {
  delta: string
  finishReason?: string | null
} {
  const obj = asRecord(chunk)
  const choices = obj?.choices
  if (!Array.isArray(choices) || choices.length === 0) return { delta: '' }
  const first = asRecord(choices[0]) ?? {}
  const delta = asRecord(first.delta) ?? asRecord(first.message)
  let text = ''
  const content = delta?.content
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    for (const part of content) {
      const p = asRecord(part)
      if (p?.type === 'text' && typeof p.text === 'string') text += p.text
    }
  }
  const fr = first.finish_reason
  const finishReason = typeof fr === 'string' || fr === null ? fr : undefined
  return { delta: text, finishReason }
}

export function extractUsage(chunk: unknown): ChatResult['usage'] | undefined {
  const usage = asRecord(asRecord(chunk)?.usage)
  if (!usage) return undefined
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined)
  return {
    promptTokens: num(usage.prompt_tokens),
    completionTokens: num(usage.completion_tokens),
    totalTokens: num(usage.total_tokens),
  }
}
