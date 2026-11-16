import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProviderKind } from '@dramai/core'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'

afterEach(cleanupAll)

const KEY = 'sk-probe-0123456789abcdef'

interface Seen {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}
type Responder = (url: string) => Response | Promise<Response>

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A list that every protocol's parser can read (OpenAI `data[]`, Gemini `models[]`). */
const LIST = {
  data: [{ id: 'model-a' }, { id: 'model-b' }],
  models: [
    { name: 'models/model-a', supportedGenerationMethods: ['generateContent'] },
    { slug: 'model-c', visibility: 'list' },
  ],
}

const RESPONDERS: Record<string, Responder> = {
  ok: () => json(200, LIST),
  unauthorized: () =>
    json(401, { error: { message: 'Incorrect API key', code: 'invalid_api_key' } }),
  anthropicStyleError: () =>
    json(403, { error: { type: 'permission_error', status: 'PERMISSION_DENIED', code: 'c' } }),
  notJson: () => new Response('<html>nope</html>', { status: 200 }),
  networkError: () => {
    throw new TypeError('fetch failed')
  },
  timeout: () => {
    throw new DOMException('The operation was aborted', 'AbortError')
  },
}

async function boot(
  responder: Responder = RESPONDERS.ok!,
  options: Parameters<typeof startServer>[0] = {},
) {
  const seen: Seen[] = []
  const h = await startServer({
    startWorker: false,
    executor: {
      fetch: (async (url: string, init?: RequestInit) => {
        seen.push({
          method: init?.method ?? 'GET',
          url,
          headers: { ...((init?.headers as Record<string, string> | undefined) ?? {}) },
          body: typeof init?.body === 'string' ? init.body : undefined,
        })
        return responder(url)
      }) as never,
    },
    ...options,
  })
  return { h, seen }
}

interface Draft {
  kind: ProviderKind
  protocol: string
  baseUrl: string
  model: string
}
/** Every protocol, grouped by kind (a Google address for gemini-image is a second row: it changes the headers). */
const MATRIX: Draft[] = [
  {
    kind: 'llm',
    protocol: 'openai-chat',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-a',
  },
  {
    kind: 'llm',
    protocol: 'openai-responses',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-c',
  },
  {
    kind: 'llm',
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.example.test',
    model: 'model-a',
  },
  { kind: 'llm', protocol: 'gemini-chat', baseUrl: 'https://api.example.test', model: 'model-a' },
  {
    kind: 'image',
    protocol: 'openai-images',
    baseUrl: 'https://api.example.test/v1',
    model: 'model-a',
  },
  {
    kind: 'image',
    protocol: 'gemini-image',
    baseUrl: 'https://relay.example.test',
    model: 'model-a',
  },
  {
    kind: 'image',
    protocol: 'gemini-image',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'model-a',
  },
  {
    kind: 'image',
    protocol: 'volcengine-images',
    baseUrl: 'https://api.example.test/v3',
    model: 'm',
  },
  { kind: 'image', protocol: 'dashscope-image', baseUrl: 'https://api.example.test', model: 'm' },
  {
    kind: 'image',
    protocol: 'siliconflow-images',
    baseUrl: 'https://api.example.test/v1',
    model: 'm',
  },
  { kind: 'image', protocol: 'kling-image', baseUrl: 'https://api.example.test', model: 'm' },
  { kind: 'video', protocol: 'aliyun-video', baseUrl: 'https://api.example.test', model: 'm' },
  { kind: 'video', protocol: 'volcengine-video', baseUrl: 'https://api.example.test', model: 'm' },
  { kind: 'video', protocol: 'kling-video', baseUrl: 'https://api.example.test', model: 'm' },
  { kind: 'video', protocol: 'generic-video', baseUrl: 'https://api.example.test', model: 'm' },
  { kind: 'video', protocol: 'ark-video', baseUrl: 'https://api.example.test/api/v3', model: 'm' },
  { kind: 'video', protocol: 'kling-contents', baseUrl: 'https://api.example.test', model: 'm' },
  { kind: 'video', protocol: 'dashscope-video', baseUrl: 'https://api.example.test', model: 'm' },
  { kind: 'tts', protocol: 'openai-tts', baseUrl: 'https://api.example.test/v1', model: 'tts-1' },
  { kind: 'tts', protocol: 'minimax-t2a', baseUrl: 'https://api.example.test', model: 'm' },
  { kind: 'tts', protocol: 'dashscope-cosyvoice', baseUrl: 'https://api.example.test', model: 'm' },
]
/** Protocols whose connection test sends no request at all (no cheap read-only endpoint): `unverifiable`. */
const NO_REQUEST = new Set([
  'aliyun-video',
  'volcengine-video',
  'kling-video',
  'generic-video',
  'ark-video',
  'kling-contents',
  'dashscope-video',
  'minimax-t2a',
  'dashscope-cosyvoice',
  'kling-image',
  'dashscope-image',
  'volcengine-images',
  'siliconflow-images',
])

