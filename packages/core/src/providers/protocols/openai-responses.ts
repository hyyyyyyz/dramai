import { asRecord, joinUrl, jsonHeaders, jsonPost, str } from '../http.ts'
import { ProviderError } from '../errors.ts'
import type { AuthContext, HttpRequestSpec } from '../types.ts'
import type { ChatContentPart, ChatMessage, ChatResult } from './openai-chat.ts'

/**
 * OpenAI Responses API（文本，流式）：`POST {baseUrl}/responses`。
 *
 * 两种鉴权都走同一个接口：API Key，或 OpenAI 账号登录得到的访问令牌（"Sign in with ChatGPT" 的
 * ChatGPT 用量，公开的 https://api.openai.com/v1）。登录方式有额外要求，全部由这里处理，上层不感知
 * （依据：https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations 和
 * models-and-inference 页）：
 *
 * - 必须 `store: false`、`stream: true`；
 * - 不接受 `{type:'message', role:'system'}` 的输入项 → 系统提示放进 `instructions`；
 * - 不接受 `temperature`、`top_p`、`max_output_tokens`、`metadata` 等字段 → 丢弃，并把丢弃了什么
 *   返回给调用方（`dropped`），由它记录；
 * - 只有收到 `response.completed` 才算成功；`response.failed`（含用量超限，`error.code` 为
 *   `subscription_sharing_usage_limit_exceeded` 等，可能在流中途出现）、`response.incomplete`、`error`、
 *   以及没有收到完成事件就断开，都是失败。
 *
 * API Key 方式下同样用 `store: false`（不让上游保存用户的稿件）和 `instructions`，只是 `temperature`、
 * `top_p`、`max_output_tokens` 在调用方传了的时候照常发送。
 */

export interface ResponsesInput {
  messages: ChatMessage[]
  temperature?: number
  topP?: number
  maxTokens?: number
  /** 强制 JSON 输出：`text.format = { type: 'json_object' }`。 */
  jsonMode?: boolean
}

export interface DroppedParam {
  param: string
  reason: string
}

export interface BuiltResponsesRequest {
  spec: HttpRequestSpec
  /** 因为这个鉴权方式不支持而没发出去的参数（要记录）。 */
  dropped: DroppedParam[]
}

const LOGIN_UNSUPPORTED = 'ChatGPT 账号登录的 Responses 接口不接受这个字段'

type InputPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: string }
  | { type: 'output_text'; text: string }

function toParts(role: 'user' | 'assistant', content: string | ChatContentPart[]): InputPart[] {
  if (typeof content === 'string') {
    return [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: content }]
  }
  return content.map((p): InputPart => {
    if (p.type === 'text') {
      return { type: role === 'assistant' ? 'output_text' : 'input_text', text: p.text }
    }
    return {
      type: 'input_image',
      image_url: p.image_url.url,
      ...(p.image_url.detail ? { detail: p.image_url.detail } : {}),
    }
  })
}

const textOf = (content: string | ChatContentPart[]): string =>
  typeof content === 'string'
    ? content
    : content.map((p) => (p.type === 'text' ? p.text : '')).join('')

export function buildResponsesRequest(
  auth: AuthContext,
  input: ResponsesInput,
): BuiltResponsesRequest {
  const login = auth.method === 'account_login'
  const dropped: DroppedParam[] = []

  // 系统消息 → instructions（任何时候都不发 system 角色的输入项）
  const system = input.messages
    .filter((m) => m.role === 'system')
    .map((m) => textOf(m.content).trim())
    .filter(Boolean)
  const items = input.messages
    .filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => m.role !== 'system')
    // 纯文本用字符串内容（和官方示例一致）；带图片才用分段。
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : toParts(m.role, m.content),
    }))

  const body: Record<string, unknown> = {
    model: auth.model,
    input: items,
    stream: true,
    store: false,
  }
  if (system.length > 0) body.instructions = system.join('\n\n')
  if (input.jsonMode) body.text = { format: { type: 'json_object' } }

  const optional: Array<[string, string, number | undefined]> = [
    ['temperature', 'temperature', input.temperature],
    ['top_p', 'topP', input.topP],
    ['max_output_tokens', 'maxTokens', input.maxTokens],
  ]
  for (const [field, , value] of optional) {
    if (value === undefined) continue
    if (login) dropped.push({ param: field, reason: LOGIN_UNSUPPORTED })
    else body[field] = value
  }
  return {
    spec: jsonPost(joinUrl(auth.baseUrl, '/responses'), body, jsonHeaders(auth.apiKey)),
    dropped,
  }
}

// === 响应事件 ===

export type ResponsesEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'completed'; usage?: ChatResult['usage'] }
  | { kind: 'failed'; error: ResponsesError }
  | { kind: 'incomplete'; reason?: string }
  | { kind: 'ignored' }

export interface ResponsesError {
  code?: string
  message?: string
  param?: string
  status?: number
}

const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

