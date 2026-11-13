import type { ProviderDialectDto } from '@dramai/api'

export type MaxTokensField = NonNullable<ProviderDialectDto['maxTokensField']>
export type JsonMode = NonNullable<ProviderDialectDto['jsonMode']>

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

export interface DialectDraft {
  extraBody: string
  maxTokensField: MaxTokensField | ''
  jsonMode: JsonMode | ''
}

export const draftOf = (d?: ProviderDialectDto): DialectDraft => ({
  extraBody: formatExtraBody(d),
  maxTokensField: d?.maxTokensField ?? '',
  jsonMode: d?.jsonMode ?? '',
})

/** The dialect to send for a draft (fields left at default are omitted); undefined when the draft cannot be saved. */
export function dialectOf(draft: DialectDraft): ProviderDialectDto | undefined {
  const parsed = parseExtraBody(draft.extraBody)
  if (!parsed.ok) return undefined
  return {
    ...(parsed.value ? { extraBody: parsed.value } : {}),
    ...(draft.maxTokensField ? { maxTokensField: draft.maxTokensField } : {}),
    ...(draft.jsonMode ? { jsonMode: draft.jsonMode } : {}),
  }
}

/** Has the draft changed from what is saved? Compares parsed values, so reformatting the JSON is not a change. */
export function dialectChanged(draft: DialectDraft, saved?: ProviderDialectDto): boolean {
  const now = dialectOf(draft)
  if (!now) return true // unparsable text is a change (it is shown as an error and blocks saving)
  return JSON.stringify(sorted(now)) !== JSON.stringify(sorted(saved ?? {}))
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
