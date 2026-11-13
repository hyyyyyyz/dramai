import type { ProviderDialectDto } from '@dramai/api'
import type { ProtocolId } from './protocols'

export type MaxTokensField = NonNullable<ProviderDialectDto['maxTokensField']>
export type JsonMode = NonNullable<ProviderDialectDto['jsonMode']>

/**
 * Which dialect options a protocol's request builder actually reads (packages/core/src/providers/protocols/*):
 * - openai-chat: extra body (not model, messages, stream), output length field, JSON mode, extra headers;
 * - anthropic-messages: extra body (not model, messages, stream) and extra headers;
 * - gemini-chat: extra body (not contents) and extra headers;
 * - openai-responses: extra headers only.
 * Other protocols read none of them, so they get no advanced settings.
 */
export interface DialectSupport {
  extraBody: boolean
  maxTokensField: boolean
  jsonMode: boolean
  extraHeaders: boolean
  /** Body fields the extra body can never override. */
  protectedBody: readonly string[]
}

const CHAT_BODY = ['model', 'messages', 'stream'] as const

const SUPPORT: Partial<Record<ProtocolId, DialectSupport>> = {
  'openai-chat': {
    extraBody: true,
    maxTokensField: true,
    jsonMode: true,
    extraHeaders: true,
    protectedBody: CHAT_BODY,
  },
  'anthropic-messages': {
    extraBody: true,
    maxTokensField: false,
    jsonMode: false,
    extraHeaders: true,
    protectedBody: CHAT_BODY,
  },
  'gemini-chat': {
    extraBody: true,
    maxTokensField: false,
    jsonMode: false,
    extraHeaders: true,
    protectedBody: ['contents'],
  },
  'openai-responses': {
    extraBody: false,
    maxTokensField: false,
    jsonMode: false,
    extraHeaders: true,
    protectedBody: [],
  },
}

export const dialectSupport = (protocol: ProtocolId): DialectSupport | undefined =>
  SUPPORT[protocol]

export type ExtraBodyParse =
  | { ok: true; value: Record<string, unknown> | undefined }
  | { ok: false; kind: 'invalid' | 'notObject' }

/** The extra request body as typed: empty means none; anything else must be a JSON object. */
export function parseExtraBody(text: string): ExtraBodyParse {
  if (text.trim() === '') return { ok: true, value: undefined }
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return { ok: false, kind: 'invalid' }
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v))
    return { ok: false, kind: 'notObject' }
  return {
    ok: true,
    value: Object.keys(v).length === 0 ? undefined : (v as Record<string, unknown>),
  }
}

export const formatExtraBody = (d?: ProviderDialectDto): string =>
  d?.extraBody && Object.keys(d.extraBody).length > 0 ? JSON.stringify(d.extraBody, null, 2) : ''

export interface HeaderRow {
  name: string
  value: string
}

/** Header names the server manages and silently ignores overrides of (case-insensitive). */
export const PROTECTED_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'x-key',
  'api-key',
  'content-type',
  'anthropic-version',
])

export type HeaderProblem = {
  index: number
  kind: 'name' | 'protected' | 'duplicate' | 'value' | 'empty'
}

/** What is wrong with the extra-header rows (rows left completely blank are ignored). */
export function headerProblems(rows: readonly HeaderRow[]): HeaderProblem[] {
  const out: HeaderProblem[] = []
  const seen = new Set<string>()
  rows.forEach((r, index) => {
    const name = r.name.trim()
    if (name === '' && r.value.trim() === '') return
    if (!/^[A-Za-z0-9-]+$/.test(name)) return void out.push({ index, kind: 'name' })
    const key = name.toLowerCase()
    if (PROTECTED_HEADERS.has(key)) return void out.push({ index, kind: 'protected' })
    if (seen.has(key)) return void out.push({ index, kind: 'duplicate' })
    seen.add(key)
    if (/[\r\n]/.test(r.value)) return void out.push({ index, kind: 'value' })
    if (r.value.trim() === '') out.push({ index, kind: 'empty' })
  })
  return out
}

export interface DialectDraft {
  extraBody: string
  maxTokensField: MaxTokensField | ''
  jsonMode: JsonMode | ''
  headers: HeaderRow[]
}

export const draftOf = (d?: ProviderDialectDto): DialectDraft => ({
  extraBody: formatExtraBody(d),
  maxTokensField: d?.maxTokensField ?? '',
  jsonMode: d?.jsonMode ?? '',
  headers: Object.entries(d?.extraHeaders ?? {}).map(([name, value]) => ({ name, value })),
})

/** Can this draft be saved? JSON and header rows that are wrong block saving (only for what the protocol reads). */
export function draftValid(draft: DialectDraft, support: DialectSupport | undefined): boolean {
  if (!support) return true
  if (support.extraBody && !parseExtraBody(draft.extraBody).ok) return false
  if (support.extraHeaders && headerProblems(draft.headers).length > 0) return false
  return true
}

/**
 * The dialect to send for a draft: only the fields the protocol reads, and only the ones that are set.
 * Undefined when the draft cannot be saved.
 */
export function dialectOf(
  draft: DialectDraft,
  support: DialectSupport | undefined,
): ProviderDialectDto | undefined {
  if (!support || !draftValid(draft, support)) return undefined
  const body = support.extraBody ? parseExtraBody(draft.extraBody) : undefined
  const headers = support.extraHeaders
    ? Object.fromEntries(
        draft.headers.filter((h) => h.name.trim() !== '').map((h) => [h.name.trim(), h.value]),
      )
    : {}
  return {
    ...(body?.ok && body.value ? { extraBody: body.value } : {}),
    ...(support.maxTokensField && draft.maxTokensField
      ? { maxTokensField: draft.maxTokensField }
      : {}),
    ...(support.jsonMode && draft.jsonMode ? { jsonMode: draft.jsonMode } : {}),
    ...(Object.keys(headers).length > 0 ? { extraHeaders: headers } : {}),
  }
}

/** Only the saved fields this protocol reads, so a leftover from another protocol is not counted as a difference. */
function relevant(d: ProviderDialectDto | undefined, s: DialectSupport): ProviderDialectDto {
  return {
    ...(s.extraBody && d?.extraBody && Object.keys(d.extraBody).length
      ? { extraBody: d.extraBody }
      : {}),
    ...(s.maxTokensField && d?.maxTokensField ? { maxTokensField: d.maxTokensField } : {}),
    ...(s.jsonMode && d?.jsonMode ? { jsonMode: d.jsonMode } : {}),
    ...(s.extraHeaders && d?.extraHeaders && Object.keys(d.extraHeaders).length
      ? { extraHeaders: d.extraHeaders }
      : {}),
  }
}

/** Has the draft changed from what is saved? Compares parsed values, so reformatting the JSON is not a change. */
export function dialectChanged(
  draft: DialectDraft,
  saved: ProviderDialectDto | undefined,
  support: DialectSupport | undefined,
): boolean {
  if (!support) return false
  const now = dialectOf(draft, support)
  if (!now) return true // unparsable input is a change (it is shown as an error and blocks saving)
  return JSON.stringify(sorted(now)) !== JSON.stringify(sorted(relevant(saved, support)))
}

function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted)
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sorted(x)]),
    )
  return v
}
