import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

async function boot() {
  const seen: Array<{ url: string; headers: Record<string, string> }> = []
  const h = await startServer({
    startWorker: false,
    executor: {
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push({ url, headers: { ...(init?.headers as Record<string, string>) } })
        const json = (b: unknown) =>
          new Response(JSON.stringify(b), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        if (url.startsWith('https://api.anthropic.com/v1/models'))
          return json({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }] })
        if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models'))
          return json({
            models: [
              { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
            ],
          })
        if (url.endsWith('/models')) return json({ data: [{ id: 'qwen3' }] })
        return new Response('{}', { status: 404 })
      }) as never,
    },
  })
  return { h, seen }
}

describe('extra request headers reach the connection test and the model list', () => {
  const extra = {
    'anthropic-workspace-id': 'wrkspc_01ABC',
    Cookie: 'sid=evil',
    'Content-Length': '1',
    Authorization: 'Bearer evil',
  }

  it('Anthropic: both requests carry the workspace header; the protection list still holds', async () => {
    const { h, seen } = await boot()
    const p = await h.client.call('providers.fromPreset', {
      body: { presetId: 'anthropic-messages', apiKey: 'sk-ant-1234567890' },
    })
    await h.client.call('providers.update', {
      params: { providerId: p.id },
      body: { dialect: { extraHeaders: extra } },
    })
    expect(await h.client.call('providers.test', { params: { providerId: p.id } })).toMatchObject({
      outcome: 'ok',
    })
    await h.client.call('providers.models', { params: { providerId: p.id } })
    const calls = seen.filter((s) => s.url.startsWith('https://api.anthropic.com/v1/models'))
    expect(calls).toHaveLength(2)
    for (const c of calls) {
      expect(c.headers['anthropic-workspace-id']).toBe('wrkspc_01ABC')
      expect(c.headers['x-api-key']).toBe('sk-ant-1234567890')
      expect(c.headers.Authorization).not.toBe('Bearer evil')
      const names = Object.keys(c.headers).map((k) => k.toLowerCase())
      expect(names).not.toContain('cookie')
      expect(names).not.toContain('content-length')
    }
  })

  it('Gemini and OpenAI-compatible providers too', async () => {
    const { h, seen } = await boot()
    for (const [presetId, apiKey] of [
      ['gemini-generate-content', 'AIza-key-1234567890'],
      ['ollama-local', undefined],
    ] as const) {
      const p = await h.client.call('providers.fromPreset', {
        body: { presetId, ...(apiKey ? { apiKey } : {}) },
      })
      await h.client.call('providers.update', {
        params: { providerId: p.id },
        body: { dialect: { extraHeaders: { 'X-Project': presetId } } },
      })
      seen.length = 0
      await h.client.call('providers.test', { params: { providerId: p.id } })
      await h.client.call('providers.models', { params: { providerId: p.id } })
      expect(seen, presetId).toHaveLength(2)
      for (const c of seen) expect(c.headers['X-Project'], presetId).toBe(presetId)
    }
  })
})
