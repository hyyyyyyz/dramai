/**
 * OpenAI 兼容 chat completions 协议子集类型。
 * 只覆盖 dramai 实际用到的字段，保持精简。
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
  /**
   * 字符串：传统单段文本。
   * 数组：multimodal（含 image_url 等）。
   */
  content: string | ChatContentPart[]
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  topP?: number
  maxTokens?: number
  /** 强制 JSON 输出。OpenAI 协议字段名 response_format。 */
  jsonMode?: boolean
  /** 让上层中断进行中的请求。 */
  signal?: AbortSignal
}

export interface ChatChunk {
  /** 本次增量的纯文本 — 大多数场景只需要这一段。 */
  delta: string
  /** 累计已收到的文本（方便流式 UI 渲染）。 */
  accumulated: string
  /** OpenAI: stop / length / content_filter / tool_calls / null。 */
  finishReason?: string | null
  /** 包装的原始 chunk，便于罕见场景下取扩展字段。 */
  raw?: unknown
}

export interface ChatResult {
  text: string
  finishReason?: string | null
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
}
