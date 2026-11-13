import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

interface Seen {
  url: string
  headers: Record<string, string>
  body?: Record<string, unknown>
}

async function boot() {
  const seen: Seen[] = []
  const h = await startServer({
    startWorker: false,
    executor: {
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push({
          url,
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
        })
        const json = (b: unknown) =>
          new Response(JSON.stringify(b), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        if (url.startsWith('https://api.anthropic.com/v1/models'))
          return json({
            data: [
              { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', lifecycle: 'active' },
              { id: 'old', lifecycle: 'retired' },
            ],
          })
        if (url.startsWith('https://generativelanguage.googleapis.com/v1beta/models'))
          return json({
            models: [
              {
                name: 'models/gemini-3.8-flash',
                displayName: 'Gemini 3.8 Flash',
                supportedGenerationMethods: ['generateContent'],
              },
              { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
            ],
          })
        if (url.endsWith('/models')) return json({ data: [{ id: 'qwen3' }] })
        if (url.endsWith('/chat/completions')) {
          const ev = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`
          return new Response(
            ev({ choices: [{ delta: { reasoning_content: 'hmm' } }] }) +
              ev({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] }) +
              'data: [DONE]\n\n',
            { status: 200 },
          )
        }
        return new Response('{}', { status: 404 })
      }) as never,
    },
  })
  return { h, seen }
}

const preset = (h: Awaited<ReturnType<typeof boot>>['h'], presetId: string, apiKey?: string) =>
  h.client.call('providers.fromPreset', { body: { presetId, ...(apiKey ? { apiKey } : {}) } })

describe('text presets through the API', () => {
  it('presets.list carries vendor (localized), region, dialect, placeholders, auth and verification', async () => {
    const { h } = await boot()
    const items = (await h.client.call('presets.list')).items
    const by = (id: string) => items.find((p) => p.id === id)!
    expect(by('aliyun-bailian-cn')).toMatchObject({
      vendor: { id: 'aliyun', label: '阿里云百炼' },
      region: 'cn',
      baseUrlPlaceholders: ['WorkspaceId'],
      dialect: { extraBody: { enable_thinking: false }, maxTokensField: 'max_completion_tokens' },
      verification: { status: 'documented' },
    })
    expect(by('ollama-local')).toMatchObject({ auth: { type: 'none' }, region: 'local' })
    expect(items.filter((p) => p.verification.status === 'tested')).toHaveLength(4)
    expect(items.every((p) => p.vendor.id && p.vendor.label)).toBe(true)
    const en = ((await (await h.raw('/api/presets?lang=en')).json()) as { items: typeof items })
      .items
    expect(en.find((p) => p.id === 'aliyun-bailian-cn')!.vendor.label).toBe(
      'Alibaba Cloud Model Studio',
    )
    expect(en.find((p) => p.id === 'anthropic-messages')!.label).toBe('Anthropic Claude (API key)')
  })

  it('a preset-made provider carries its dialect; the user can see and change it; documented ones are never auto-selected', async () => {
    const { h } = await boot()
    const p = await preset(h, 'volcengine-ark', 'ark-key-1234567890')
    expect(p.dialect).toEqual({
      maxTokensField: 'max_completion_tokens',
      extraBody: { thinking: { type: 'disabled' } },
    })
    expect((await h.client.call('settings.get')).activeProviders.llm).toBeUndefined()
    const edited = await h.client.call('providers.update', {
      params: { providerId: p.id },
      body: { dialect: { extraBody: { thinking: { type: 'auto' } } } },
    })
    expect(edited.dialect).toEqual({ extraBody: { thinking: { type: 'auto' } } })
    expect(
      (await h.client.call('providers.get', { params: { providerId: p.id } })).dialect,
    ).toEqual({ extraBody: { thinking: { type: 'auto' } } })
  })

  it('the dialect reaches the real request: thinking switched off in the body, the length field renamed, reasoning text dropped', async () => {
    const { h, seen } = await boot()
    const p = await preset(h, 'aliyun-bailian-cn', 'sk-qwen-1234567890')
    await h.server.ctx.store.providers.put({
      ...(await h.server.ctx.store.providers.get(p.id))!,
      baseUrl: 'https://ws1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    })
    await h.server.ctx.settings.patchActive('llm', p.id)
    const out = await h.server.ctx.deps.llm.complete({
      task: 't',
      messages: [{ role: 'user', content: 'u' }],
      jsonMode: true,
    })
    expect(out.text).toBe('hi')
    const call = seen.find((s) => s.url.endsWith('/chat/completions'))!
    expect(call.body).toMatchObject({
      enable_thinking: false,
      stream: true,
      response_format: { type: 'json_object' },
    })
    expect(call.headers.Authorization).toBe('Bearer sk-qwen-1234567890')
  })

  it('model lists: OpenAI-compatible, Anthropic (retired models dropped), Gemini (generateContent only); image/video/speech have none', async () => {
    const { h, seen } = await boot()
    const ollama = await preset(h, 'ollama-local')
    expect(
      (await h.client.call('providers.models', { params: { providerId: ollama.id } })).items,
    ).toEqual([{ id: 'qwen3', label: 'qwen3' }])
    expect(seen.at(-1)!.headers.Authorization).toBeUndefined() // no authentication: nothing is sent

    const claude = await preset(h, 'anthropic-messages', 'sk-ant-1234567890')
    expect(
      (await h.client.call('providers.models', { params: { providerId: claude.id } })).items,
    ).toEqual([{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }])
    const a = seen.at(-1)!
    expect(a.url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(a.headers).toMatchObject({
      'x-api-key': 'sk-ant-1234567890',
      'anthropic-version': expect.any(String),
    })

    const gem = await preset(h, 'gemini-generate-content', 'AIza-key-1234567890')
    expect(
      (await h.client.call('providers.models', { params: { providerId: gem.id } })).items,
    ).toEqual([{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }])
    expect(seen.at(-1)!.headers['x-goog-api-key']).toBe('AIza-key-1234567890')
    expect(seen.at(-1)!.headers.Authorization).toBeUndefined()

    const img = await h.client.call('providers.create', {
      body: {
        label: 'i',
        kind: 'image',
        protocol: 'openai-images',
        baseUrl: 'https://x.example/v1',
        model: 'm',
        apiKey: 'k1234567890',
      },
    })
    await expect(
      h.client.call('providers.models', { params: { providerId: img.id } }),
    ).rejects.toMatchObject({ code: 'MODEL_LIST_UNSUPPORTED' })
  })

  it("connection test uses each protocol's own header and list address", async () => {
    const { h, seen } = await boot()
    const claude = await preset(h, 'anthropic-messages', 'sk-ant-1234567890')
    expect(
      await h.client.call('providers.test', { params: { providerId: claude.id } }),
    ).toMatchObject({ outcome: 'ok', modelListed: true })
    expect(seen.at(-1)!.headers['x-api-key']).toBe('sk-ant-1234567890')
    const gem = await preset(h, 'gemini-generate-content', 'AIza-key-1234567890')
    expect(await h.client.call('providers.test', { params: { providerId: gem.id } })).toMatchObject(
      { outcome: 'ok', modelListed: true },
    )
    expect(seen.at(-1)!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models')
  })
})
