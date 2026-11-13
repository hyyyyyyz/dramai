import { deepMerge } from '../../util/merge.ts'
import { ProviderError } from '../errors.ts'
import { asRecord, joinUrl, jsonPost, str } from '../http.ts'
import type { AuthContext, HttpRequestSpec } from '../types.ts'
import type { ChatContentPart, ChatMessage, ChatResult } from './openai-chat.ts'
import type { DroppedParam } from './openai-responses.ts'

/**
 * Google Gemini `generateContent`（文本，流式）：
 * `POST {baseUrl}/v1beta/models/{model}:streamGenerateContent?alt=sse`，baseUrl 缺省
 * `https://generativelanguage.googleapis.com`。主会话决定：先做 generateContent，不做 Interactions API。
 *
 * 依据（官方 API 参考 aistudio.google.com/api-reference/generate-content，2026-11 核对）：路径、`contents` /
 * `Content.parts` / `role: user|model`、`systemInstruction`（Content，只用 text）、`generationConfig.maxOutputTokens`
 * / `responseMimeType`、`Part.inlineData{mimeType,data}`、`Part.thought`（布尔，表示这是思考内容）、
 * `GenerateContentResponse.candidates[].finishReason` / `promptFeedback.blockReason` / `usageMetadata`
 * （`promptTokenCount`、`candidatesTokenCount`、`thoughtsTokenCount`、`totalTokenCount`）。
 *
 * **官方参考页没写**（所以是未验证的）：`alt=sse` 的流式格式、鉴权头（官方 Interactions 示例用 `x-goog-api-key`，
 * 这里沿用）、错误响应体。流式解析因此做了容错：响应是 SSE 就按 SSE 读；不是（没有 `alt=sse` 时服务端返回
 * JSON 数组）就把整个响应当 JSON 数组读。
 *
 * 不传 temperature / top_p：官方文档写 Gemini 3.6+ / 4 忽略它们。丢弃并记录。思考内容（`thought: true`
 * 的 part）从不并入正文。
 */

export interface GeminiInput {
  messages: ChatMessage[]
  temperature?: number
  topP?: number
  maxTokens?: number
  jsonMode?: boolean
}

const PROTECTED = ['contents'] as const

export function geminiHeaders(apiKey: string | undefined): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-goog-api-key': apiKey } : {}),
  }
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

function toParts(content: string | ChatContentPart[]): GeminiPart[] {
  if (typeof content === 'string') return [{ text: content }]
  return content.map((p): GeminiPart => {
    if (p.type === 'text') return { text: p.text }
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(p.image_url.url)
    if (!m) {
      // generateContent 的内联图片只能是 base64；网络地址要先走 Files API，这里不支持
      throw new ProviderError(
        'capability',
        'Gemini 的图片输入需要 base64（data URL），不支持直接用网络地址',
        {
          code: 'GEMINI_IMAGE_URL_UNSUPPORTED',
        },
      )
    }
    return { inlineData: { mimeType: m[1]!, data: m[2]! } }
  })
}

const textOf = (content: string | ChatContentPart[]): string =>
  typeof content === 'string'
    ? content
    : content.map((p) => (p.type === 'text' ? p.text : '')).join('')

/** 模型名可能带 `models/` 前缀（列表里是这样），路径里不要重复。 */
const shortModel = (model: string) => model.replace(/^models\//, '')

export function buildGeminiRequest(
  auth: AuthContext,
  input: GeminiInput,
): { spec: HttpRequestSpec; dropped: DroppedParam[] } {
  const dropped: DroppedParam[] = []
  const system = input.messages
    .filter((m) => m.role === 'system')
    .map((m) => textOf(m.content).trim())
    .filter(Boolean)
  const contents = input.messages
    .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toParts(m.content) }))
  const generationConfig: Record<string, unknown> = {}
  if (input.maxTokens !== undefined) generationConfig.maxOutputTokens = input.maxTokens
  if (input.jsonMode) generationConfig.responseMimeType = 'application/json'
  const body: Record<string, unknown> = { contents }
  if (system.length > 0) body.systemInstruction = { parts: [{ text: system.join('\n\n') }] }
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig
  if (input.temperature !== undefined) {
    dropped.push({ param: 'temperature', reason: 'Gemini 3.6+ / 4 忽略 temperature' })
  }
  if (input.topP !== undefined) {
    dropped.push({ param: 'topP', reason: 'Gemini 3.6+ / 4 忽略 topP' })
  }
  const url = `${joinUrl(auth.baseUrl, `/v1beta/models/${shortModel(auth.model)}:streamGenerateContent`)}?alt=sse`
  return {
    spec: jsonPost(
      url,
      deepMerge(body, auth.dialect?.extraBody, PROTECTED),
      geminiHeaders(auth.apiKey),
    ),
    dropped,
  }
}

