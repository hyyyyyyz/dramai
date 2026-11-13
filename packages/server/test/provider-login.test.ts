import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loginAvailability } from '../src/services/providers.ts'
import { createLoopbackListenerFactory } from '../src/login/loopback.ts'
import { HttpError } from '../src/errors.ts'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'
import { ACCESS, CLIENT_ID, fakeOpenAi, REFRESH } from './openai-fake.ts'
import type { FakeOpenAi } from './openai-fake.ts'

afterEach(cleanupAll)

const PRESET = 'openai-responses-login'

interface Boot {
  h: Harness
  openai: FakeOpenAi
  logs: unknown[][]
  upstream: Array<{ url: string; headers: Record<string, string>; body?: Record<string, unknown> }>
}

async function boot(options: { email?: string; scope?: string } = {}): Promise<Boot> {
  const openai = fakeOpenAi(options)
  const logs: unknown[][] = []
  const upstream: Boot['upstream'] = []
  const h = await startServer({
    startWorker: false,
    login: { fetch: openai.fetch, listen: createLoopbackListenerFactory({ preferredPort: 0 }) },
    logger: { error: (...a) => logs.push(a), info: (...a) => logs.push(a) },
    // the (fake) OpenAI API itself: /v1/models and /v1/responses
    executor: {
      fetch: (async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>
        upstream.push({
          url,
          headers,
          body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
        })
        if (url.endsWith('/models')) {
          return new Response(
            JSON.stringify({
              models: [
                { slug: 'm-a', display_name: 'Model A', visibility: 'list' },
                { slug: 'hidden', display_name: 'H', visibility: 'hide' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        if (url.endsWith('/responses')) {
          const ev = (type: string, extra: object) =>
            `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`
          return new Response(
            ev('response.output_text.delta', { delta: 'hello' }) +
              ev('response.completed', { response: {} }),
            { status: 200 },
          )
        }
        return new Response('{}', { status: 404 })
      }) as never,
    },
  })
  return { h, openai, logs, upstream }
}

const createLoginProvider = async (b: Boot) =>
  b.h.client.call('providers.fromPreset', { body: { presetId: PRESET } })

/** what the browser does after the user approves: GET the loopback redirect with the parameters */
async function browserCallback(_b: Boot, redirectUri: string, params: Record<string, string>) {
  const url = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return fetch(url)
}

async function startLogin(b: Boot, providerId: string) {
  const started = await b.h.client.call('providers.login.start', {
    params: { providerId },
    body: {},
  })
  const q = new URL(started.authorizationUrl).searchParams
  b.openai.nonce = q.get('nonce')!
  return { started, q }
}

async function signIn(b: Boot) {
  const p = await createLoginProvider(b)
  const { started, q } = await startLogin(b, p.id)
  const res = await browserCallback(b, started.redirectUri, {
    code: 'CODE',
    state: q.get('state')!,
    client_id: CLIENT_ID,
  })
  expect(res.status).toBe(200)
  return p
}

describe('old data keeps working: providers without an auth field', () => {
  it('a provider saved before auth existed is read as api_key (has a key) or none (no key), and still works', async () => {
    const upstream: Array<{ url: string; auth?: string }> = []
    const h1 = await startServer({ startWorker: false })
    // two rows exactly as the previous version stored them: no `auth`, no `verification`
    await h1.server.ctx.store.providers.put({
      id: 'old_keyed',
      label: 'DeepSeek',
      kind: 'llm',
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      secretRef: 'provider:old_keyed',
      enabled: true,
    })
    await h1.server.ctx.store.providers.put({
      id: 'old_local',
      label: 'Local',
      kind: 'llm',
      protocol: 'openai-chat',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen',
      enabled: true,
    })
    await h1.server.ctx.secrets.set('provider:old_keyed', 'sk-old-key-1234567890')
    await h1.stop()
    // upgrade: start the new version on the same data directory
    const h2 = await startServer({
      startWorker: false,
      dataDir: h1.dataDir,
      executor: {
        fetch: (async (url: string, init?: RequestInit) => {
          upstream.push({
            url,
            auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
          })
          return new Response(JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'qwen' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }) as never,
      },
    })
    const list = await h2.client.call('providers.list')
    const keyed = list.items.find((p) => p.id === 'old_keyed')!
    const local = list.items.find((p) => p.id === 'old_local')!
    expect(keyed).toMatchObject({ auth: { type: 'api_key' }, hasKey: true })
    expect(keyed.keyMask).toBeTruthy()
    expect(local).toMatchObject({ auth: { type: 'none' }, hasKey: false })
    // and they work: the key is sent as before, the keyless one sends nothing
    expect(
      await h2.client.call('providers.test', { params: { providerId: 'old_keyed' } }),
    ).toMatchObject({ outcome: 'ok' })
    expect(
      await h2.client.call('providers.test', { params: { providerId: 'old_local' } }),
    ).toMatchObject({ outcome: 'ok' })
    expect(upstream.map((u) => u.auth)).toEqual(['Bearer sk-old-key-1234567890', undefined])
    // setting a key on the keyless one makes it api_key; clearing it makes it none
    const set = await h2.client.call('providers.setKey', {
      params: { providerId: 'old_local' },
      body: { apiKey: 'sk-new-key-abcdefghij' },
    })
    expect(set.auth).toEqual({ type: 'api_key' })
    expect(
      (await h2.client.call('providers.clearKey', { params: { providerId: 'old_local' } })).auth,
    ).toEqual({ type: 'none' })
  })
})

describe('login providers: configuration', () => {
  it('the OpenAI preset creates an account-login provider, documented-only, and does not become the current choice', async () => {
    const { h } = await boot()
    const presets = await h.client.call('presets.list')
    const preset = presets.items.find((p) => p.id === PRESET)!
    expect(preset).toMatchObject({
      auth: { type: 'account_login', channel: 'openai-chatgpt' },
      verification: { status: 'documented' },
    })
    expect(preset.verifiedAt).toBeUndefined()
    expect(preset.knownLimitations[0]).toContain('只覆盖文本')
    expect(presets.items.filter((p) => p.verification.status === 'tested')).toHaveLength(4)

    const p = await createLoginProvider({ h } as Boot)
    expect(p).toMatchObject({
      auth: { type: 'account_login', channel: 'openai-chatgpt' },
      protocol: 'openai-responses',
      hasKey: false,
      verification: { status: 'documented' },
    })
    expect(p.verifiedAt).toBeUndefined()
    expect(p.login).toMatchObject({
      channel: 'openai-chatgpt',
      state: 'signed_out',
      availability: { available: true },
    })
    // not auto-selected, even though it is the first LLM provider
    expect((await h.client.call('settings.get')).activeProviders.llm).toBeUndefined()
    // a tested preset added after it still is
    const ds = await h.client.call('providers.fromPreset', {
      body: { presetId: 'deepseek-llm', apiKey: 'sk-deepseek-1234567890' },
    })
    expect((await h.client.call('settings.get')).activeProviders.llm).toBe(ds.id)
  })

  it('a key cannot be set on or cleared from a login provider, and login is text only', async () => {
    const { h } = await boot()
    const p = await createLoginProvider({ h } as Boot)
    for (const call of [
      () =>
        h.client.call('providers.setKey', {
          params: { providerId: p.id },
          body: { apiKey: 'sk-x-1234567890' },
        }),
      () => h.client.call('providers.clearKey', { params: { providerId: p.id } }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'KEY_NOT_APPLICABLE' })
    }
    await expect(
      h.client.call('providers.create', {
        body: {
          label: 'x',
          kind: 'image',
          protocol: 'openai-images',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-image',
          auth: { type: 'account_login', channel: 'openai-chatgpt' },
        },
      }),
    ).rejects.toMatchObject({ code: 'AUTH_NOT_ALLOWED' })
    await expect(
      h.client.call('providers.fromPreset', {
        body: { presetId: PRESET, apiKey: 'sk-x-1234567890' },
      }),
    ).rejects.toMatchObject({ status: 400 })
    // a provider that is not a login provider has no login
    const ds = await h.client.call('providers.fromPreset', {
      body: { presetId: 'deepseek-llm', apiKey: 'sk-deepseek-1234567890' },
    })
    await expect(
      h.client.call('providers.login.start', { params: { providerId: ds.id }, body: {} }),
    ).rejects.toMatchObject({ code: 'LOGIN_NOT_SUPPORTED' })
  })
})

describe('login providers: the whole flow over a real loopback listener (fake OpenAI)', () => {
  it('start → browser callback → signed in; responses and logs never contain a token', async () => {
    const b = await boot()
    const p = await createLoginProvider(b)
    const { started, q } = await startLogin(b, p.id)
    expect(
      started.authorizationUrl.startsWith('https://auth.openai.com/api/accounts/authorize?'),
    ).toBe(true)
    expect(new URL(started.redirectUri).hostname).toBe('127.0.0.1')
    expect(
      (await b.h.client.call('providers.login.status', { params: { providerId: p.id } })).state,
    ).toBe('pending')

    const res = await browserCallback(b, started.redirectUri, {
      code: 'THE-CODE',
      state: q.get('state')!,
      client_id: CLIENT_ID,
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('dramai')

    const status = await b.h.client.call('providers.login.status', { params: { providerId: p.id } })
    expect(status).toMatchObject({
      state: 'signed_in',
      planUsage: true,
      account: { label: 'me@example.com' },
      availability: { available: true },
    })
    expect(status.expiresAt).toBeTruthy()
    // the listener is gone after completion
    await expect(
      browserCallback(b, started.redirectUri, { code: 'x', state: 'y' }),
    ).rejects.toThrow()

    // everything the API returns, and everything logged, is free of tokens
    const seen = JSON.stringify([
      status,
      await b.h.client.call('providers.list'),
      await b.h.client.call('providers.get', { params: { providerId: p.id } }),
      await b.h.client.call('system.get'),
      b.logs,
    ])
    for (const secret of [ACCESS, REFRESH, 'THE-CODE', 'eyJ'])
      expect(seen, secret).not.toContain(secret)
    expect(seen).toContain('me@example.com') // the display label is allowed
    // the tokens are in the secret store file, not in the database
    expect(await readFile(join(b.h.dataDir, 'secrets.json'), 'utf8')).toContain('"')
    expect((await readFile(join(b.h.dataDir, 'dramai.sqlite'))).toString('latin1')).not.toContain(
      REFRESH,
    )
  })

  it('callback failures: wrong state is refused with a 400 page and nothing is saved; the user can retry', async () => {
    const b = await boot()
    const p = await createLoginProvider(b)
    const { started } = await startLogin(b, p.id)
    const res = await browserCallback(b, started.redirectUri, {
      code: 'C',
      state: 'FORGED',
      client_id: CLIENT_ID,
    })
    expect(res.status).toBe(400)
    const status = await b.h.client.call('providers.login.status', { params: { providerId: p.id } })
    expect(status).toMatchObject({ state: 'signed_out', lastError: { code: 'state_mismatch' } })
    expect(b.openai.requests.some((r) => r.url.includes('/oauth/token'))).toBe(false)
    // retry works
    const again = await startLogin(b, p.id)
    expect(
      (
        await browserCallback(b, again.started.redirectUri, {
          code: 'C',
          state: again.q.get('state')!,
          client_id: CLIENT_ID,
        })
      ).status,
    ).toBe(200)
  })

  it('the user denies: no code exchange, a clear error; cancel closes the listener', async () => {
    const b = await boot()
    const p = await createLoginProvider(b)
    const { started, q } = await startLogin(b, p.id)
    await browserCallback(b, started.redirectUri, {
      error: 'access_denied',
      state: q.get('state')!,
    })
    expect(
      await b.h.client.call('providers.login.status', { params: { providerId: p.id } }),
    ).toMatchObject({ lastError: { code: 'user_denied' } })
    const second = await startLogin(b, p.id)
    const cancelled = await b.h.client.call('providers.login.cancel', {
      params: { providerId: p.id },
    })
    expect(cancelled.state).toBe('signed_out')
    await expect(
      browserCallback(b, second.started.redirectUri, { code: 'x', state: 'y' }),
    ).rejects.toThrow()
  })

  it('the listener only answers GET /auth/callback on its own 127.0.0.1 address', async () => {
    const b = await boot()
    const p = await createLoginProvider(b)
    const { started } = await startLogin(b, p.id)
    const base = new URL(started.redirectUri)
    expect((await fetch(`${base.origin}/other`)).status).toBe(404)
    expect((await fetch(started.redirectUri, { method: 'POST' })).status).toBe(404)
  })

  it('without the plan-usage scope: signed in but flagged, and the provider cannot be used', async () => {
    const b = await boot({ scope: 'openid profile email offline_access resource.invoke' })
    const p = await signIn(b)
    expect(
      await b.h.client.call('providers.login.status', { params: { providerId: p.id } }),
    ).toMatchObject({ state: 'signed_in', planUsage: false })
    expect(await b.h.client.call('providers.test', { params: { providerId: p.id } })).toMatchObject(
      { outcome: 'failed' },
    )
  })

  it('logout revokes the refresh token, reports it, and keeps the account for signing in again; delete revokes too', async () => {
    const b = await boot()
    const p = await signIn(b)
    const out = await b.h.client.call('providers.login.logout', { params: { providerId: p.id } })
    expect(out).toMatchObject({
      revoked: 'confirmed',
      status: { state: 'signed_out', account: { label: 'me@example.com' } },
    })
    expect(b.openai.revoked).toEqual([REFRESH])
    const q = await startLogin(b, p.id)
    expect(q.q.get('client_id')).toBe(CLIENT_ID) // registration reused
    expect(q.q.get('login_hint')).toBe('me@example.com')

    const b2 = await boot()
    const p2 = await signIn(b2)
    await b2.h.client.call('providers.delete', { params: { providerId: p2.id } })
    expect(b2.openai.revoked).toEqual([REFRESH])
    expect(await b2.h.server.ctx.secrets.get(`provider:${p2.id}`)).toBeUndefined()
  })

  it('the model list comes from /v1/models with the access token, keeping only visibility=list', async () => {
    const b = await boot()
    const p = await signIn(b)
    const models = await b.h.client.call('providers.models', { params: { providerId: p.id } })
    expect(models.items).toEqual([{ id: 'm-a', label: 'Model A' }])
    const call = b.upstream.find((u) => u.url === 'https://api.openai.com/v1/models')!
    expect(call.headers.Authorization).toBe(`Bearer ${ACCESS}`)
  })

  it('test connection and text generation use the login token on the public Responses endpoint', async () => {
    const b = await boot()
    const p = await signIn(b)
    expect(await b.h.client.call('providers.test', { params: { providerId: p.id } })).toMatchObject(
      { outcome: 'ok' },
    )
    await b.h.server.ctx.settings.patchActive('llm', p.id)
    const out = await b.h.server.ctx.deps.llm.complete({
      task: 'test',
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
      ],
      temperature: 0.5,
    })
    expect(out.text).toBe('hello')
    const call = b.upstream.find((u) => u.url === 'https://api.openai.com/v1/responses')!
    expect(call.headers.Authorization).toBe(`Bearer ${ACCESS}`)
    expect(call.body).toMatchObject({ stream: true, store: false, instructions: 's' })
    expect(call.body).not.toHaveProperty('temperature')
    // the dropped parameter is logged by name only
    const dropped = b.logs.find((l) => String(l[0]).includes('dropped'))!
    expect(JSON.stringify(dropped)).toContain('temperature')
    expect(JSON.stringify(b.logs)).not.toContain(ACCESS)
  })

  it('an expired access token is refreshed before the call (and the new token is used)', async () => {
    let now = Date.now()
    const openai = fakeOpenAi()
    const upstream: string[] = []
    const h = await startServer({
      startWorker: false,
      login: {
        fetch: openai.fetch,
        listen: createLoopbackListenerFactory({ preferredPort: 0 }),
        now: () => now,
      },
      executor: {
        fetch: (async (_u: string, init?: RequestInit) => {
          upstream.push((init?.headers as Record<string, string>).Authorization!)
          return new Response(
            `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'ok' })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: {} })}\n\n`,
            { status: 200 },
          )
        }) as never,
      },
    })
    const b: Boot = { h, openai, logs: [], upstream: [] }
    const p = await signIn(b)
    await h.server.ctx.settings.patchActive('llm', p.id)
    now += 3600_000 // an hour later
    await h.server.ctx.deps.llm.complete({ task: 't', messages: [{ role: 'user', content: 'u' }] })
    expect(upstream).toEqual([`Bearer ${ACCESS}-refreshed`])
    expect(
      openai.requests.filter((r) => r.form?.get('grant_type') === 'refresh_token'),
    ).toHaveLength(1)
  })
})

describe('login from another machine', () => {
  it('reports that sign-in is not possible with this way of accessing, and why', async () => {
    expect(loginAvailability({ host: '127.0.0.1:8787', remoteAddress: '127.0.0.1' })).toEqual({
      available: true,
    })
    expect(loginAvailability({ host: 'localhost:8787' })).toEqual({ available: true })
    expect(loginAvailability({ host: '[::1]:8787', remoteAddress: '::1' })).toEqual({
      available: true,
    })
    expect(
      loginAvailability({ host: '127.0.0.1:8787', remoteAddress: '::ffff:127.0.0.1' }),
    ).toEqual({ available: true })
    for (const origin of [
      { host: 'dramai.example.com' },
      { host: '192.168.1.20:8787' },
      { host: 'localhost:8787', remoteAddress: '10.0.0.5' },
    ]) {
      const a = loginAvailability(origin)
      expect(a.available, JSON.stringify(origin)).toBe(false)
      expect(a.reason).toBe('remote_access')
      expect(a.message).toContain('127.0.0.1')
    }
  })

  it('starting a login is refused with LOGIN_UNAVAILABLE_REMOTE and no listener is opened', async () => {
    const b = await boot()
    const p = await createLoginProvider(b)
    const err = await b.h.server.ctx.providers
      .loginStart(p.id, {}, { host: 'dramai.example.com' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).code).toBe('LOGIN_UNAVAILABLE_REMOTE')
    expect(
      (await b.h.client.call('providers.login.status', { params: { providerId: p.id } })).state,
    ).toBe('signed_out')
  })
})
