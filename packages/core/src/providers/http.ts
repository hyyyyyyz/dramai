import type {
  AuthContext,
  BinaryImage,
  GenerateParse,
  HttpRequestSpec,
  RawResponse,
} from './types.ts'

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

/** `code` 是成功码：数字 0 和所有 2xx；字符串 `""`、`"0"`、`"2xx"`、`"success"`、`"ok"`（大小写、首尾空白不敏感）。 */
function isSuccessCode(code: unknown): boolean {
  if (typeof code === 'number') return code === 0 || (code >= 200 && code < 300)
  if (typeof code === 'string') {
    const c = code.trim()
    return c === '' || c === '0' || /^2\d\d$/.test(c) || /^(success|ok)$/i.test(c)
  }
  return true
}

/** `code` 字段是否带着实际内容（数字，或非空字符串）；`null`、`undefined`、布尔、对象都不算。 */
function hasCode(code: unknown): boolean {
  return typeof code === 'number' || (typeof code === 'string' && code.trim() !== '')
}

/**
 * 轮询响应里**明确的业务错误**（没有任务状态时用）：`{ code: 非成功码, message }`、`{ output: { code, message } }`
 * 或 `{ error: 非空字符串 | 有内容的对象 }`。读不出就返回 undefined（调用方才可以按"状态未知，继续等"处理）。
 *
 * 判定要保守，只在能确认是错误时才算错误：
 * - 成功码（0、所有 2xx、`"success"`、`"ok"` 等，见 `isSuccessCode`）不算错误，`{ code: 200, data: {...} }` 这类
 *   成功封装里状态在嵌套对象时，仍按"状态未知，继续等"处理；
 * - `error` 是空字符串或空对象不算错误；对象要有 `message` / `msg`，或非成功码的 `code` 才算。
 *
 * 为什么要有它：状态未知一律当"排队中"会把鉴权失败、任务不存在这类错误响应变成"一直在排队"，
 * 要等到轮询超时（约 10 分钟）才报错，用户看到的是"超时"而不是真正的原因。
 */
export function bodyError(json: unknown): string | undefined {
  const obj = asRecord(json)
  if (!obj) return undefined
  const fromCode = (o: Record<string, unknown> | undefined): string | undefined => {
    if (!o || isSuccessCode(o.code)) return undefined
    return str(o.message) ?? str(o.msg) ?? `上游返回错误码 ${String(o.code)}`
  }
  const fromErrorField = (err: unknown): string | undefined => {
    if (typeof err === 'string') return err.trim() ? err : undefined
    const e = asRecord(err)
    if (!e) return undefined
    const message = str(e.message) ?? str(e.msg)
    if (message) return message
    return hasCode(e.code) && !isSuccessCode(e.code) ? '上游返回错误' : undefined
  }
  return fromCode(obj) ?? fromCode(asRecord(obj.output)) ?? fromErrorField(obj.error)
}

/**
 * 同步生图协议共用：响应必须是 JSON 对象，不是就给出统一的失败结果（`<who>返回的不是 JSON`）。
 * 用法：`const r = jsonObjectOrFail(raw, '百炼'); if (!r.ok) return r.result`。
 */
export function jsonObjectOrFail(
  raw: RawResponse,
  who: string,
):
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; result: Extract<GenerateParse, { status: 'failed' }> } {
  const json = asRecord(raw.json)
  return json
    ? { ok: true, json }
    : { ok: false, result: { status: 'failed', message: `${who}返回的不是 JSON` } }
}
