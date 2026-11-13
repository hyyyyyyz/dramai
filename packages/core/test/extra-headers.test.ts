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
      Cookie: 'sid=evil',
      HOST: 'evil.example.com',
      'Content-Length': '1',
      'Proxy-Authorization': 'Basic evil',
      'Transfer-Encoding': 'chunked',
      Connection: 'upgrade',
      'X-Ok': 'fine',
    }
    const a = buildMessagesRequest(auth(evil), { messages }).spec.headers
    expect(a['x-api-key']).toBe('sk-secret')
    expect(a.Authorization).toBe('Bearer sk-secret')
    expect(a['Content-Type']).toBe('application/json')
    expect(a['anthropic-version']).not.toBe('1999-01-01')
    expect(a['X-Ok']).toBe('fine')
    for (const k of Object.keys(a)) expect(a[k], k).not.toBe('evil')
    // transport-level and cookie headers never get through, in any letter case
    const kept = Object.keys(a).map((k) => k.toLowerCase())
    for (const banned of [
      'cookie',
      'host',
      'content-length',
      'proxy-authorization',
      'transfer-encoding',
      'connection',
    ]) {
      expect(kept, banned).not.toContain(banned)
    }
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

describe('extra request headers on media protocols (one merge point in the executor)', () => {
  const image = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

  it('submit and poll carry them (video protocol), the download does not, and the protection list holds', async () => {
    const { runGeneration } = await import('../src/providers/executor.ts')
    const { aliyunVideo } = await import('../src/providers/protocols/index.ts')
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } })
      if (url.includes('video-synthesis')) return json({ output: { task_id: 't1' } })
      if (url.includes('/tasks/')) {
        return json({
          output: { task_status: 'SUCCEEDED', video_url: 'https://cdn.example.com/v.mp4' },
        })
      }
      return new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      })
    }
    await runGeneration(
      aliyunVideo,
      auth({ 'X-Project': 'p1', Authorization: 'Bearer evil', 'Content-Length': '1' }),
      { prompt: 'p', image },
      { fetch, sleep: async () => {} },
    )
    expect(calls.map((c) => c.url.split('/').slice(-1)[0])).toEqual([
      'video-synthesis',
      't1',
      'v.mp4',
    ])
    const [submit, poll, download] = calls
    expect(submit!.headers['X-Project']).toBe('p1')
    expect(poll!.headers['X-Project']).toBe('p1')
    expect(submit!.headers.Authorization).toBe('Bearer sk-secret') // not overridable
    expect(Object.keys(submit!.headers).map((k) => k.toLowerCase())).not.toContain('content-length')
    // the result usually lives on another host: the user's headers must not go there
    expect(download!.headers).toEqual({})
  })

  it('image protocols get them too', async () => {
    const { runGeneration } = await import('../src/providers/executor.ts')
    const { openaiImages } = await import('../src/providers/protocols/index.ts')
    let seen: Record<string, string> = {}
    const fetch = async (_url: string, init?: RequestInit) => {
      seen = init?.headers as Record<string, string>
      return json({ data: [{ b64_json: Buffer.from([1, 2]).toString('base64') }] })
    }
    await runGeneration(
      openaiImages,
      auth({ 'X-Project': 'p1' }, { model: 'dall-e-3' }),
      { prompt: 'a cat' },
      { fetch },
    )
    expect(seen['X-Project']).toBe('p1')
    expect(seen.Authorization).toBe('Bearer sk-secret')
  })
})
