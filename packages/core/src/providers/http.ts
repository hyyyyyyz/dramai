import type { AuthContext, BinaryImage, HttpRequestSpec } from './types.ts'

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

export function jsonHeaders(
  apiKey?: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...extra,
  }
}

export function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

export function jsonPost(
  url: string,
  value: unknown,
  headers: Record<string, string>,
): HttpRequestSpec {
  return { method: 'POST', url, headers, body: { type: 'json', value } }
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

export function toDataUrl(image: BinaryImage): string {
  return `data:${image.mime || 'image/png'};base64,${bytesToBase64(image.bytes)}`
}

/** 拆 `data:<mime>;base64,<payload>`；不是 data URL 时 mime 缺省为 image/png。 */
export function splitDataUrl(value: string): { mime: string; base64: string } {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(value)
  return m ? { mime: m[1], base64: m[2] } : { mime: 'image/png', base64: value }
}

export function joinPrompt(...parts: Array<string | undefined>): string {
  return parts
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join('. ')
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** 从响应里挑一条人能读的错误信息。 */
export function errorMessageOf(json: unknown, fallback: string): string {
  const obj = asRecord(json)
  if (!obj) return fallback
  const err = obj.error
  if (typeof err === 'string') return err
  const errObj = asRecord(err)
  if (errObj && typeof errObj.message === 'string') return errObj.message
  if (typeof obj.message === 'string') return obj.message
  return fallback
}

export type { AuthContext }