const body = (
  d: Draft,
  action: 'models' | 'test',
  apiKey: string | undefined = KEY,
  extra = {},
) => ({
  action,
  kind: d.kind,
  protocol: d.protocol as never,
  baseUrl: d.baseUrl,
  model: d.model,
  auth: apiKey ? { type: 'api_key' as const, apiKey } : { type: 'none' as const },
  ...extra,
})
const saveDraft = (h: Harness, d: Draft, apiKey: string | undefined = KEY, extra = {}) =>
  h.client.call('providers.create', {
    body: {
      label: 'saved',
      kind: d.kind,
      protocol: d.protocol as never,
      baseUrl: d.baseUrl,
      model: d.model,
      ...(apiKey
        ? { apiKey, auth: { type: 'api_key' as const } }
        : { auth: { type: 'none' as const } }),
      ...extra,
    },
  })

describe('providers.probe · test: the same requests and the same result as providers.test on a saved provider', () => {
  for (const [name, responder] of Object.entries(RESPONDERS)) {
    describe(`upstream: ${name}`, () => {
      it.each(
        MATRIX.map((d) => [`${d.kind}/${d.protocol} ${new URL(d.baseUrl).host}`, d] as const),
      )('%s', async (_n, d) => {
        const { h, seen } = await boot(responder)
        const saved = await saveDraft(h, d)
        seen.length = 0
        const savedResult = await h.client.call('providers.test', {
          params: { providerId: saved.id },
        })
        const savedRequests = seen.splice(0)
        const probeResult = await h.client.call('providers.probe', { body: body(d, 'test') })
        const probeRequests = seen.splice(0)
        expect(probeRequests).toEqual(savedRequests)
        expect(probeResult).toEqual(savedResult)
        // a connection test never sends anything but a read-only GET (nothing that generates, so nothing that costs)
        expect(probeRequests.every((r) => r.method === 'GET' && r.body === undefined)).toBe(true)
        if (NO_REQUEST.has(d.protocol)) {
          expect(probeRequests).toEqual([])
          expect(probeResult.outcome).toBe('unverifiable')
        } else {
          expect(probeRequests).toHaveLength(1) // exactly one read-only list request
        }
      })
    })
  }

  it('a draft without any authentication sends the same requests as a saved provider without a key', async () => {
    for (const d of MATRIX.filter((x) => !NO_REQUEST.has(x.protocol))) {
      const { h, seen } = await boot()
      const saved = await saveDraft(h, d, undefined)
      seen.length = 0
      const savedResult = await h.client.call('providers.test', {
        params: { providerId: saved.id },
      })
      const savedRequests = seen.splice(0)
      const probeResult = await h.client.call('providers.probe', {
        body: { ...body(d, 'test', undefined) },
      })
      expect(seen, d.protocol).toEqual(savedRequests)
      expect(probeResult, d.protocol).toEqual(savedResult)
    }
  })

  it('extra request headers go through the same merge (protected names stay ignored)', async () => {
    const dialect = {
      extraHeaders: {
        'anthropic-workspace-id': 'wrkspc_1',
        Authorization: 'Bearer stolen',
        'X-Custom': 'v',
      },
    }
    for (const d of MATRIX.filter((x) => !NO_REQUEST.has(x.protocol))) {
      const { h, seen } = await boot()
      const saved = await saveDraft(h, d, KEY, { dialect })
      seen.length = 0
      const savedResult = await h.client.call('providers.test', {
        params: { providerId: saved.id },
      })
      const savedRequests = seen.splice(0)
      const probeResult = await h.client.call('providers.probe', {
        body: body(d, 'test', KEY, { dialect }),
      })
      expect(seen, d.protocol).toEqual(savedRequests)
      expect(probeResult, d.protocol).toEqual(savedResult)
      expect(seen[0]?.headers.Authorization ?? savedRequests[0]?.headers.Authorization).not.toBe(
        'Bearer stolen',
      )
    }
  })

  it('without a model there is no "model is / is not listed" claim; otherwise the result is the same', async () => {
    const { h } = await boot()
    const d = MATRIX[0]!
    const withModel = await h.client.call('providers.probe', { body: body(d, 'test') })
    expect(withModel).toMatchObject({ outcome: 'ok', modelListed: true })
    const { model: _m, ...noModel } = body(d, 'test')
    void _m
    const without = await h.client.call('providers.probe', { body: noModel })
    expect(without.outcome).toBe('ok')
    expect('modelListed' in without).toBe(false)
    expect(without).toMatchObject({ modelCount: 2 })
  })
})

