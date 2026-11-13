import { deepMerge, mergeHeaders } from '../../util/merge.ts'
import { ProviderError } from '../errors.ts'
import { asRecord, joinUrl, jsonPost, str } from '../http.ts'
import type { AuthContext, HttpRequestSpec } from '../types.ts'
import type { ChatContentPart, ChatMessage, ChatResult } from './openai-chat.ts'
import type { DroppedParam } from './openai-responses.ts'

/**
 * Anthropic Messages API（文本，流式）：`POST {baseUrl}/v1/messages`，baseUrl 缺省 `https://api.anthropic.com`。
 * 依据（官方文档，2026-11 核对）：platform.claude.com/docs/en/api/overview、…/build-with-claude/streaming、
 * …/api/errors、…/api/models/list。
 *
 * - 鉴权：官方总览页以 `Authorization: Bearer` 为主、`x-api-key` 为仍支持的旧方式，示例两种都有，所以两个头都发
 *   （同一个 Key，不冲突）；`anthropic-version` 必带（官方示例 `2026-10-21`）。
 * - `max_tokens` 必填；Claude 5.x 默认自适应思考，思考 token 计入 `max_tokens`，所以缺省给得很宽。
 * - 系统消息放顶层 `system`，`messages` 里只有 user / assistant。
 * - **没有 JSON 输出模式**（只有 `output_config.format` 的 json_schema，我们没有 schema）：要 JSON 时靠提示词和
 *   外层的"解析—校验—重试"（`llmJson`）。
 * - 不传 temperature / top_p：官方说 Claude 4.7+ 与 5.x 低于 1 的 temperature、非 0.99 的 top_p 会 400。丢弃并记录。
 * - 流式：`message_start`（`usage.input_tokens`）→ `content_block_*`（文本在 `text_delta`；`thinking_delta` 等忽略）
 *   → `message_delta`（`stop_reason`，`usage.output_tokens` 是累计值）→ `message_stop`；中间有 `ping`；
 *   流中途可能出现 `error` 事件（如 `overloaded_error`）。**不以 `[DONE]` 结束**，以 `message_stop` 为成功。
 */

export const ANTHROPIC_VERSION = '2026-10-21'
/** 默认输出上限：给思考留足余量（官方：Claude 5.x 最大输出 128K）。服务商配置的额外请求体里可以覆盖。 */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 32_000

export interface MessagesInput {
  messages: ChatMessage[]
  temperature?: number
  topP?: number
  maxTokens?: number
  jsonMode?: boolean
}

const PROTECTED = ['model', 'messages', 'stream'] as const

export function anthropicHeaders(apiKey: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    ...(apiKey ? { 'x-api-key': apiKey, Authorization: `Bearer ${apiKey}` } : {}),
  }
}

type AnthropicBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string }
    }

function imageBlock(url: string): AnthropicBlock {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  if (m) return { type: 'image', source: { type: 'base64', media_type: m[1]!, data: m[2]! } }
  return { type: 'image', source: { type: 'url', url } }
}

function toBlocks(content: string | ChatContentPart[]): string | AnthropicBlock[] {
  if (typeof content === 'string') return content
  return content.map(
    (p): AnthropicBlock =>
      p.type === 'text' ? { type: 'text', text: p.text } : imageBlock(p.image_url.url),
  )
}

const textOf = (content: string | ChatContentPart[]): string =>
  typeof content === 'string'
    ? content
    : content.map((p) => (p.type === 'text' ? p.text : '')).join('')

export function buildMessagesRequest(
  auth: AuthContext,
  input: MessagesInput,
): { spec: HttpRequestSpec; dropped: DroppedParam[] } {
  const dropped: DroppedParam[] = []
  const system = input.messages
    .filter((m) => m.role === 'system')
    .map((m) => textOf(m.content).trim())
    .filter(Boolean)
  const messages = input.messages
    .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
    .map((m) => ({ role: m.role, content: toBlocks(m.content) }))
  const body: Record<string, unknown> = {
    model: auth.model,
    max_tokens: input.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
    messages,
    stream: true,
  }
  if (system.length > 0) body.system = system.join('\n\n')
  if (input.temperature !== undefined) {
    dropped.push({ param: 'temperature', reason: 'Claude 4.7+ / 5.x 不接受低于 1 的 temperature' })
  }
  if (input.topP !== undefined) {
    dropped.push({ param: 'top_p', reason: 'Claude 4.7+ / 5.x 不接受非 0.99 的 top_p' })
  }
  const url = joinUrl(auth.baseUrl, '/v1/messages')
  return {
    spec: jsonPost(
      url,
      deepMerge(body, auth.dialect?.extraBody, PROTECTED),
      mergeHeaders(anthropicHeaders(auth.apiKey), auth.dialect?.extraHeaders),
    ),
    dropped,
  }
}