// === 响应 ===

export type GeminiEvent =
  | { kind: 'text'; text: string }
  | { kind: 'meta'; finishReason?: string; usage?: ChatResult['usage'] }
  | { kind: 'blocked'; reason: string }
  | { kind: 'error'; code?: number; status?: string; message?: string }
  | { kind: 'ignored' }

const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

/** 一个 `GenerateContentResponse`（一个 SSE chunk）→ 事件列表（文本、结束原因 / 用量、拦截、错误）。 */
export function parseGeminiChunk(data: unknown): GeminiEvent[] {
  const obj = asRecord(data)
  const err = asRecord(obj?.error)
  if (err) {
    return [
      { kind: 'error', code: num(err.code), status: str(err.status), message: str(err.message) },
    ]
  }
  const events: GeminiEvent[] = []
  const blockReason = str(asRecord(obj?.promptFeedback)?.blockReason)
  const candidates = Array.isArray(obj?.candidates) ? obj.candidates : []
  if (blockReason && candidates.length === 0) events.push({ kind: 'blocked', reason: blockReason })
  const first = asRecord(candidates[0])
  const parts = asRecord(first?.content)?.parts
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const p = asRecord(part)
      // thought: true 的 part 是思考内容，不并入正文
      if (p && p.thought !== true && typeof p.text === 'string' && p.text) {
        events.push({ kind: 'text', text: p.text })
      }
    }
  }
  const finishReason = str(first?.finishReason)
  const meta = asRecord(obj?.usageMetadata)
  const usage = meta
    ? {
        promptTokens: num(meta.promptTokenCount),
        completionTokens: num(meta.candidatesTokenCount),
        totalTokens: num(meta.totalTokenCount),
      }
    : undefined
  if (finishReason || usage) events.push({ kind: 'meta', finishReason, usage })
  return events
}

/** 这些结束原因表示被拦截 / 不能用（官方 `finishReason` 枚举），不管有没有已生成的片段都按失败处理。 */
export const GEMINI_BLOCKED_FINISH = new Set([
  'SAFETY',
  'RECITATION',
  'LANGUAGE',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'MALFORMED_FUNCTION_CALL',
])

export function geminiProviderError(
  error: { code?: number; status?: string; message?: string },
  httpStatus?: number,
): ProviderError {
  const status = httpStatus ?? error.code
  return new ProviderError(
    'http',
    `Gemini 请求失败${error.status ? `（${error.status}）` : ''}${error.message ? `：${error.message}` : ''}`,
    {
      status,
      code: error.status ?? (status !== undefined ? `HTTP_${status}` : 'GEMINI_FAILED'),
      body: error.message,
    },
  )
}

/** 请求被拒的响应体 `{error:{code,message,status}}`。 */
export function parseGeminiErrorBody(text: string): {
  code?: number
  status?: string
  message?: string
} {
  try {
    const e = asRecord(asRecord(JSON.parse(text))?.error)
    return { code: num(e?.code), status: str(e?.status), message: str(e?.message) }
  } catch {
    return { message: text.slice(0, 300) || undefined }
  }
}

// === 模型列表（GET /v1beta/models） ===

export function parseGeminiModels(json: unknown): Array<{ id: string; label: string }> {
  const models = asRecord(json)?.models
  if (!Array.isArray(models)) return []
  const out: Array<{ id: string; label: string }> = []
  for (const entry of models) {
    const e = asRecord(entry)
    const name = str(e?.name)
    if (!name) continue
    const methods = e?.supportedGenerationMethods
    // 有方法列表时只留能 generateContent 的（排除 embedding 等）
    if (Array.isArray(methods) && !methods.includes('generateContent')) continue
    const id = shortModel(name)
    out.push({ id, label: str(e?.displayName) ?? id })
  }
  return out
}
