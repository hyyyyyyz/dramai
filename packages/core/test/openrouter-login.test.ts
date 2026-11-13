import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { LoginRequiredError } from '../src/providers/auth.ts'
import { ProviderError } from '../src/providers/errors.ts'
import {
  OPENROUTER_LOGIN,
  OpenRouterLogin,
  openRouterKeyPage,
} from '../src/providers/login/openrouter.ts'
import type {
  ListenerFactory,
  ListenerOptions,
  LoginErrorCode,
} from '../src/providers/login/types.ts'
import type { ProviderConfig } from '../src/providers/types.ts'

const KEY = 'sk-or-v1-abcdef0123456789abcdef0123456789'
const REF = 'provider:prov_or'

function setup(options: { loginTimeoutMs?: number } = {}) {
  const store = new Map<string, string>()
  const secrets = {
    get: async (k: string) => store.get(k),
    set: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
    has: async (k: string) => store.has(k),
  }
  const world = {
    exchanges: [] as Array<{
      url: string
      body: Record<string, string>
      headers: Record<string, string>
    }>,
    otherRequests: [] as string[],
    reply: (): { status?: number; body?: unknown } => ({ body: { key: KEY } }),
    gate: undefined as Promise<void> | undefined,
    networkDown: false,
  }
  const fetchFn = async (url: string, init?: RequestInit) => {
    if (url !== OPENROUTER_LOGIN.exchangeUrl) {
      world.otherRequests.push(url)
      throw new Error(`unexpected request to ${url}`)
    }
    world.exchanges.push({
      url,
      body: JSON.parse(String(init?.body)) as Record<string, string>,
      headers: init?.headers as Record<string, string>,
    })
    if (world.gate) await world.gate
    if (world.networkDown) throw new Error('down')
    const r = world.reply()
    return new Response(JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  let handler: Parameters<ListenerFactory>[0] | undefined
  const listeners: Array<{ closed: boolean; redirectUri: string; options?: ListenerOptions }> = []
  const listen: ListenerFactory = async (onCallback, opts) => {
    handler = onCallback
    const l = {
      closed: false,
      redirectUri: `http://localhost:${51000 + listeners.length}${opts?.path ?? '/callback'}`,
      options: opts,
    }
    listeners.push(l)
    return { redirectUri: l.redirectUri, close: () => void (l.closed = true) }
  }
  const events: Array<Record<string, unknown>> = []
  const login = new OpenRouterLogin({
    secrets,
    listen,
    fetch: fetchFn,
    log: (e) => events.push(e),
    loginTimeoutMs: options.loginTimeoutMs,
  })
  const config: ProviderConfig = {
    id: 'prov_or',
    label: 'OpenRouter',
    kind: 'llm',
    protocol: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'm',
    enabled: true,
    secretRef: REF,
    auth: { type: 'account_login', channel: 'openrouter' },
  }
  return {
    login,
    store,
    world,
    listeners,
    events,
    config,
    callback: (p: Record<string, string>) => handler!(new URLSearchParams(p)),
  }
}
type Ctx = ReturnType<typeof setup>

async function begin(t: Ctx) {
  const started = await t.login.start('prov_or', REF)
  return {
    started,
    q: new URL(started.authorizationUrl).searchParams,
    url: new URL(started.authorizationUrl),
  }
}

describe('OpenRouter login: the authorization address', () => {
  it('uses the documented parameters, a localhost callback (the only form the docs mention) and S256', async () => {
    const t = setup()
    const { started, url, q } = await begin(t)
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth')
    expect(q.get('callback_url')).toBe(started.redirectUri)
    const cb = new URL(q.get('callback_url')!)
    expect(cb.hostname).toBe('localhost')
    expect(cb.protocol).toBe('http:')
    expect(cb.pathname).toBe('/callback')
    expect(cb.port).not.toBe('') // a port is always given
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(q.get('key_label')).toBe('dramai')
    expect(q.get('state')!.length).toBeGreaterThanOrEqual(16)
    // nothing that does not exist in this flow: no client id, no secret, no workspace
    for (const k of [
      'client_id',
      'client_secret',
      'response_type',
      'redirect_uri',
      'workspace_id',
      'scope',
    ])
      expect(q.has(k), k).toBe(false)
    expect([...q.keys()].sort()).toEqual([
      'callback_url',
      'code_challenge',
      'code_challenge_method',
      'key_label',
      'state',
    ])
    // the listener was asked for localhost, the callback path and any free port, and started before the address was handed out
    expect(t.listeners[0]!.options).toMatchObject({
      host: 'localhost',
      path: '/callback',
      preferredPort: 0,
    })
  })

  it('fresh state and PKCE for every attempt; the verifier sent later hashes to the challenge', async () => {
    const t = setup()
    const a = (await begin(t)).q
    const b = (await begin(t)).q
    expect(a.get('state')).not.toBe(b.get('state'))
    expect(a.get('code_challenge')).not.toBe(b.get('code_challenge'))
    expect(t.listeners[0]!.closed).toBe(true)
    await t.callback({ code: 'C', state: b.get('state')! })
    const body = t.world.exchanges[0]!.body
    expect(createHash('sha256').update(body.code_verifier!).digest('base64url')).toBe(
      b.get('code_challenge'),
    )
  })
})

describe('OpenRouter login: code exchange', () => {
  it('posts the documented JSON to the documented address, saves the returned key as an ordinary key, closes the listener', async () => {
    const t = setup()
    const { q } = await begin(t)
    expect(await t.callback({ code: 'THE-CODE', state: q.get('state')! })).toEqual({ ok: true })
    const ex = t.world.exchanges[0]!
    expect(ex.url).toBe('https://openrouter.ai/api/v1/auth/keys')
    expect(ex.body).toMatchObject({ code: 'THE-CODE', code_challenge_method: 'S256' })
    expect(Object.keys(ex.body).sort()).toEqual(['code', 'code_challenge_method', 'code_verifier'])
    expect(ex.headers['Content-Type']).toBe('application/json')
    expect(t.store.get(REF)).toBe(KEY) // stored exactly like an API key
    expect(await t.login.accessToken(t.config)).toBe(KEY)
    expect(t.listeners.every((l) => l.closed)).toBe(true)
    expect(t.world.otherRequests).toEqual([])
  })

  it('status: signed in, says the key came from sign-in (api_key kind, masked), has the official key page; no key, no account, no expiry', async () => {
    const t = setup()
    const { q } = await begin(t)
    await t.callback({ code: 'C', state: q.get('state')! })
    const status = await t.login.status('prov_or', REF)
    expect(status).toEqual({
      channel: 'openrouter',
      state: 'signed_in',
      credential: { kind: 'api_key', mask: 'sk-or-…6789' },
      manageUrl: `https://openrouter.ai/keys/${createHash('sha256').update(KEY).digest('hex')}`,
    })
    expect(status).not.toHaveProperty('planUsage')
    expect(status).not.toHaveProperty('expiresAt')
    expect(status).not.toHaveProperty('account')
    expect(JSON.stringify(status)).not.toContain(KEY)
  })

  const failures: Array<{
    name: string
    code: LoginErrorCode
    params: (q: URLSearchParams) => Record<string, string>
    reply?: () => { status?: number; body?: unknown }
    exchanged: boolean
    down?: boolean
  }> = [
    {
      name: 'user denies (the state is echoed back)',
      code: 'user_denied',
      params: (q) => ({ error: 'access_denied', state: q.get('state')! }),
      exchanged: false,
    },
    {
      name: 'another authorization error',
      code: 'authorization_error',
      params: (q) => ({ error: 'server_error', state: q.get('state')! }),
      exchanged: false,
    },
    {
      name: 'no code',
      code: 'no_code',
      params: (q) => ({ state: q.get('state')! }),
      exchanged: false,
    },
    {
      name: 'code invalid or expired (403)',
      code: 'invalid_grant',
      params: (q) => ({ code: 'C', state: q.get('state')! }),
      reply: () => ({ status: 403, body: { error: { message: 'expired' } } }),
      exchanged: true,
    },
    {
      name: 'challenge method mismatch (400)',
      code: 'exchange_failed',
      params: (q) => ({ code: 'C', state: q.get('state')! }),
      reply: () => ({ status: 400, body: {} }),
      exchanged: true,
    },
    {
      name: 'method not allowed (405)',
      code: 'exchange_failed',
      params: (q) => ({ code: 'C', state: q.get('state')! }),
      reply: () => ({ status: 405, body: {} }),
      exchanged: true,
    },
    {
      name: 'server error (500)',
      code: 'exchange_failed',
      params: (q) => ({ code: 'C', state: q.get('state')! }),
      reply: () => ({ status: 500, body: {} }),
      exchanged: true,
    },
    {
      name: 'response without a key',
      code: 'exchange_failed',
      params: (q) => ({ code: 'C', state: q.get('state')! }),
      reply: () => ({ body: { nokey: true } }),
      exchanged: true,
    },
    {
      name: 'empty key',
      code: 'exchange_failed',
      params: (q) => ({ code: 'C', state: q.get('state')! }),
      reply: () => ({ body: { key: '' } }),
      exchanged: true,
    },
    {
      name: 'network failure',
      code: 'exchange_failed',
      params: (q) => ({ code: 'C', state: q.get('state')! }),
      exchanged: true,
      down: true,
    },
  ]
  for (const f of failures) {
    it(`fails cleanly: ${f.name}; nothing is saved and the listener is closed`, async () => {
      const t = setup()
      const { q } = await begin(t)
      if (f.reply) t.world.reply = f.reply
      if (f.down) t.world.networkDown = true
      expect(await t.callback(f.params(q))).toEqual({ ok: false, error: f.code })
      expect(t.world.exchanges.length > 0).toBe(f.exchanged)
      expect(t.store.size).toBe(0)
      const status = await t.login.status('prov_or', REF)
      expect(status.state).toBe('signed_out')
      expect(status.lastError?.code).toBe(f.code)
      expect(t.listeners.every((l) => l.closed)).toBe(true)
    })
  }
})

describe('OpenRouter login: only the real callback can end the attempt', () => {
  it('a request with the wrong state, or none (a denial carries none), is refused and ignored; the real callback then succeeds', async () => {
    const t = setup()
    const { q } = await begin(t)
    expect(await t.callback({ code: 'FORGED', state: 'FORGED' })).toEqual({
      ok: false,
      error: 'state_mismatch',
    })
    expect(await t.callback({ code: 'FORGED' })).toEqual({ ok: false, error: 'state_mismatch' })
    expect(await t.callback({ error: 'access_denied' })).toEqual({
      ok: false,
      error: 'state_mismatch',
    })
    expect(t.world.exchanges).toHaveLength(0)
    expect(t.listeners[0]!.closed).toBe(false)
    expect((await t.login.status('prov_or', REF)).state).toBe('pending')
    expect(await t.callback({ code: 'C', state: q.get('state')! })).toEqual({ ok: true })
    expect((await t.login.status('prov_or', REF)).state).toBe('signed_in')
  })

  it('cancel or timeout while the exchange is in flight discards the key; a stale attempt cannot end a newer one', async () => {
    for (const how of ['cancel', 'timeout'] as const) {
      const t = setup({ loginTimeoutMs: how === 'timeout' ? 30 : undefined })
      const { q } = await begin(t)
      let release!: () => void
      t.world.gate = new Promise<void>((r) => (release = r))
      const pending = t.callback({ code: 'C', state: q.get('state')! })
      await new Promise((r) => setTimeout(r, 5))
      expect(t.world.exchanges).toHaveLength(1)
      if (how === 'cancel') t.login.cancel('prov_or')
      else await new Promise((r) => setTimeout(r, 60))
      release()
      expect(await pending, how).toEqual({ ok: false, error: 'cancelled' })
      expect(t.store.size, how).toBe(0)
      expect((await t.login.status('prov_or', REF)).state, how).toBe('signed_out')
    }
    const t = setup()
    const first = await begin(t)
    let release!: () => void
    t.world.gate = new Promise<void>((r) => (release = r))
    const stale = t.callback({ code: 'C', state: first.q.get('state')! })
    await new Promise((r) => setTimeout(r, 5))
    await begin(t) // the user started again: cancels the first
    release()
    expect(await stale).toEqual({ ok: false, error: 'cancelled' })
    expect((await t.login.status('prov_or', REF)).state).toBe('pending')
    expect(t.listeners[1]!.closed).toBe(false)
  })

  it('times out and closes the listener; cancel closes it too', async () => {
    const t = setup({ loginTimeoutMs: 20 })
    await begin(t)
    await new Promise((r) => setTimeout(r, 60))
    const status = await t.login.status('prov_or', REF)
    expect(status).toMatchObject({ state: 'signed_out', lastError: { code: 'timeout' } })
    expect(t.listeners[0]!.closed).toBe(true)
    const u = setup()
    await begin(u)
    expect(u.login.cancel('prov_or')).toBe(true)
    expect(u.listeners[0]!.closed).toBe(true)
    expect(u.login.cancel('prov_or')).toBe(false)
  })
})

describe('OpenRouter login: calling, signing in again, signing out', () => {
  it('never signed in: login required; the key is used as an ordinary Bearer (nothing to refresh)', async () => {
    const t = setup()
    const err = await t.login.accessToken(t.config).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LoginRequiredError)
    expect((err as LoginRequiredError).reason).toBe('not_signed_in')
    t.store.set(REF, KEY)
    expect(await t.login.accessToken(t.config)).toBe(KEY)
  })

  it('the key is only ever released to the official OpenRouter address and protocol', async () => {
    const t = setup()
    t.store.set(REF, KEY)
    for (const evil of [
      { baseUrl: 'https://evil.example/api/v1' },
      { baseUrl: 'http://openrouter.ai/api/v1' },
      { baseUrl: 'https://openrouter.ai.evil.example/api/v1' },
      { protocol: 'openai-responses' as const },
    ]) {
      const err = await t.login.accessToken({ ...t.config, ...evil }).catch((e: unknown) => e)
      expect((err as ProviderError).code, JSON.stringify(evil)).toBe('LOGIN_ENDPOINT_NOT_ALLOWED')
    }
    expect(
      await t.login.accessToken({ ...t.config, baseUrl: 'https://openrouter.ai/api/v1/' }),
    ).toBe(KEY)
  })

  it('signing in again replaces the key', async () => {
    const t = setup()
    const a = await begin(t)
    await t.callback({ code: 'C1', state: a.q.get('state')! })
    t.world.reply = () => ({ body: { key: 'sk-or-v1-second-key-0123456789abcdef' } })
    const b = await begin(t)
    await t.callback({ code: 'C2', state: b.q.get('state')! })
    expect(t.store.get(REF)).toBe('sk-or-v1-second-key-0123456789abcdef')
  })

  it('logout: no revocation endpoint exists, so it clears the local key, says unconfirmed, and points to the key page; nothing is sent', async () => {
    const t = setup()
    const { q } = await begin(t)
    await t.callback({ code: 'C', state: q.get('state')! })
    const before = t.world.exchanges.length
    const out = await t.login.logout('prov_or', REF)
    expect(out).toEqual({ revoked: 'unconfirmed', manageUrl: openRouterKeyPage(KEY) })
    expect(t.store.has(REF)).toBe(false)
    expect(t.world.exchanges.length).toBe(before)
    expect(t.world.otherRequests).toEqual([])
    expect(await t.login.status('prov_or', REF)).toEqual({
      channel: 'openrouter',
      state: 'signed_out',
    })
    expect(await t.login.logout('prov_or', REF)).toEqual({ revoked: 'nothing_to_revoke' })
  })

  it('logout while a login is pending cancels it', async () => {
    const t = setup()
    await begin(t)
    await t.login.logout('prov_or', REF)
    expect(t.listeners[0]!.closed).toBe(true)
  })

  it('no key, code or verifier appears in the status, the authorization address or the log events', async () => {
    const t = setup()
    const { started, q } = await begin(t)
    await t.callback({ code: 'SECRET-CODE', state: q.get('state')! })
    const status = await t.login.status('prov_or', REF)
    const verifier = t.world.exchanges[0]!.body.code_verifier!
    await t.login.logout('prov_or', REF)
    const hay = JSON.stringify({ status, events: t.events, url: started.authorizationUrl })
    for (const secret of [KEY, 'SECRET-CODE', verifier]) expect(hay, secret).not.toContain(secret)
  })
})
