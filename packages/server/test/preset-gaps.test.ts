import { afterEach, describe, expect, it } from 'vitest'
import { createClient } from '@dramai/api'
import { PROVIDER_PRESETS } from '@dramai/core'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'

afterEach(cleanupAll)

const CJK = /[㐀-鿿]/
const as = (h: Harness, locale: string) =>
  createClient({ baseUrl: h.server.url, token: h.server.token, locale })

/** 按 URL 返回预设好的响应；没命中的当 404。 */
async function boot(routes: Record<string, () => Response> = {}) {
  const seen: string[] = []
  const h = await startServer({
    startWorker: false,
    executor: {
      fetch: (async (url: string) => {
        seen.push(url)
        for (const [prefix, make] of Object.entries(routes))
          if (url.startsWith(prefix)) return make()
        return new Response('{}', { status: 404 })
      }) as never,
    },
  })
  return { h, seen }
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('providers.fromPreset: one-step creation with baseUrl / model overrides', () => {
  it('overrides the address and the model; the rest still comes from the preset', async () => {
    const { h } = await boot()
    const p = await h.client.call('providers.fromPreset', {
      body: {
        presetId: 'aliyun-bailian-cn',
        apiKey: 'sk-123456789012',
        baseUrl: '  https://ws-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1  ',
        model: ' qwen3.5-plus ',
        label: 'Mine',
      },
    })
    expect(p).toMatchObject({
      baseUrl: 'https://ws-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.5-plus',
      label: 'Mine',
      presetId: 'aliyun-bailian-cn',
      verification: { status: 'documented' },
    })
    expect(p.dialect).toBeDefined() // the preset's dialect is kept
    // persisted, not only echoed
    expect(await h.client.call('providers.get', { params: { providerId: p.id } })).toMatchObject({
      baseUrl: p.baseUrl,
      model: 'qwen3.5-plus',
    })
  })

  it('without overrides the preset values are used (a complete preset address needs none)', async () => {
    const { h } = await boot()
    const preset = PROVIDER_PRESETS.find((x) => x.id === 'ollama-local')!
    const p = await h.client.call('providers.fromPreset', { body: { presetId: 'ollama-local' } })
    expect(p).toMatchObject({ baseUrl: preset.baseUrl, model: preset.suggestedModel })
  })

  it('refuses an address that still has a {placeholder}, with BASE_URL_PLACEHOLDER_UNFILLED and the names', async () => {
    const { h } = await boot()
    // text and image presets with {WorkspaceId}, with no override and with a half-filled one
    for (const presetId of ['aliyun-bailian-cn', 'aliyun-qwen-image-cn']) {
      await expect(
        h.client.call('providers.fromPreset', { body: { presetId, apiKey: 'sk-123456789012' } }),
        presetId,
      ).rejects.toMatchObject({
        status: 400,
        code: 'BASE_URL_PLACEHOLDER_UNFILLED',
        details: { placeholders: ['WorkspaceId'] },
      })
    }
    await expect(
      h.client.call('providers.fromPreset', {
        body: { presetId: 'ollama-local', baseUrl: 'http://{host}:11434/v1' },
      }),
    ).rejects.toMatchObject({
      code: 'BASE_URL_PLACEHOLDER_UNFILLED',
      details: { placeholders: ['host'] },
    })
    // nothing half-made is left behind
    expect((await h.client.call('providers.list')).items).toHaveLength(0)
  })

  it('validates the address: http/https only, no credentials in it, plain http only to this machine or the LAN', async () => {
    const { h } = await boot()
    const make = (baseUrl: string) =>
      h.client.call('providers.fromPreset', { body: { presetId: 'ollama-local', baseUrl } })
    for (const bad of [
      'ftp://host/v1',
      'not a url',
      'localhost:11434',
      'https://u:p@host.example/v1',
      'file:///etc/passwd',
    ]) {
      await expect(make(bad), bad).rejects.toMatchObject({ status: 400, code: 'BASE_URL_INVALID' })
    }
    for (const bad of ['http://api.example.com/v1', 'http://8.8.8.8/v1', 'http://172.32.0.1/v1']) {
      await expect(make(bad), bad).rejects.toMatchObject({ status: 400, code: 'BASE_URL_INSECURE' })
    }
    for (const ok of [
      'http://localhost:11434/v1',
      'http://127.0.0.1:1234/v1',
      'http://[::1]:8080/v1',
      'http://192.168.1.20:11434/v1',
      'http://10.0.0.5/v1',
      'http://172.16.0.9/v1',
      'http://my-box:11434/v1',
      'http://gpu.lan/v1',
      'https://api.example.com/v1',
    ]) {
      expect((await make(ok)).baseUrl, ok).toBe(ok)
    }
    expect((await h.client.call('providers.list')).items).toHaveLength(9)
  })

  it('an account-login preset pins its address: any override is BASE_URL_NOT_OVERRIDABLE, a model override is fine', async () => {
    const { h } = await boot()
    await expect(
      h.client.call('providers.fromPreset', {
        body: { presetId: 'openrouter-login', baseUrl: 'https://evil.example.com/v1' },
      }),
    ).rejects.toMatchObject({ status: 400, code: 'BASE_URL_NOT_OVERRIDABLE' })
    const p = await h.client.call('providers.fromPreset', {
      body: { presetId: 'openrouter-login', model: 'anthropic/claude-sonnet-5.5' },
    })
    expect(p).toMatchObject({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-sonnet-5.5',
    })
  })
})

describe('providers.login.logout carries the manage link (alignment check)', () => {
  it('the response contract has manageUrl; with no key there is nothing to invalidate, so no link (the signed-in case is in provider-openrouter.test.ts)', async () => {
    const { h } = await boot()
    // contract: the API route definition accepts the field
    const { routes } = await import('@dramai/api')
    const shape = (routes['providers.login.logout'].response as { shape: Record<string, unknown> })
      .shape
    expect(Object.keys(shape).sort()).toEqual(['manageUrl', 'revoked', 'status'])
    // a provider that never signed in logs out without a link (nothing to invalidate)
    const p = await h.client.call('providers.fromPreset', {
      body: { presetId: 'openrouter-login' },
    })
    const out = await h.client.call('providers.login.logout', { params: { providerId: p.id } })
    expect(out.status.state).toBe('signed_out')
    expect(out.manageUrl).toBeUndefined()
  })
})

describe('providers.test failures carry a machine-readable code', () => {
  it('Anthropic: error.type; Gemini: error.status; OpenAI-compatible: HTTP_<status>; the error string stays', async () => {
    const { h } = await boot({
      'https://api.anthropic.com/v1/models': json(401, {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      }),
      'https://generativelanguage.googleapis.com/v1beta/models': json(403, {
        error: { code: 403, status: 'PERMISSION_DENIED', message: 'API key not valid' },
      }),
      'http://localhost:11434/v1/models': json(500, { error: { message: 'boom' } }),
    })
    const test = async (presetId: string, apiKey?: string) => {
      const p = await h.client.call('providers.fromPreset', {
        body: { presetId, ...(apiKey ? { apiKey } : {}) },
      })
      return h.client.call('providers.test', { params: { providerId: p.id } })
    }
    expect(await test('anthropic-messages', 'sk-ant-1234567890')).toMatchObject({
      outcome: 'failed',
      status: 401,
      code: 'authentication_error',
      error: expect.stringContaining('HTTP 401'),
    })
    expect(await test('gemini-generate-content', 'AIza-key-1234567890')).toMatchObject({
      outcome: 'failed',
      status: 403,
      code: 'PERMISSION_DENIED',
      error: expect.stringContaining('HTTP 403'),
    })
    expect(await test('ollama-local')).toMatchObject({
      outcome: 'failed',
      status: 500,
      code: 'HTTP_500',
      error: expect.stringContaining('HTTP 500'),
    })
  })

  it('a missing sign-in is LOGIN_REQUIRED, a dead network is NETWORK — the same codes jobs fail with', async () => {
    const h = await startServer({
      startWorker: false,
      executor: {
        fetch: (async () => {
          throw new TypeError('fetch failed')
        }) as never,
      },
    })
    const login = await h.client.call('providers.fromPreset', {
      body: { presetId: 'openrouter-login' },
    })
    expect(
      await h.client.call('providers.test', { params: { providerId: login.id } }),
    ).toMatchObject({ outcome: 'failed', code: 'LOGIN_REQUIRED' })
    const local = await h.client.call('providers.fromPreset', {
      body: { presetId: 'ollama-local' },
    })
    expect(
      await h.client.call('providers.test', { params: { providerId: local.id } }),
    ).toMatchObject({ outcome: 'failed', code: 'NETWORK' })
  })
})

describe('knownLimitations follow the request language', () => {
  it('presets.list: every preset, text and image, has an English version without CJK and a Traditional one of the same length', async () => {
    const { h } = await boot()
    const zh = (await h.client.call('presets.list')).items
    const en = (await as(h, 'en').call('presets.list')).items
    const hant = (await as(h, 'zh-TW').call('presets.list')).items
    expect(en).toHaveLength(PROVIDER_PRESETS.length)
    expect(zh.some((p) => p.kind === 'image')).toBe(true)
    expect(zh.some((p) => p.kind === 'llm')).toBe(true)
    for (const p of zh) {
      const e = en.find((x) => x.id === p.id)!
      const t = hant.find((x) => x.id === p.id)!
      expect(e.knownLimitations, p.id).toHaveLength(p.knownLimitations.length)
      expect(t.knownLimitations, p.id).toHaveLength(p.knownLimitations.length)
      expect(
        e.knownLimitations.some((l) => CJK.test(l)),
        `${p.id} en limitations`,
      ).toBe(false)
      expect(CJK.test(e.label + e.notes), `${p.id} en label/notes`).toBe(false)
      if (p.knownLimitations.length > 0) expect(e.knownLimitations).not.toEqual(p.knownLimitations)
    }
  })

  it('configs made from presets (text and image) are localized when read; text the user wrote is left alone', async () => {
    const { h } = await boot()
    const ids = [
      'anthropic-messages',
      'ollama-local',
      'openrouter-login',
      'gemini-image-direct',
      'siliconflow-image',
    ]
    const made = new Map<string, string>()
    for (const presetId of ids) {
      const p = await h.client.call('providers.fromPreset', { body: { presetId } })
      made.set(presetId, p.id)
      // created in the source language
      expect(p.knownLimitations, presetId).toEqual(
        PROVIDER_PRESETS.find((x) => x.id === presetId)!.knownLimitations,
      )
    }
    const en = as(h, 'en')
    const hant = as(h, 'zh-TW')
    for (const [presetId, providerId] of made) {
      const preset = PROVIDER_PRESETS.find((x) => x.id === presetId)!
      const e = await en.call('providers.get', { params: { providerId } })
      const t = await hant.call('providers.get', { params: { providerId } })
      expect(e.knownLimitations, presetId).toEqual(preset.i18n!.en!.knownLimitations)
      expect(t.knownLimitations, presetId).toEqual(preset.i18n!['zh-Hant']!.knownLimitations)
      expect(e.label, presetId).toBe(preset.i18n!.en!.label)
      // the list endpoint localizes the same way
      const listed = (await en.call('providers.list')).items.find((x) => x.id === providerId)!
      expect(listed.knownLimitations).toEqual(e.knownLimitations)
    }
    // text the user wrote is theirs and is never translated; the untouched limitations still are
    const id = made.get('ollama-local')!
    await h.client.call('providers.update', {
      params: { providerId: id },
      body: { label: '我的本机模型', notes: '我自己写的备注' },
    })
    const mine = await en.call('providers.get', { params: { providerId: id } })
    expect(mine).toMatchObject({ label: '我的本机模型', notes: '我自己写的备注' })
    expect(mine.knownLimitations).toEqual(
      PROVIDER_PRESETS.find((x) => x.id === 'ollama-local')!.i18n!.en!.knownLimitations,
    )
  })
})

describe('address validation covers every way to write an address (only on write)', () => {
  const create = (h: Harness, baseUrl: string) =>
    h.client.call('providers.create', {
      body: { label: 'mine', kind: 'llm', protocol: 'openai-chat', baseUrl, model: 'm' },
    })

  it('providers.create: same rules as fromPreset, trimmed address stored', async () => {
    const { h } = await boot()
    for (const [bad, code] of [
      ['https://a.example.com/v1?x=1', 'BASE_URL_INVALID'],
      ['https://a.example.com/v1#x', 'BASE_URL_INVALID'],
      ['https://%7BWorkspaceId%7D.example.com/v1', 'BASE_URL_PLACEHOLDER_UNFILLED'],
      ['https://{WorkspaceId}.example.com/v1', 'BASE_URL_PLACEHOLDER_UNFILLED'],
      ['http://api.example.com/v1', 'BASE_URL_INSECURE'],
      ['http://169.254.169.254/v1', 'BASE_URL_INSECURE'],
      ['ftp://x.example.com', 'BASE_URL_INVALID'],
    ] as const) {
      await expect(create(h, bad), bad).rejects.toMatchObject({ status: 400, code })
    }
    const ok = await create(h, '  http://localhost:11434/v1  ')
    expect(ok.baseUrl).toBe('http://localhost:11434/v1')
    expect((await h.client.call('providers.list')).items).toHaveLength(1)
  })

  it('providers.update: a changed address is checked; an unchanged one is never re-checked, and old rows stay readable', async () => {
    const { h } = await boot()
    // a row that was saved before the rules tightened (written straight to the store)
    await h.server.ctx.store.providers.put({
      id: 'prov_legacy',
      label: 'old',
      kind: 'llm',
      protocol: 'openai-chat',
      baseUrl: 'https://legacy.example.com/v1?key=1',
      model: 'm',
      enabled: true,
    } as never)
    // readable
    expect(
      (await h.client.call('providers.get', { params: { providerId: 'prov_legacy' } })).baseUrl,
    ).toBe('https://legacy.example.com/v1?key=1')
    expect((await h.client.call('providers.list')).items.map((p) => p.id)).toContain('prov_legacy')
    // editing something else, even sending the same old address back, still works
    const renamed = await h.client.call('providers.update', {
      params: { providerId: 'prov_legacy' },
      body: { label: 'renamed', baseUrl: 'https://legacy.example.com/v1?key=1' },
    })
    expect(renamed.label).toBe('renamed')
    // changing the address runs the checks
    await expect(
      h.client.call('providers.update', {
        params: { providerId: 'prov_legacy' },
        body: { baseUrl: 'http://api.example.com/v1' },
      }),
    ).rejects.toMatchObject({ status: 400, code: 'BASE_URL_INSECURE' })
    await expect(
      h.client.call('providers.update', {
        params: { providerId: 'prov_legacy' },
        body: { baseUrl: 'https://other.example.com/v1?x=1' },
      }),
    ).rejects.toMatchObject({ code: 'BASE_URL_INVALID' })
    const moved = await h.client.call('providers.update', {
      params: { providerId: 'prov_legacy' },
      body: { baseUrl: ' https://new.example.com/v1 ' },
    })
    expect(moved.baseUrl).toBe('https://new.example.com/v1')
  })

  it('a login provider still answers AUTH_NOT_ALLOWED first for a wrong address', async () => {
    const { h } = await boot()
    await expect(
      h.client.call('providers.create', {
        body: {
          label: 'x',
          kind: 'llm',
          protocol: 'openai-responses',
          baseUrl: 'https://evil.example.com/v1',
          model: 'm',
          auth: { type: 'account_login', channel: 'openai-chatgpt' },
        },
      }),
    ).rejects.toMatchObject({ code: 'AUTH_NOT_ALLOWED' })
  })
})

describe('dialect: the image style is stored and returned', () => {
  it('providers.update accepts imageStyle and rejects an unknown value', async () => {
    const { h } = await boot()
    const p = await h.client.call('providers.fromPreset', {
      body: { presetId: 'openai-gpt-image', apiKey: 'sk-image-1234567890' },
    })
    const updated = await h.client.call('providers.update', {
      params: { providerId: p.id },
      body: { dialect: { imageStyle: 'compat' } },
    })
    expect(updated.dialect).toEqual({ imageStyle: 'compat' })
    expect(
      (await h.client.call('providers.get', { params: { providerId: p.id } })).dialect,
    ).toEqual({ imageStyle: 'compat' })
    await expect(
      h.client.call('providers.update', {
        params: { providerId: p.id },
        body: { dialect: { imageStyle: 'banana' as never } },
      }),
    ).rejects.toThrow(/imageStyle/) // the typed client refuses it before sending
  })
})