describe('providers.probe · models: the same request as providers.models on a saved provider', () => {
  for (const [name, responder] of Object.entries(RESPONDERS)) {
    it.each(MATRIX.map((d) => [`${d.kind}/${d.protocol} ${new URL(d.baseUrl).host}`, d] as const))(
      `[${name}] %s`,
      async (_n, d) => {
        const { h, seen } = await boot(responder)
        const saved = await saveDraft(h, d)
        seen.length = 0
        const savedOutcome = await h.client
          .call('providers.models', { params: { providerId: saved.id } })
          .then(
            (r) => ({ ok: true as const, r }),
            (e: { status: number; code: string }) => ({ ok: false as const, e }),
          )
        const savedRequests = seen.splice(0)
        const probe = await h.client.call('providers.probe', { body: body(d, 'models') })
        const probeRequests = seen.splice(0)
        expect(probeRequests).toEqual(savedRequests)
        if (!savedOutcome.ok && savedOutcome.e.code === 'MODEL_LIST_UNSUPPORTED') {
          expect(probe.outcome).toBe('no_model_list')
          expect(probeRequests).toEqual([])
        } else if (savedOutcome.ok) {
          expect(probe).toEqual({ outcome: 'models', items: savedOutcome.r.items })
        } else {
          expect(probe.outcome).toBe('failed')
        }
      },
    )
  }
})

describe('providers.probe · bottom line 1: nothing is saved, nothing leaks', () => {
  const walk = async (dir: string, rel = ''): Promise<string[]> => {
    const out: string[] = []
    for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
      const p = join(rel, e.name)
      if (e.isDirectory()) out.push(...(await walk(dir, p)))
      else out.push(p)
    }
    return out.sort()
  }
  const sha = async (file: string) =>
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex')

  it('the data directory, secrets.json, the provider table and the settings are identical before and after', async () => {
    const logs: unknown[][] = []
    const { h } = await boot(RESPONDERS.unauthorized, {
      logger: { error: (...a: unknown[]) => logs.push(a), info: (...a: unknown[]) => logs.push(a) },
    })
    // one saved provider so that secrets.json exists
    await h.client.call('providers.create', {
      body: {
        label: 'keep',
        kind: 'llm',
        protocol: 'openai-chat',
        baseUrl: 'https://keep.example.test/v1',
        model: 'm',
        apiKey: 'sk-keep-0123456789',
      },
    })
    const events: unknown[] = []
    h.server.ctx.bus.subscribe((e) => events.push(e))
    const state = async () => ({
      files: await walk(h.dataDir),
      secrets: await sha(join(h.dataDir, 'secrets.json')),
      providers: (await h.client.call('providers.list')).items,
      settings: await h.client.call('settings.get'),
      providerRows: await h.server.ctx.store.providers.list(),
    })
    const before = await state()
    for (const d of MATRIX) {
      for (const action of ['models', 'test'] as const)
        await h.client.call('providers.probe', { body: body(d, action) })
    }
    await h.client.call('providers.probe', {
      body: {
        ...body(MATRIX[0]!, 'test'),
        auth: { type: 'account_login', channel: 'openrouter' },
        baseUrl: 'https://openrouter.ai/api/v1',
      },
    })
    const after = await state()
    expect(after).toEqual(before)
    expect(events).toEqual([]) // no provider/settings change events either
    // the draft key is nowhere: not in a single file of the data directory (the database included), nor in a log
    for (const f of await walk(h.dataDir)) {
      expect((await readFile(join(h.dataDir, f))).includes(KEY), f).toBe(false)
    }
    expect(JSON.stringify(logs)).not.toContain(KEY)
  })

  it('a rejected or a malformed draft does not echo the key either', async () => {
    const { h } = await boot()
    const bad = await h.raw('/api/providers/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'test',
        kind: 'nope',
        protocol: 'openai-chat',
        baseUrl: 'https://a.example.test',
        auth: { type: 'api_key', apiKey: KEY },
      }),
    })
    expect(bad.status).toBe(400)
    expect(await bad.text()).not.toContain(KEY)
    const rejected = await h.raw('/api/providers/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        body({ ...MATRIX[0]!, baseUrl: `https://a.example.test/v1?key=${KEY}` }, 'test'),
      ),
    })
    expect(rejected.status).toBe(400)
    // the address itself is the caller's own input and may come back in a message; the Key field never does
    expect(await rejected.text()).not.toContain(`apiKey`)
  })
})