// === 流式事件 ===

export type MessagesEvent =
  | { kind: 'start'; inputTokens?: number }
  | { kind: 'delta'; text: string }
  | { kind: 'stop_info'; stopReason?: string; outputTokens?: number }
  | { kind: 'completed' }
  | { kind: 'error'; type?: string; message?: string }
  | { kind: 'ignored' }

const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

export function parseMessagesEvent(data: unknown, eventName?: string): MessagesEvent {
  const obj = asRecord(data)
  const type = str(obj?.type) ?? eventName
  switch (type) {
    case 'message_start':
      return {
        kind: 'start',
        inputTokens: num(asRecord(asRecord(obj?.message)?.usage)?.input_tokens),
      }
    case 'content_block_delta': {
      const d = asRecord(obj?.delta)
      // 只取文本；thinking_delta / signature_delta / input_json_delta 都忽略
      return d?.type === 'text_delta' && typeof d.text === 'string' && d.text
        ? { kind: 'delta', text: d.text }
        : { kind: 'ignored' }
    }
    case 'message_delta':
      return {
        kind: 'stop_info',
        stopReason: str(asRecord(obj?.delta)?.stop_reason),
        outputTokens: num(asRecord(obj?.usage)?.output_tokens),
      }
    case 'message_stop':
      return { kind: 'completed' }
    case 'error': {
      const e = asRecord(obj?.error)
      return { kind: 'error', type: str(e?.type), message: str(e?.message) }
    }
    default:
      return { kind: 'ignored' }
  }
}

export const anthropicUsage = (inputTokens?: number, outputTokens?: number): ChatResult['usage'] =>
  inputTokens === undefined && outputTokens === undefined
    ? undefined
    : {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens:
          inputTokens !== undefined && outputTokens !== undefined
            ? inputTokens + outputTokens
            : undefined,
      }

// === 错误 ===

/** 官方错误类型 → HTTP 状态（errors 页）。流中途的 `error` 事件没有状态码，按类型补。 */
const STATUS_BY_TYPE: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  conflict_error: 409,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  overloaded_error: 529,
}

export function anthropicProviderError(
  error: { type?: string; message?: string; requestId?: string },
  status?: number,
): ProviderError {
  const s = status ?? (error.type ? STATUS_BY_TYPE[error.type] : undefined)
  const detail = error.message ? `：${error.message}` : ''
  const rid = error.requestId ? `（request_id ${error.requestId}）` : ''
  return new ProviderError(
    'http',
    `Anthropic 请求失败${error.type ? `（${error.type}）` : ''}${detail}${rid}`,
    {
      status: s,
      code: error.type ?? (s !== undefined ? `HTTP_${s}` : 'ANTHROPIC_FAILED'),
      body: error.message,
    },
  )
}

/** 请求被拒的响应体 `{type:'error', error:{type,message}, request_id}`。 */
export function parseMessagesErrorBody(text: string): {
  type?: string
  message?: string
  requestId?: string
} {
  try {
    const obj = asRecord(JSON.parse(text))
    const e = asRecord(obj?.error)
    return { type: str(e?.type), message: str(e?.message), requestId: str(obj?.request_id) }
  } catch {
    return { message: text.slice(0, 300) || undefined }
  }
}

// === 模型列表（GET /v1/models） ===

export function parseAnthropicModels(json: unknown): Array<{ id: string; label: string }> {
  const data = asRecord(json)?.data
  if (!Array.isArray(data)) return []
  const out: Array<{ id: string; label: string }> = []
  for (const entry of data) {
    const e = asRecord(entry)
    const id = str(e?.id)
    if (!id || e?.lifecycle === 'retired') continue
    out.push({ id, label: str(e?.display_name) ?? id })
  }
  return out
}
