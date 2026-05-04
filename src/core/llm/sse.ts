/**
 * 把 OpenAI 兼容 chat completions 的 SSE 字节流变成
 * 解析后的 JSON 数据帧的 AsyncIterable。
 *
 * SSE 协议要点（W3C EventSource）：
 *   - 事件之间以一个或多个空行（"\n\n"）分隔。
 *   - 每行以字段名开头，例如 "data: ..."；以 ":" 开头的行是注释（保活），跳过。
 *   - 同一事件可由多条 "data:" 累积成一行（用 "\n" 拼接）。
 *   - OpenAI chat 流以 "data: [DONE]" 终止。
 *
 * 调用方传入 `fetch` 得到的 ReadableStream<Uint8Array>。
 */

export interface SseFrame {
  /** 已经 JSON.parse 的 OpenAI chunk；[DONE] 不会被 yield 出来。 */
  data: unknown
}

export async function* parseOpenAISseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame, void, void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')

  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // 按 SSE 事件分隔（CRLF 与 LF 都允许）
      let eventBoundary: number
      while ((eventBoundary = findEventBoundary(buffer)) !== -1) {
        const rawEvent = buffer.slice(0, eventBoundary)
        buffer = buffer.slice(eventBoundary).replace(/^(\r?\n){1,2}/, '')

        const dataPayload = collectDataField(rawEvent)
        if (dataPayload === null) continue
        if (dataPayload === '[DONE]') return

        try {
          yield { data: JSON.parse(dataPayload) }
        } catch {
          // 非 JSON（多见于错误页 / 中转代理调试输出），跳过
        }
      }
    }

    // 残留 buffer 可能是最后一个未以空行结尾的事件
    const tail = buffer.trim()
    if (tail) {
      const dataPayload = collectDataField(tail)
      if (dataPayload && dataPayload !== '[DONE]') {
        try {
          yield { data: JSON.parse(dataPayload) }
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    // 消费者提前 break / abort 时也要主动取消，避免 underlying response body
    // 一直挂着不被 GC（Chromium 上会持续吃 socket 与内存）。
    try {
      await reader.cancel()
    } catch {
      /* already released or cancelled */
    }
    reader.releaseLock()
  }
}

function findEventBoundary(buffer: string): number {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1) return crlf
  if (crlf === -1) return lf
  return Math.min(lf, crlf)
}

/** 把一个 SSE 事件块里的 data 字段拼接成完整 payload。 */
function collectDataField(rawEvent: string): string | null {
  const lines = rawEvent.split(/\r?\n/)
  const dataChunks: string[] = []
  for (const rawLine of lines) {
    if (!rawLine || rawLine.startsWith(':')) continue
    const colonIdx = rawLine.indexOf(':')
    const field = colonIdx === -1 ? rawLine : rawLine.slice(0, colonIdx)
    if (field !== 'data') continue
    let value = colonIdx === -1 ? '' : rawLine.slice(colonIdx + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    dataChunks.push(value)
  }
  if (dataChunks.length === 0) return null
  return dataChunks.join('\n')
}

/**
 * 从 OpenAI chunk 里抽取 delta 文本。容忍 OpenAI 标准与一些常见兼容
 * 服务（Anthropic 风格、Gemini OpenAI-compat）的字段差异。
 */
export function extractContentDelta(chunk: unknown): {
  delta: string
  finishReason?: string | null
} {
  if (!chunk || typeof chunk !== 'object') return { delta: '' }
  const choices = (chunk as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return { delta: '' }
  const first = choices[0] as Record<string, unknown>
  const delta =
    (first.delta as Record<string, unknown> | undefined) ??
    (first.message as Record<string, unknown> | undefined)
  let text = ''
  if (delta) {
    const v = delta.content
    if (typeof v === 'string') {
      text = v
    } else if (Array.isArray(v)) {
      // multimodal 风格：[{type:'text', text:'...'}]
      for (const part of v) {
        if (
          part &&
          typeof part === 'object' &&
          (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string'
        ) {
          text += (part as { text: string }).text
        }
      }
    }
  }
  const finishReason =
    typeof first.finish_reason === 'string' || first.finish_reason === null
      ? (first.finish_reason as string | null)
      : undefined
  return { delta: text, finishReason }
}