describe('providers.probe · bottom line 2: the address rules of providers.create, and nothing is sent before they say yes', () => {
  const REJECTED = [
    'https://a.example.test/v1?x=1',
    'https://a.example.test/v1#x',
    'https://%7BWorkspaceId%7D.example.test/v1',
    'https://{WorkspaceId}.example.test/v1',
    'http://api.example.test/v1',
    'http://169.254.169.254/v1',
    'ftp://x.example.test',
    'not a url',
    'https://user:pw@a.example.test/v1',
    'https://a.example.test/ v1',
  ]
  const draft = (baseUrl: string): Draft => ({
    kind: 'llm',
    protocol: 'openai-chat',
    baseUrl,
    model: 'm',
  })

  it.each(REJECTED)('%s: same code as providers.create, 0 requests', async (bad) => {
    const { h, seen } = await boot()
    const created = await saveDraft(h, draft(bad)).then(
      () => undefined,
      (e: { status: number; code: string }) => e,
    )
    expect(created, 'providers.create refuses it').toBeDefined()
    for (const action of ['models', 'test'] as const) {
      const probed = await h.client
        .call('providers.probe', { body: body(draft(bad), action) })
        .then(
          () => undefined,
          (e: { status: number; code: string }) => e,
        )
      expect(probed?.status).toBe(created!.status)
      expect(probed?.code).toBe(created!.code)
    }
    expect(seen).toEqual([])
  })

  it('accepted addresses are the same too: the trimmed address is used, loopback http is fine', async () => {
    const { h, seen } = await boot()
    await h.client.call('providers.probe', {
      body: body(draft('  http://localhost:11434/v1  '), 'test'),
    })
    expect(seen.map((r) => r.url)).toEqual(['http://localhost:11434/v1/models'])
  })

  it('an account-login draft: same refusals as providers.create; an acceptable one answers "add first, then sign in" and sends nothing', async () => {
    const { h, seen } = await boot()
    const login = (
      kind: ProviderKind,
      protocol: string,
      baseUrl: string,
      channel = 'openai-chatgpt',
    ) => ({
      action: 'test' as const,
      kind,
      protocol: protocol as never,
      baseUrl,
      auth: { type: 'account_login' as const, channel: channel as never },
    })
    const refusedBy = async (b: ReturnType<typeof login>) =>
      h.client.call('providers.probe', { body: b }).then(
        () => undefined,
        (e: { status: number; code: string }) => e,
      )
    const createdBy = async (b: ReturnType<typeof login>) =>
      h.client
        .call('providers.create', {
          body: {
            label: 'x',
            kind: b.kind,
            protocol: b.protocol,
            baseUrl: b.baseUrl,
            model: 'm',
            auth: b.auth,
          },
        })
        .then(
          () => undefined,
          (e: { status: number; code: string }) => e,
        )
    for (const b of [
      login('llm', 'openai-chat', 'https://api.openai.com/v1'), // wrong protocol for the channel
      login('llm', 'openai-responses', 'https://elsewhere.example.test/v1'), // not the fixed address
      login('image', 'openai-responses', 'https://api.openai.com/v1'), // text only
    ]) {
      const a = await refusedBy(b)
      const c = await createdBy(b)
      expect(a, JSON.stringify(b)).toMatchObject({ status: 400, code: 'AUTH_NOT_ALLOWED' })
      expect(a?.code).toBe(c?.code)
    }
    for (const action of ['models', 'test'] as const) {
      expect(
        await h.client.call('providers.probe', {
          body: { ...login('llm', 'openai-responses', 'https://api.openai.com/v1'), action },
        }),
      ).toMatchObject({ outcome: 'login_after_save', channel: 'openai-chatgpt' })
      expect(
        await h.client.call('providers.probe', {
          body: {
            ...login('llm', 'openai-chat', 'https://openrouter.ai/api/v1', 'openrouter'),
            action,
          },
        }),
      ).toMatchObject({ outcome: 'login_after_save', channel: 'openrouter' })
    }
    expect(seen).toEqual([])
  })
})

describe('providers.probe · access control is the same as providers.create', () => {
  it('needs the token, and refuses a foreign Origin', async () => {
    const token = 'tok-0123456789abcdef-xyz'
    const h = await startServer({ token, startWorker: false })
    const draft = JSON.stringify(body(MATRIX[0]!, 'test'))
    const post = (headers: Record<string, string>) =>
      fetch(`${h.server.url}/api/providers/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: draft,
      })
    expect((await post({})).status).toBe(401)
    const foreign = await post({
      Authorization: `Bearer ${token}`,
      Origin: 'https://evil.example.com',
    })
    expect(foreign.status).toBe(403)
    // and the same two for providers.create, so "the same" is a measured fact
    const createWith = (headers: Record<string, string>) =>
      fetch(`${h.server.url}/api/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          label: 'x',
          kind: 'llm',
          protocol: 'openai-chat',
          baseUrl: 'https://a.example.test/v1',
          model: 'm',
        }),
      })
    expect((await createWith({})).status).toBe(401)
    expect(
      (await createWith({ Authorization: `Bearer ${token}`, Origin: 'https://evil.example.com' }))
        .status,
    ).toBe(403)
  })
})
