/**
 * Server-Sent Events 解析（W3C EventSource 规则的子集）。
 *
 * - 事件以空行分隔，LF / CRLF / CR 都接受；
 * - 以 ":" 开头的行是注释（保活），跳过；
 * - 同一事件的多条 `data:` 用 "\n" 拼接；
 * - OpenAI chat 流以 `data: [DONE]` 结束。
 *
 * 输入是 fetch 得到的 `ReadableStream<Uint8Array>`；多字节字符被切在两个 chunk 之间也能正确解码。
 */

export interface SseFrame {
  /** 事件名（`event:` 字段），没有则 undefined。 */
  event?: string
  /** 已 JSON.parse 的数据；`[DONE]` 不会被 yield。 */
  data: unknown
}

export async function* parseSseJson(
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
      // 统一换行，方便按 "\n\n" 切事件。末尾孤立的 "\r" 可能是 CRLF 的前半，留到下一个 chunk。
      let normalized = buffer.replace(/\r\n/g, '\n')
      let carry = ''
      if (normalized.endsWith('\r')) {
        carry = '\r'
        normalized = normalized.slice(0, -1)
      }
      normalized = normalized.replace(/\r/g, '\n')
      const parts = normalized.split('\n\n')
      buffer = parts.pop()! + carry
      for (const rawEvent of parts) {
        const parsed = readEvent(rawEvent)
        if (!parsed) continue
        if (parsed.payload === '[DONE]') return
        const json = tryJson(parsed.payload)
        if (json.ok) yield { event: parsed.event, data: json.value }
      }
    }
    buffer += decoder.decode()
    const tail = buffer.replace(/\r\n?/g, '\n').trim()
    if (tail) {
      const parsed = readEvent(tail)
      if (parsed && parsed.payload !== '[DONE]') {
        const json = tryJson(parsed.payload)
        if (json.ok) yield { event: parsed.event, data: json.value }
      }
    }
  } finally {
    // 消费者提前 break / abort 时也要主动取消，避免底层 body 一直挂着。
    // 不 await：tee 出来的流在另一支也取消之前 cancel() 不会 resolve，等它会把消费者挂住。
    reader.cancel().catch(() => {})
    try {
      reader.releaseLock()
    } catch {
      /* already released */
    }
  }
}

function readEvent(raw: string): { event?: string; payload: string } | null {
  let event: string | undefined
  const data: string[] = []
  for (const line of raw.split('\n')) {
    if (!line || line.startsWith(':')) continue
    const idx = line.indexOf(':')
    const field = idx === -1 ? line : line.slice(0, idx)
    let value = idx === -1 ? '' : line.slice(idx + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
  }
  if (data.length === 0) return null
  return { event, payload: data.join('\n') }
}

function tryJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    // 非 JSON（多见于错误页 / 中转代理的调试输出），跳过
    return { ok: false }
  }
}
