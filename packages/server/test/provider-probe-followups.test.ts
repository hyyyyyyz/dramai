import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'

afterEach(cleanupAll)

const KEY = 'sk-probe-0123456789abcdef'
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

interface Seen {
  method: string
  url: string
  headers: Record<string, string>
}
async function boot(
  respond: (url: string, headers: Record<string, string>) => Response | Promise<Response>,
) {
  const seen: Seen[] = []
  const h = await startServer({
    startWorker: false,
    executor: {
      fetch: (async (url: string, init?: RequestInit) => {
        const headers = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
        seen.push({ method: init?.method ?? 'GET', url, headers })
        return respond(url, headers)
      }) as never,
    },
  })
  return { h, seen }
}
const draft = (protocol: string, kind: string, baseUrl = 'https://api.example.test/v1') => ({
  kind: kind as never,
  protocol: protocol as never,
  baseUrl,
  model: 'model-a',
})
const probe = (
  h: Harness,
  action: 'models' | 'test',
  d: ReturnType<typeof draft>,
  apiKey: string | undefined = KEY,
) =>
  h.client.call('providers.probe', {
    body: {
      action,
      ...d,
      auth: apiKey ? { type: 'api_key' as const, apiKey } : { type: 'none' as const },
    },
  })

const within = async <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${what} was blocked for more than ${ms} ms`)),
          ms,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe('providers.probe waits for the upstream without holding the write transaction', () => {
  it.each(['models', 'test'] as const)(
    '%s: while the upstream request hangs, reads, writes and the other new routes answer at once',
    async (action) => {
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      let arrived!: () => void
      const reached = new Promise<void>((r) => (arrived = r))
      const { h } = await boot(async () => {
        arrived()
        await gate
        return json(200, { data: [{ id: 'model-a' }] })
      })
      const pending = probe(h, action, draft('openai-chat', 'llm'))
      try {
        await within(reached, 2000, 'the probe request reaching the upstream')
        await within(h.client.call('providers.list'), 1000, 'providers.list')
        await within(h.client.call('settings.get'), 1000, 'settings.get')
        const created = await within(
          h.client.call('providers.create', {
            body: {
              label: 'x',
              kind: 'llm',
              protocol: 'openai-chat',
              baseUrl: 'https://a.example.test/v1',
              model: 'm',
            },
          }),
          1000,
          'providers.create',
        )
        expect(created.id).toBeTruthy()
        await within(
          h.client.call('models.known', { query: { kind: 'image' } }),
          1000,
          'models.known',
        )
        await within(h.client.call('providers.loginChannels'), 1000, 'providers.loginChannels')
      } finally {
        release()
      }
      expect((await pending).outcome).toBe(action === 'models' ? 'models' : 'ok')
    },
  )
})

describe('providers.probe redaction never damages the answer', () => {
  // keys that are (or contain) words the answer itself is made of
  const SHORT = [
    'o',
    'ok',
    'k',
    'models',
    'outcome',
    'failed',
    'error',
    'unverifiable',
    'no_model_list',
    'login_after_save',
    'HTTP_401',
  ]

  it.each(SHORT)(
    'the key %s: every protocol and action still answers with a well-formed result',
    async (key) => {
      // validateResponses is on in the test server: a damaged result would be a 500 RESPONSE_SHAPE_MISMATCH
      const echo = (_u: string, h: Record<string, string>) =>
        json(401, {
          error: {
            message: `Incorrect API key provided: ${(h.Authorization ?? '').replace(/^Bearer /, '')}`,
          },
        })
      const { h } = await boot(echo)
      for (const [protocol, kind] of [
        ['openai-chat', 'llm'],
        ['anthropic-messages', 'llm'],
        ['gemini-image', 'image'],
        ['openai-tts', 'tts'],
        ['ark-video', 'video'],
      ] as const) {
        for (const action of ['models', 'test'] as const) {
          const res = await probe(h, action, draft(protocol, kind), key)
          const expected =
            protocol === 'ark-video'
              ? action === 'models'
                ? 'no_model_list'
                : 'unverifiable'
              : 'failed'
          expect(res.outcome, `${protocol}/${action}`).toBe(expected)
          if (res.outcome === 'failed')
            expect(res).toMatchObject({ status: 401, code: expect.stringMatching(/./) })
        }
      }
    },
  )

  it('a key that is too short to be a credential is not replaced; a real one is, in the fields meant for people only', async () => {
    const { h } = await boot((_u, hd) =>
      json(401, { error: { message: `bad ${(hd.Authorization ?? '').replace(/^Bearer /, '')}` } }),
    )
    const shortOne = await probe(h, 'test', draft('openai-chat', 'llm'), 'abc')
    expect(shortOne).toMatchObject({ outcome: 'failed', code: 'HTTP_401' })
    expect(JSON.stringify(shortOne)).toContain('bad abc') // left alone on purpose (not a credential)
    const realOne = await probe(h, 'test', draft('openai-chat', 'llm'), KEY)
    expect(JSON.stringify(realOne)).not.toContain(KEY)
    expect(realOne).toMatchObject({ outcome: 'failed', code: 'HTTP_401' })
  })

  const SPECIAL = `sk-a"b/c&d<e>é'f+g h_0123456789`
  const forms: Record<string, (k: string) => string> = {
    raw: (k) => k,
    url: (k) => encodeURIComponent(k),
    json: (k) => JSON.stringify(k).slice(1, -1),
    'php-json (\\/ and \\uXXXX)': (k) =>
      JSON.stringify(k).slice(1, -1).replace(/\//g, '\\/').replace(/é/g, '\\u00e9'),
    html: (k) =>
      k
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    base64: (k) => Buffer.from(k).toString('base64'),
    base64url: (k) => Buffer.from(k).toString('base64url'),
  }
  it.each(Object.keys(forms))('an upstream that repeats the key as %s', async (name) => {
    const { h } = await boot(
      () => new Response(`rejected: ${forms[name]!(SPECIAL)} end`, { status: 401 }),
    )
    for (const action of ['models', 'test'] as const) {
      const res = await probe(h, action, draft('openai-chat', 'llm'), SPECIAL)
      expect(res.outcome).toBe('failed')
      const text = JSON.stringify(res)
      for (const f of Object.values(forms)) expect(text, `${action}`).not.toContain(f(SPECIAL))
      expect(text).toContain('[redacted]')
    }
  })
})

