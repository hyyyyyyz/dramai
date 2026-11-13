import { describe, expect, it } from 'vitest'
import { buildChatRequest } from '../src/providers/protocols/openai-chat.ts'
import { buildMessagesRequest } from '../src/providers/protocols/anthropic-messages.ts'
import { buildGeminiRequest } from '../src/providers/protocols/gemini-chat.ts'
import { buildResponsesRequest } from '../src/providers/protocols/openai-responses.ts'
import { PROVIDER_PRESETS } from '../src/providers/presets.ts'
import { mergeHeaders } from '../src/util/merge.ts'
import type { AuthContext } from '../src/providers/types.ts'

const auth = (
  extraHeaders: Record<string, string>,
  extra: Partial<AuthContext> = {},
): AuthContext => ({
  baseUrl: 'https://api.example.com',
  model: 'm',
  apiKey: 'sk-secret',
  method: 'api_key',
  dialect: { extraHeaders },
  ...extra,
})
const messages = [{ role: 'user' as const, content: 'hi' }]

describe('extra request headers', () => {
  it('Anthropic: the workspace header is sent next to the auth headers', () => {
    const { spec } = buildMessagesRequest(auth({ 'anthropic-workspace-id': 'wrkspc_01ABC' }), {
      messages,
    })
    expect(spec.headers['anthropic-workspace-id']).toBe('wrkspc_01ABC')
    expect(spec.headers['x-api-key']).toBe('sk-secret')
  })

  it('every text protocol applies them', () => {
    const extra = { 'X-Org': 'acme' }
    expect(buildChatRequest(auth(extra), { messages }).headers['X-Org']).toBe('acme')
    expect(buildResponsesRequest(auth(extra), { messages }).spec.headers['X-Org']).toBe('acme')
    expect(buildGeminiRequest(auth(extra), { messages }).spec.headers['X-Org']).toBe('acme')
    expect(buildMessagesRequest(auth(extra), { messages }).spec.headers['X-Org']).toBe('acme')
  })

  it('cannot override the auth headers, the content type or the protocol version (any letter case)', () => {
    const evil = {
      Authorization: 'Bearer evil',
      'X-API-KEY': 'evil',
      'x-goog-api-key': 'evil',
      'x-key': 'evil',
      'API-Key': 'evil',
      'content-type': 'text/plain',
      'Anthropic-Version': '1999-01-01',
      'X-Ok': 'fine',
    }
    const a = buildMessagesRequest(auth(evil), { messages }).spec.headers
    expect(a['x-api-key']).toBe('sk-secret')
    expect(a.Authorization).toBe('Bearer sk-secret')
    expect(a['Content-Type']).toBe('application/json')
    expect(a['anthropic-version']).not.toBe('1999-01-01')
    expect(a['X-Ok']).toBe('fine')
    for (const k of Object.keys(a)) expect(a[k], k).not.toBe('evil')
    const c = buildChatRequest(auth(evil), { messages }).headers
    expect(c.Authorization).toBe('Bearer sk-secret')
    expect(c['Content-Type']).toBe('application/json')
    expect(buildGeminiRequest(auth(evil), { messages }).spec.headers['x-goog-api-key']).toBe(
      'sk-secret',
    )
  })

  it('ignores malformed names and values (header injection)', () => {
    expect(
      mergeHeaders(
        { A: '1' },
        { 'bad name': 'x', 'ok-name': 'line1\r\nX-Injected: 1', good: 'v', num: 5 as never },
      ),
    ).toEqual({ A: '1', good: 'v' })
    expect(mergeHeaders({ A: '1' }, undefined)).toEqual({ A: '1' })
  })

  it('the Anthropic preset tells the user about the workspace header, in every language', () => {
    const p = PROVIDER_PRESETS.find((x) => x.id === 'anthropic-messages')!
    expect(p.knownLimitations.join('')).toContain('anthropic-workspace-id')
    expect(p.i18n!.en!.knownLimitations.join('')).toContain('anthropic-workspace-id')
    expect(p.i18n!['zh-Hant']!.knownLimitations.join('')).toContain('anthropic-workspace-id')
  })
})