/** 一个 SSE 数据对象 → 事件。认 `type` 字段（事件名可能缺省），不认识的事件忽略。 */
export function parseResponsesEvent(data: unknown, eventName?: string): ResponsesEvent {
  const obj = asRecord(data)
  const type = str(obj?.type) ?? eventName
  switch (type) {
    case 'response.output_text.delta': {
      const delta = obj?.delta
      return typeof delta === 'string' && delta
        ? { kind: 'delta', text: delta }
        : { kind: 'ignored' }
    }
    case 'response.completed': {
      const usage = asRecord(asRecord(obj?.response)?.usage)
      return {
        kind: 'completed',
        usage: usage
          ? {
              promptTokens: num(usage.input_tokens),
              completionTokens: num(usage.output_tokens),
              totalTokens: num(usage.total_tokens),
            }
          : undefined,
      }
    }
    case 'response.failed': {
      const err = asRecord(asRecord(obj?.response)?.error)
      return {
        kind: 'failed',
        error: { code: str(err?.code) ?? 'unknown_error', message: str(err?.message) },
      }
    }
    case 'response.incomplete':
      return {
        kind: 'incomplete',
        reason: str(asRecord(asRecord(obj?.response)?.incomplete_details)?.reason),
      }
    case 'error':
      return {
        kind: 'failed',
        error: {
          code: str(obj?.code) ?? str(asRecord(obj?.error)?.code) ?? 'unknown_error',
          message: str(obj?.message) ?? str(asRecord(obj?.error)?.message),
          param: str(obj?.param),
        },
      }
    default:
      return { kind: 'ignored' }
  }
}

// === 错误码 ===

interface KnownError {
  status: number
  message: string
}

/** 官方文档 errors-and-recovery 里的结构化错误码 → HTTP 状态和给用户看的话。 */
const KNOWN_ERRORS: Record<string, KnownError> = {
  subscription_sharing_user_not_eligible: {
    status: 403,
    message: '这个 ChatGPT 账号不能把订阅用量给第三方应用使用。请换一个账号，或改用 API Key',
  },
  subscription_sharing_usage_limit_exceeded: {
    status: 429,
    message:
      'ChatGPT 用量已达上限（可能是套餐的限额，也可能是这个应用的限额）。请到 ChatGPT 设置 → 用量查看，暂停新请求',
  },
  subscription_sharing_usage_unavailable: {
    status: 503,
    message: 'ChatGPT 用量服务暂时不可用，凭据仍然有效，请稍后重试',
  },
  subscription_sharing_unsupported_capability: {
    status: 400,
    message: '这次请求用到了账号登录不支持的能力，需要去掉对应的输入或工具后再试',
  },
  subscription_sharing_route_not_supported: {
    status: 403,
    message: '账号登录只支持 POST /v1/responses，请检查接口地址',
  },
  subscription_sharing_invalid_user: {
    status: 401,
    message: '登录身份没有被接受。确认令牌已被撤销或无法刷新后再重新登录',
  },
  chatpass_v2_scope_not_authorized: {
    status: 403,
    message: '这个登录没有授予使用 ChatGPT 用量的范围，请检查授权配置，不要重试',
  },
  chatpass_v2_invalid_authorization_context: {
    status: 403,
    message: '登录的授权上下文无效，请检查授权配置，不要重试',
  },
  subscription_sharing_user_unavailable: {
    status: 503,
    message: 'ChatGPT 账号服务暂时不可用，凭据仍然有效，请稍后重试',
  },
}

export const isKnownResponsesErrorCode = (code: string | undefined): boolean =>
  code !== undefined && code in KNOWN_ERRORS

/** 把上游的错误（流里的 `response.failed` / `error`，或请求被拒的响应体）变成 `ProviderError`。 */
export function responsesProviderError(
  error: ResponsesError,
  options: { status?: number; where: 'stream' | 'http' },
): ProviderError {
  const known = error.code ? KNOWN_ERRORS[error.code] : undefined
  const status = options.status ?? known?.status
  const base =
    known?.message ??
    (error.message ? `Responses 请求失败：${error.message}` : 'Responses 请求失败')
  return new ProviderError('http', `${base}${error.code ? `（${error.code}）` : ''}`, {
    status,
    code: error.code ?? (status !== undefined ? `HTTP_${status}` : 'RESPONSES_FAILED'),
    body: error.message,
  })
}

/** 从请求被拒的响应体（`{error:{code,message,param}}` 或 `{detail}`）里读错误。 */
export function parseResponsesErrorBody(text: string): ResponsesError {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { message: text.slice(0, 300) || undefined }
  }
  const obj = asRecord(json)
  const err = asRecord(obj?.error)
  return {
    code: str(err?.code),
    param: str(err?.param),
    message: str(err?.message) ?? str(obj?.detail) ?? str(obj?.message),
  }
}

// === 模型列表 ===

export interface ListedModel {
  /** 传给 `model` 的值。 */
  id: string
  label: string
}

/**
 * `GET {baseUrl}/models`。
 * - 账号登录：返回 `{ models: [{ slug, display_name, visibility }] }`，只留 `visibility == "list"`，保持服务端顺序。
 * - API Key：标准的 `{ data: [{ id }] }`。
 */
export function parseResponsesModels(json: unknown): ListedModel[] {
  const obj = asRecord(json)
  const out: ListedModel[] = []
  if (Array.isArray(obj?.models)) {
    for (const entry of obj.models) {
      const e = asRecord(entry)
      const slug = str(e?.slug)
      if (!slug || e?.visibility !== 'list') continue
      out.push({ id: slug, label: str(e?.display_name) ?? slug })
    }
  } else if (Array.isArray(obj?.data)) {
    for (const entry of obj.data) {
      const id = str(asRecord(entry)?.id)
      if (id) out.push({ id, label: id })
    }
  }
  return out
}
