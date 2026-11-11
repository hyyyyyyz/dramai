/**
 * 容错 JSON 解析：LLM 的输出常带代码围栏、前后多余文字。
 * 先整段解析，再抽取首个平衡的 {...} / [...]（识别字符串内的括号）。解析不了返回 undefined。
 */
export function parseJsonLoose(raw: string): unknown {
  const text = stripFence(raw).trim()
  if (!text) return undefined
  const whole = tryParse(text)
  if (whole !== undefined) return whole
  for (const open of ['{', '['] as const) {
    const slice = balancedSlice(text, open)
    if (slice) {
      const parsed = tryParse(slice)
      if (parsed !== undefined) return parsed
    }
  }
  return undefined
}

export function stripFence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced) return fenced[1]
  const open = /```(?:json)?\s*([\s\S]*)$/i.exec(text)
  return open ? open[1] : text
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function balancedSlice(text: string, open: '{' | '['): string | null {
  const close = open === '{' ? '}' : ']'
  const start = text.indexOf(open)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
