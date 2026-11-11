import { createHash } from 'node:crypto'

/** 规范化 JSON：键排序，丢弃 undefined。用于生成依据摘要。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v === undefined) continue
      out[key] = sortValue(v)
    }
    return out
  }
  return value
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

export function digestOf(value: unknown): string {
  return sha256Hex(canonicalJson(value))
}