describe('model lists: the final list of protocols, one implementation behind both routes', () => {
  const LISTABLE: Array<[string, string, string?]> = [
    ['openai-chat', 'llm'],
    ['openai-responses', 'llm'],
    ['anthropic-messages', 'llm', 'https://api.example.test'],
    ['gemini-chat', 'llm', 'https://api.example.test'],
    ['openai-images', 'image'],
    ['gemini-image', 'image', 'https://relay.example.test'],
    ['openai-tts', 'tts'],
  ]
  const NOT_LISTABLE: Array<[string, string]> = [
    ['gemini-image', 'image'], // placeholder row replaced below
  ].slice(0, 0) as never
  void NOT_LISTABLE
  const OTHERS: Array<[string, string]> = [
    ['volcengine-images', 'image'],
    ['dashscope-image', 'image'],
    ['siliconflow-images', 'image'],
    ['kling-image', 'image'],
    ['aliyun-video', 'video'],
    ['volcengine-video', 'video'],
    ['kling-video', 'video'],
    ['generic-video', 'video'],
    ['ark-video', 'video'],
    ['kling-contents', 'video'],
    ['dashscope-video', 'video'],
    ['minimax-t2a', 'tts'],
    ['dashscope-cosyvoice', 'tts'],
  ]
  // what each family of upstreams answers (OpenAI-style `data[]`, Gemini-style `models[]`)
  const OPENAI_LIST = { data: [{ id: 'model-a' }, { id: 'image-only-model' }] }
  const GEMINI_LIST = {
    models: [
      { name: 'models/imagen-x', displayName: 'Imagen X', supportedGenerationMethods: ['predict'] },
      { name: 'models/embed-y', supportedGenerationMethods: ['embedContent'] },
    ],
  }
  const listFor = (protocol: string) => (protocol.startsWith('gemini') ? GEMINI_LIST : OPENAI_LIST)
  const LIST = { ...OPENAI_LIST, ...GEMINI_LIST } // only used where the answer is not read

  it.each(LISTABLE)(
    '%s: the saved route and the draft route list the same models from the same request',
    async (protocol, kind, base) => {
      const { h, seen } = await boot(() => json(200, listFor(protocol)))
      const d = draft(protocol, kind, base)
      const saved = await h.client.call('providers.create', {
        body: { label: 's', ...d, apiKey: KEY, auth: { type: 'api_key' } },
      })
      seen.length = 0
      const fromSaved = (
        await h.client.call('providers.models', { params: { providerId: saved.id } })
      ).items
      const savedReq = seen.splice(0)
      const fromDraft = await probe(h, 'models', d)
      expect(seen).toEqual(savedReq)
      expect(fromDraft).toEqual({ outcome: 'models', items: fromSaved })
      expect(savedReq).toHaveLength(1)
      expect(savedReq[0]!.method).toBe('GET')
      if (protocol !== 'gemini-chat') expect(fromSaved.length).toBeGreaterThan(0)
      // what the upstream says is what comes back: nothing is filtered by name, nothing is sorted
      if (protocol === 'gemini-image') {
        expect(fromSaved.map((m) => m.id)).toEqual(['imagen-x', 'embed-y'])
      } else if (protocol === 'gemini-chat') {
        expect(fromSaved.map((m) => m.id)).toEqual([]) // gemini-chat keeps only generateContent models (existing rule)
      } else {
        expect(fromSaved.map((m) => m.id)).toEqual(['model-a', 'image-only-model'])
      }
    },
  )

  it('gemini-image: Google’s own address gets x-goog-api-key only, any other address gets both headers', async () => {
    const google = await boot(() => json(200, LIST))
    await probe(
      google.h,
      'models',
      draft('gemini-image', 'image', 'https://generativelanguage.googleapis.com'),
    )
    expect(google.seen[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(google.seen[0]!.headers).toEqual({ 'x-goog-api-key': KEY })
    const relay = await boot(() => json(200, LIST))
    await probe(relay.h, 'models', draft('gemini-image', 'image', 'https://relay.example.test'))
    expect(relay.seen[0]!.headers).toEqual({
      Authorization: `Bearer ${KEY}`,
      'x-goog-api-key': KEY,
    })
    // openai-images / openai-tts: GET {base}/models with a Bearer key
    const tts = await boot(() => json(200, LIST))
    await probe(tts.h, 'models', draft('openai-tts', 'tts'))
    expect(tts.seen[0]!.url).toBe('https://api.example.test/v1/models')
    expect(tts.seen[0]!.headers.Authorization).toBe(`Bearer ${KEY}`)
  })

  it.each(OTHERS)(
    '%s: no model list on either route, and nothing is sent',
    async (protocol, kind) => {
      const { h, seen } = await boot(() => json(200, LIST))
      const d = draft(protocol, kind)
      const saved = await h.client.call('providers.create', {
        body: { label: 's', ...d, apiKey: KEY, auth: { type: 'api_key' } },
      })
      await expect(
        h.client.call('providers.models', { params: { providerId: saved.id } }),
      ).rejects.toMatchObject({ status: 409, code: 'MODEL_LIST_UNSUPPORTED' })
      expect((await probe(h, 'models', d)).outcome).toBe('no_model_list')
      expect(seen).toEqual([])
    },
  )

  it('a failed list is described the same way on both routes: status, code and the first 180 characters, with the key removed', async () => {
    const body = `{"error":{"message":"Incorrect API key provided: ${KEY}","type":"authentication_error"}} ${'x'.repeat(400)}`
    const { h } = await boot(() => new Response(body, { status: 401 }))
    for (const [protocol, kind] of [
      ['openai-chat', 'llm'],
      ['openai-images', 'image'],
      ['openai-tts', 'tts'],
    ] as const) {
      const d = draft(protocol, kind)
      const saved = await h.client.call('providers.create', {
        body: { label: 's', ...d, apiKey: KEY, auth: { type: 'api_key' } },
      })
      const err = await h.client
        .call('providers.models', { params: { providerId: saved.id } })
        .then(
          () => undefined,
          (
            e: Error & { status: number; code: string; details?: { status: number; code: string } },
          ) => e,
        )
      const drafted = await probe(h, 'models', d)
      expect(err).toMatchObject({
        status: 502,
        code: 'PROVIDER_REQUEST_FAILED',
        details: { status: 401, code: 'HTTP_401' },
      })
      expect(drafted).toMatchObject({ outcome: 'failed', status: 401, code: 'HTTP_401' })
      if (drafted.outcome !== 'failed') throw new Error('unreachable')
      expect(err!.message).toBe(`服务商返回 ${drafted.error}`)
      expect(drafted.error.length).toBeLessThan(220) // "HTTP 401 · " + at most 180 characters
      expect(
        `${err!.message} ${JSON.stringify(err!.details)} ${JSON.stringify(drafted)}`,
      ).not.toContain(KEY)
      expect(drafted.error).toContain('[redacted]')
    }
  })
})
