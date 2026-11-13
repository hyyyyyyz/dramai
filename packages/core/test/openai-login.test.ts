import { createHash, createSign, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  assertLoginEndpoint,
  isAllowedLoginBaseUrl,
  LoginRequiredError,
} from '../src/providers/auth.ts'
import { ProviderError } from '../src/providers/errors.ts'
import { OPENAI_LOGIN, OpenAiLogin } from '../src/providers/login/openai-chatgpt.ts'
import type { OpenAiLoginErrorCode } from '../src/providers/login/openai-chatgpt.ts'
import type { ListenerFactory } from '../src/providers/login/types.ts'
import type { ProviderConfig } from '../src/providers/types.ts'

// --- test doubles: a made-up OpenAI (keys generated here), a loopback listener, a secret store ---

const b64u = (v: string | Buffer) => Buffer.from(v).toString('base64url')
const makeKey = (kid: string) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }
  const sign = (header: object, claims: object) => {
    const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`
    return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')}`
  }
  return { jwk, sign }
}
const KEY = makeKey('k1')
const OTHER_KEY = makeKey('k1') // same kid, different key: a forged signature

const CLIENT = 'oaiapp_issued_client'
const T0 = 1_800_000_000_000

interface World {
  now: number
  tokenRequests: URLSearchParams[]
  revokeRequests: URLSearchParams[]
  tokenReply: (form: URLSearchParams) => { status?: number; body: Record<string, unknown> }
  revokeStatus: number[]
  fetchLog: string[]
  /** hold the token endpoint until this resolves */
  tokenGate?: Promise<void>
  discoveryDoc?: Record<string, unknown>
  discoveryDown?: boolean
  jwksPaths: string[]
}

function idToken(
  claims: Record<string, unknown> = {},
  signer = KEY,
  header: object = { alg: 'RS256', kid: 'k1' },
) {
  return signer.sign(header, {
    iss: OPENAI_LOGIN.issuer,
    aud: CLIENT,
    sub: 'user-1',
    email: 'me@example.com',
    exp: T0 / 1000 + 3600,
    iat: T0 / 1000,
    nonce: 'NONCE',
    ...claims,
  })
}

function setup(options: { loginTimeoutMs?: number } = {}) {
  const store = new Map<string, string>()
  const secrets = {
    get: async (k: string) => store.get(k),
    set: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
    has: async (k: string) => store.has(k),
  }
  const world: World = {
    now: T0,
    tokenRequests: [],
    revokeRequests: [],
    tokenReply: () => ({ body: {} }),
    revokeStatus: [],
    fetchLog: [],
    jwksPaths: [],
  }
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    world.fetchLog.push(url)
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (url.endsWith('jwks.json') || url.endsWith('/keys')) {
      world.jwksPaths.push(url)
      return json({ keys: [KEY.jwk] })
    }
    if (url === OPENAI_LOGIN.discoveryUrl) {
      if (world.discoveryDown) throw new Error('network down')
      if (world.discoveryDoc) return json(world.discoveryDoc)
      return json({
        issuer: OPENAI_LOGIN.issuer,
        revocation_endpoint: OPENAI_LOGIN.revokeUrl,
        jwks_uri: OPENAI_LOGIN.jwksUrl,
      })
    }
    if (url === OPENAI_LOGIN.tokenUrl) {
      const form = new URLSearchParams(String(init?.body))
      world.tokenRequests.push(form)
      if (world.tokenGate) await world.tokenGate
      const r = world.tokenReply(form)
      return json(r.body, r.status ?? 200)
    }
    if (url === OPENAI_LOGIN.revokeUrl) {
      world.revokeRequests.push(new URLSearchParams(String(init?.body)))
      const status = world.revokeStatus.shift() ?? 200
      return new Response('', { status })
    }
    throw new Error(`unexpected request to ${url}`)
  }
  // a loopback listener we can fire callbacks into
  let handler: Parameters<ListenerFactory>[0] | undefined
  const listeners: Array<{ closed: boolean; redirectUri: string }> = []
  const listen: ListenerFactory = async (onCallback) => {
    handler = onCallback
    const l = {
      closed: false,
      redirectUri: `http://127.0.0.1:${1455 + listeners.length}${OPENAI_LOGIN.callbackPath}`,
    }
    listeners.push(l)
    return { redirectUri: l.redirectUri, close: () => void (l.closed = true) }
  }
  const events: Array<Record<string, unknown>> = []
  const login = new OpenAiLogin({
    secrets,
    listen,
    fetch: fetchFn,
    now: () => world.now,
    sleep: async () => {},
    log: (e) => events.push(e),
    appName: 'dramai',
    loginTimeoutMs: options.loginTimeoutMs,
  })
  const config: ProviderConfig = {
    id: 'prov_1',
    label: 'OpenAI',
    kind: 'llm',
    protocol: 'openai-responses',
    baseUrl: OPENAI_LOGIN.resource,
    model: 'm',
    enabled: true,
    secretRef: 'provider:prov_1',
    auth: { type: 'account_login', channel: 'openai-chatgpt' },
  }
  const callback = (params: Record<string, string>) => handler!(new URLSearchParams(params))
  return { login, store, secrets, world, listeners, events, config, callback }
}

type Ctx = ReturnType<typeof setup>
const goodTokens = (extra: Record<string, unknown> = {}, claims: Record<string, unknown> = {}) => ({
  body: {
    access_token: 'ACCESS-1',
    refresh_token: 'REFRESH-1',
    id_token: idToken(claims),
    token_type: 'Bearer',
    expires_in: 3600,
    scope: OPENAI_LOGIN.scope,
    ...extra,
  },
})

/** start a login and return the parameters of the authorization URL */
async function begin(t: Ctx, options?: { account?: 'same' | 'new' }) {
  const started = await t.login.start('prov_1', 'provider:prov_1', options)
  const url = new URL(started.authorizationUrl)
  return { started, url, q: url.searchParams }
}
/** the nonce is random per attempt; the fake OpenAI echoes it into the ID token */
const withNonce = (
  t: Ctx,
  q: URLSearchParams,
  extra: Record<string, unknown> = {},
  claims: Record<string, unknown> = {},
) => {
  t.world.tokenReply = () => goodTokens(extra, { nonce: q.get('nonce'), ...claims })
}

/** run a whole successful first sign-in */
async function signIn(t: Ctx, claims: Record<string, unknown> = {}) {
  const { q } = await begin(t)
  withNonce(t, q, {}, claims)
  const res = await t.callback({ code: 'CODE', state: q.get('state')!, client_id: CLIENT })
  expect(res).toEqual({ ok: true })
  return q
}

describe('OpenAI login: registration and the authorization address', () => {
  it('builds the documented authorization request, parameter by parameter', async () => {
    const t = setup()
    const { started, url, q } = await begin(t)
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/api/accounts/authorize')
    expect(q.get('client_id')).toBe('dynamic_agent_client') // first sign-in registers
    expect(q.get('response_type')).toBe('code')
    expect(q.get('redirect_uri')).toBe(started.redirectUri)
    expect(new URL(q.get('redirect_uri')!).hostname).toBe('127.0.0.1') // loopback IP, never "localhost"
    expect(q.get('redirect_uri')).not.toContain('localhost')
    expect(q.get('scope')).toBe(
      'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    )
    expect(q.get('resource')).toBe('https://api.openai.com/v1')
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/) // unpadded base64url of a SHA-256
    expect(q.get('state')!.length).toBeGreaterThanOrEqual(16)
    expect(q.get('nonce')!.length).toBeGreaterThanOrEqual(16)
    expect(q.get('ext_agent_host_id')).toMatch(/^urn:uuid:[0-9a-f-]{36}$/)
    expect(q.get('agent_name_hint')).toBe('dramai')
    // things that must not be there
    for (const k of ['client_secret', 'id_token_hint', 'login_hint', 'prompt', 'force_reconsent'])
      expect(q.has(k), k).toBe(false)
    expect(t.listeners).toHaveLength(1) // the listener was started before the address was handed out
  })

  it('state, nonce and PKCE are fresh for every attempt; the host id is stable', async () => {
    const t = setup()
    const a = (await begin(t)).q
    const b = (await begin(t)).q
    for (const k of ['state', 'nonce', 'code_challenge']) expect(a.get(k), k).not.toBe(b.get(k))
    expect(a.get('ext_agent_host_id')).toBe(b.get('ext_agent_host_id'))
    expect(t.listeners[0]!.closed).toBe(true) // starting again closed the earlier listener
  })

  it('the PKCE verifier sent at the token endpoint hashes to the challenge in the address', async () => {
    const t = setup()
    const { q } = await begin(t)
    withNonce(t, q)
    await t.callback({ code: 'CODE', state: q.get('state')!, client_id: CLIENT })
    const form = t.world.tokenRequests[0]!
    expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(
      q.get('code_challenge'),
    )
  })
})

describe('OpenAI login: callback and token exchange', () => {
  it('exchanges the code with the issued client id, no secret, same redirect_uri and resource', async () => {
    const t = setup()
    const { q } = await begin(t)
    withNonce(t, q)
    await t.callback({ code: 'CODE-123', state: q.get('state')!, client_id: CLIENT })
    const form = t.world.tokenRequests[0]!
    expect(Object.fromEntries(form)).toMatchObject({
      grant_type: 'authorization_code',
      client_id: CLIENT, // the issued one, never dynamic_agent_client
      code: 'CODE-123',
      redirect_uri: q.get('redirect_uri'),
      resource: 'https://api.openai.com/v1',
    })
    expect(form.has('client_secret')).toBe(false)
  })

  it('on success: signed in, account label, expiry, plan usage; the listener is closed; no token in the status', async () => {
    const t = setup()
    await signIn(t)
    const status = await t.login.status('prov_1', 'provider:prov_1')
    expect(status).toEqual({
      channel: 'openai-chatgpt',
      state: 'signed_in',
      account: { label: 'me@example.com' },
      expiresAt: new Date(T0 + 3600_000).toISOString(),
      planUsage: true,
    })
    expect(t.listeners.every((l) => l.closed)).toBe(true)
    const record = JSON.parse(t.store.get('provider:prov_1')!)
    expect(record).toMatchObject({
      clientId: CLIENT,
      subject: 'user-1',
      issuer: OPENAI_LOGIN.issuer,
      planUsage: true,
    })
    expect(record.hostId).toMatch(/^urn:uuid:/)
    expect(record).not.toHaveProperty('idToken') // the ID token is verified, then not kept
    expect(t.store.get('provider:prov_1')).not.toContain('eyJ')
    for (const secret of ['ACCESS-1', 'REFRESH-1'])
      expect(JSON.stringify(status)).not.toContain(secret)
    expect(await t.login.accessToken(t.config)).toBe('ACCESS-1')
  })

  const failures: Array<{
    name: string
    code: OpenAiLoginErrorCode
    params: (q: URLSearchParams) => Record<string, string>
    reply?: (q: URLSearchParams) => ReturnType<Ctx['world']['tokenReply']>
    exchanged: boolean
  }> = [
    {
      name: 'user denies consent',
      code: 'user_denied',
      params: (q) => ({ error: 'access_denied', state: q.get('state')! }),
      exchanged: false,
    },
    {
      name: 'some other authorization error',
      code: 'authorization_error',
      params: (q) => ({ error: 'server_error', state: q.get('state')! }),
      exchanged: false,
    },
    {
      name: 'no code',
      code: 'no_code',
      params: (q) => ({ state: q.get('state')!, client_id: CLIENT }),
      exchanged: false,
    },
    {
      name: 'registration did not return the issued client id',
      code: 'registration_incomplete',
      params: (q) => ({ code: 'C', state: q.get('state')! }),
      exchanged: false,
    },
    {
      name: 'code rejected by the token endpoint',
      code: 'invalid_grant',
      params: (q) => ({ code: 'C', state: q.get('state')!, client_id: CLIENT }),
      reply: () => ({ status: 400, body: { error: 'invalid_grant' } }),
      exchanged: true,
    },
    {
      name: 'nonce does not match',
      code: 'nonce_mismatch',
      params: (q) => ({ code: 'C', state: q.get('state')!, client_id: CLIENT }),
      reply: () => goodTokens({}, { nonce: 'SOMEONE-ELSES' }),
      exchanged: true,
    },
    {
      name: 'signature is wrong (forged with another key)',
      code: 'bad_signature',
      params: (q) => ({ code: 'C', state: q.get('state')!, client_id: CLIENT }),
      reply: (q) => ({
        body: { ...goodTokens().body, id_token: idToken({ nonce: q.get('nonce') }, OTHER_KEY) },
      }),
      exchanged: true,
    },
    {
      name: 'alg is not RS256',
      code: 'bad_signature',
      params: (q) => ({ code: 'C', state: q.get('state')!, client_id: CLIENT }),
      reply: (q) => ({
        body: {
          ...goodTokens().body,
          id_token: idToken({ nonce: q.get('nonce') }, KEY, { alg: 'HS256', kid: 'k1' }),
        },
      }),
      exchanged: true,
    },
    {
      name: 'audience is another client',
      code: 'audience_mismatch',
      params: (q) => ({ code: 'C', state: q.get('state')!, client_id: CLIENT }),
      reply: (q) => goodTokens({}, { nonce: q.get('nonce'), aud: 'oaiapp_someone_else' }),
      exchanged: true,
    },
    {
      name: 'issuer is wrong',
      code: 'issuer_mismatch',
      params: (q) => ({ code: 'C', state: q.get('state')!, client_id: CLIENT }),
      reply: (q) => goodTokens({}, { nonce: q.get('nonce'), iss: 'https://evil.example' }),
      exchanged: true,
    },
    {
      name: 'ID token is expired',
      code: 'expired',
      params: (q) => ({ code: 'C', state: q.get('state')!, client_id: CLIENT }),
      reply: (q) => goodTokens({}, { nonce: q.get('nonce'), exp: T0 / 1000 - 3600 }),
      exchanged: true,
    },
    {
      name: 'ID token is garbage',
      code: 'bad_id_token',
      params: (q) => ({ code: 'C', state: q.get('state')!, client_id: CLIENT }),
      reply: () => ({ body: { ...goodTokens().body, id_token: 'not.a.jwt!' } }),
      exchanged: true,
    },
  ]
  for (const f of failures) {
    it(`rejects: ${f.name}, and saves nothing`, async () => {
      const t = setup()
      const { q } = await begin(t)
      t.world.tokenReply = f.reply
        ? () => f.reply!(q)
        : () => goodTokens({}, { nonce: q.get('nonce') })
      const res = await t.callback(f.params(q))
      expect(res).toEqual({ ok: false, error: f.code })
      expect(t.world.tokenRequests.length > 0).toBe(f.exchanged)
      expect(t.store.has('provider:prov_1')).toBe(false)
      const status = await t.login.status('prov_1', 'provider:prov_1')
      expect(status.state).toBe('signed_out')
      expect(status.lastError?.code).toBe(f.code)
      expect(t.listeners.every((l) => l.closed)).toBe(true) // the listener is closed after a failure too
    })
  }

  it('without the plan-usage scope the account is signed in but nothing can be called', async () => {
    const t = setup()
    const { q } = await begin(t)
    withNonce(t, q, { scope: 'openid profile email offline_access resource.invoke' })
    expect(await t.callback({ code: 'C', state: q.get('state')!, client_id: CLIENT })).toEqual({
      ok: true,
    })
    const status = await t.login.status('prov_1', 'provider:prov_1')
    expect(status).toMatchObject({ state: 'signed_in', planUsage: false })
    const err = await t.login.accessToken(t.config).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LoginRequiredError)
    expect((err as LoginRequiredError).reason).toBe('plan_usage_not_granted')
  })

  it('a callback that arrives after cancel is refused; cancel closes the listener', async () => {
    const t = setup()
    const { q } = await begin(t)
    expect(t.login.cancel('prov_1')).toBe(true)
    expect(t.listeners[0]!.closed).toBe(true)
    expect(await t.callback({ code: 'C', state: q.get('state')!, client_id: CLIENT })).toEqual({
      ok: false,
      error: 'cancelled',
    })
    expect(t.world.tokenRequests).toHaveLength(0)
    expect(t.login.cancel('prov_1')).toBe(false)
  })

  it('times out and closes the listener', async () => {
    const t = setup({ loginTimeoutMs: 20 })
    await begin(t)
    expect((await t.login.status('prov_1', 'provider:prov_1')).state).toBe('pending')
    await new Promise((r) => setTimeout(r, 60))
    const status = await t.login.status('prov_1', 'provider:prov_1')
    expect(status.state).toBe('signed_out')
    expect(status.lastError?.code).toBe('timeout')
    expect(t.listeners[0]!.closed).toBe(true)
  })
})

describe('OpenAI login: a request that is not the real callback cannot end the login', () => {
  it('a callback with the wrong state is refused with 400 only: the login keeps waiting, and the real callback still succeeds', async () => {
    const t = setup()
    const { q } = await begin(t)
    expect(await t.callback({ code: 'FORGED', state: 'FORGED-STATE', client_id: CLIENT })).toEqual({
      ok: false,
      error: 'state_mismatch',
    })
    expect(await t.callback({ error: 'access_denied', state: 'FORGED-STATE' })).toEqual({
      ok: false,
      error: 'state_mismatch',
    })
    // nothing was exchanged, nothing ended
    expect(t.world.tokenRequests).toHaveLength(0)
    expect(t.listeners[0]!.closed).toBe(false)
    const waiting = await t.login.status('prov_1', 'provider:prov_1')
    expect(waiting.state).toBe('pending')
    expect(waiting.lastError).toBeUndefined()
    expect(t.events.some((e) => e.event === 'login.callback_ignored')).toBe(true)
    // the real callback arrives afterwards
    withNonce(t, q)
    expect(await t.callback({ code: 'CODE', state: q.get('state')!, client_id: CLIENT })).toEqual({
      ok: true,
    })
    expect((await t.login.status('prov_1', 'provider:prov_1')).state).toBe('signed_in')
    expect(t.listeners[0]!.closed).toBe(true)
  })

  it('cancelling (or timing out) while the code exchange is in flight saves no credentials', async () => {
    for (const how of ['cancel', 'timeout'] as const) {
      const t = setup({ loginTimeoutMs: how === 'timeout' ? 30 : undefined })
      const { q } = await begin(t)
      withNonce(t, q)
      let release!: () => void
      t.world.tokenGate = new Promise<void>((r) => (release = r))
      const pending = t.callback({ code: 'CODE', state: q.get('state')!, client_id: CLIENT })
      await new Promise((r) => setTimeout(r, 5))
      expect(t.world.tokenRequests).toHaveLength(1) // the exchange has started
      if (how === 'cancel') t.login.cancel('prov_1')
      else await new Promise((r) => setTimeout(r, 60))
      release()
      expect(await pending, how).toEqual({ ok: false, error: 'cancelled' })
      expect(t.store.has('provider:prov_1'), how).toBe(false)
      const status = await t.login.status('prov_1', 'provider:prov_1')
      expect(status.state, how).toBe('signed_out')
      // a cancelled attempt is not reported as an error; a timeout is
      expect(status.lastError?.code, how).toBe(how === 'timeout' ? 'timeout' : undefined)
    }
  })

  it('a stale attempt cannot end a newer one', async () => {
    const t = setup()
    const first = await begin(t)
    withNonce(t, first.q)
    let release!: () => void
    t.world.tokenGate = new Promise<void>((r) => (release = r))
    const stale = t.callback({ code: 'CODE', state: first.q.get('state')!, client_id: CLIENT })
    await new Promise((r) => setTimeout(r, 5))
    const second = await begin(t) // the user clicked again; this cancels the first
    release()
    expect(await stale).toEqual({ ok: false, error: 'cancelled' })
    const status = await t.login.status('prov_1', 'provider:prov_1')
    expect(status.state).toBe('pending') // the new attempt is untouched
    expect(t.listeners[1]!.closed).toBe(false)
    expect(second.q.get('state')).not.toBe(first.q.get('state'))
  })
})

describe('OpenAI login: signing keys come from the discovery document', () => {
  it('uses the jwks_uri it advertises (same origin, https), caching the document', async () => {
    const t = setup()
    t.world.discoveryDoc = {
      issuer: OPENAI_LOGIN.issuer,
      jwks_uri: 'https://auth.openai.com/rotated/keys',
      revocation_endpoint: OPENAI_LOGIN.revokeUrl,
    }
    await signIn(t)
    expect(t.world.jwksPaths).toEqual(['https://auth.openai.com/rotated/keys'])
  })

  it('falls back to the documented address when the document is untrustworthy: other issuer, http, another origin, unreachable', async () => {
    const bad: Array<Record<string, unknown> | 'down'> = [
      { issuer: 'https://evil.example', jwks_uri: 'https://auth.openai.com/rotated/keys' },
      { issuer: OPENAI_LOGIN.issuer, jwks_uri: 'http://auth.openai.com/rotated/keys' },
      { issuer: OPENAI_LOGIN.issuer, jwks_uri: 'https://evil.example/keys' },
      { issuer: OPENAI_LOGIN.issuer, jwks_uri: 'not a url' },
      { issuer: OPENAI_LOGIN.issuer },
      'down',
    ]
    for (const doc of bad) {
      const t = setup()
      if (doc === 'down') t.world.discoveryDown = true
      else t.world.discoveryDoc = doc
      await signIn(t)
      expect(t.world.jwksPaths, JSON.stringify(doc)).toEqual([OPENAI_LOGIN.jwksUrl])
    }
  })
})

describe('OpenAI login: the access token only ever goes to the public API', () => {
  const login = { type: 'account_login' as const, channel: 'openai-chatgpt' as const }
  const cfg = (extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
    ...setup().config,
    auth: login,
    ...extra,
  })

  it('accepts exactly https://api.openai.com/v1 (normalized) with the responses protocol', () => {
    for (const ok of [
      'https://api.openai.com/v1',
      'https://api.openai.com/v1/',
      'HTTPS://API.OPENAI.COM/v1',
      ' https://api.openai.com/v1 ',
    ]) {
      expect(isAllowedLoginBaseUrl('openai-chatgpt', ok), ok).toBe(true)
    }
    for (const bad of [
      'http://api.openai.com/v1',
      'https://api.openai.com',
      'https://api.openai.com/v2',
      'https://api.openai.com/v1/evil',
      'https://api.openai.com.evil.example/v1',
      'https://evil.example/https://api.openai.com/v1',
      'https://user:pw@api.openai.com/v1',
      'https://api.openai.com@evil.example/v1',
      'https://api.openai.com:8443/v1',
      'https://api.openai.com/v1?x=1',
      'https://api.openai.com/v1#x',
      'https://127.0.0.1:8788',
      'https://api.deepseek.com',
      '',
      'not a url',
    ]) {
      expect(isAllowedLoginBaseUrl('openai-chatgpt', bad), bad).toBe(false)
    }
  })

  it('a stored provider that points anywhere else never gets a token: nothing is read, refreshed or sent', async () => {
    const t = setup()
    await signIn(t)
    const before = t.world.tokenRequests.length
    for (const evil of [
      { baseUrl: 'https://evil.example/v1' },
      { baseUrl: 'http://127.0.0.1:9/v1' },
      { protocol: 'openai-chat' as const },
    ]) {
      const config = { ...t.config, ...evil }
      const err = await t.login.accessToken(config).catch((e: unknown) => e)
      expect((err as ProviderError).code, JSON.stringify(evil)).toBe('LOGIN_ENDPOINT_NOT_ALLOWED')
      expect(() => assertLoginEndpoint('openai-chatgpt', config)).toThrow()
    }
    expect(t.world.tokenRequests).toHaveLength(before)
    expect(cfg().baseUrl).toBe(OPENAI_LOGIN.resource) // the test fixture itself is valid
  })
})

describe('OpenAI login: refresh', () => {
  it('returns the cached token while it is valid and does not call the token endpoint', async () => {
    const t = setup()
    await signIn(t)
    t.world.now = T0 + 30 * 60_000
    expect(await t.login.accessToken(t.config)).toBe('ACCESS-1')
    expect(t.world.tokenRequests).toHaveLength(1) // only the code exchange
  })

  it('refreshes near expiry with the documented request and replaces everything together (rotation)', async () => {
    const t = setup()
    await signIn(t)
    t.world.now = T0 + 3600_000 - 60_000 // inside the 2-minute margin
    t.world.tokenReply = () => ({
      body: {
        access_token: 'ACCESS-2',
        refresh_token: 'REFRESH-2',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: OPENAI_LOGIN.scope,
      },
    })
    expect(await t.login.accessToken(t.config)).toBe('ACCESS-2')
    const form = t.world.tokenRequests.at(-1)!
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'refresh_token',
      client_id: CLIENT, // the issued client id, not dynamic_agent_client
      refresh_token: 'REFRESH-1',
      resource: 'https://api.openai.com/v1',
    }) // and no scope: the existing grant is kept
    const record = JSON.parse(t.store.get('provider:prov_1')!)
    expect(record).toMatchObject({
      accessToken: 'ACCESS-2',
      refreshToken: 'REFRESH-2',
      expiresAt: t.world.now + 3600_000,
    })
    // the next refresh uses the rotated token
    t.world.now += 3600_000
    await t.login.accessToken(t.config)
    expect(t.world.tokenRequests.at(-1)!.get('refresh_token')).toBe('REFRESH-2')
  })

  it('an already expired token is refreshed too', async () => {
    const t = setup()
    await signIn(t)
    t.world.now = T0 + 5 * 3600_000
    t.world.tokenReply = () => ({
      body: {
        access_token: 'ACCESS-9',
        refresh_token: 'REFRESH-9',
        expires_in: 3600,
        scope: OPENAI_LOGIN.scope,
      },
    })
    expect(await t.login.accessToken(t.config)).toBe('ACCESS-9')
  })

  it('concurrent callers share one refresh request', async () => {
    const t = setup()
    await signIn(t)
    t.world.now = T0 + 3600_000
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const before = t.world.tokenRequests.length
    t.world.tokenReply = () => ({
      body: {
        access_token: 'ACCESS-C',
        refresh_token: 'REFRESH-C',
        expires_in: 3600,
        scope: OPENAI_LOGIN.scope,
      },
    })
    // hold the token endpoint until all callers are waiting
    const original = t.world.tokenReply
    const results = Promise.all(Array.from({ length: 8 }, () => t.login.accessToken(t.config)))
    await Promise.resolve()
    release()
    await gate
    t.world.tokenReply = original
    expect(new Set(await results)).toEqual(new Set(['ACCESS-C']))
    expect(t.world.tokenRequests.length - before).toBe(1)
  })

  it('a refresh token the server no longer accepts is "login required", clears the tokens and keeps the registration', async () => {
    for (const error of [
      'invalid_grant',
      'refresh_token_reused',
      'refresh_token_expired',
      'refresh_token_invalidated',
      'invalid_refresh_token',
      'token_expired',
    ]) {
      const t = setup()
      await signIn(t)
      t.world.now = T0 + 3600_000
      t.world.tokenReply = () => ({ status: 400, body: { error } })
      const err = await t.login.accessToken(t.config).catch((e: unknown) => e)
      expect(err, error).toBeInstanceOf(LoginRequiredError)
      expect((err as LoginRequiredError).code).toBe('LOGIN_REQUIRED')
      expect((err as LoginRequiredError).reason).toBe('refresh_failed')
      const record = JSON.parse(t.store.get('provider:prov_1')!)
      expect(record.accessToken).toBeUndefined()
      expect(record.refreshToken).toBeUndefined()
      expect(record).toMatchObject({ clientId: CLIENT, subject: 'user-1', needsRelogin: true })
      expect(await t.login.status('prov_1', 'provider:prov_1')).toMatchObject({
        state: 'needs_relogin',
        account: { label: 'me@example.com' },
      })
    }
  })

  it('a temporary failure (network, 5xx) is an ordinary error and keeps the credentials', async () => {
    const t = setup()
    await signIn(t)
    t.world.now = T0 + 3600_000
    t.world.tokenReply = () => ({ status: 503, body: {} })
    const err = await t.login.accessToken(t.config).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err).not.toBeInstanceOf(LoginRequiredError)
    expect((err as ProviderError).code).toBe('LOGIN_REFRESH_UNAVAILABLE')
    expect(JSON.parse(t.store.get('provider:prov_1')!).refreshToken).toBe('REFRESH-1')
    // and it recovers
    t.world.tokenReply = () => ({
      body: {
        access_token: 'ACCESS-R',
        refresh_token: 'REFRESH-R',
        expires_in: 3600,
        scope: OPENAI_LOGIN.scope,
      },
    })
    expect(await t.login.accessToken(t.config)).toBe('ACCESS-R')
  })

  it('invalid_client is reported as a configuration problem and does not wipe the login', async () => {
    const t = setup()
    await signIn(t)
    t.world.now = T0 + 3600_000
    t.world.tokenReply = () => ({ status: 401, body: { error: 'invalid_client' } })
    const err = await t.login.accessToken(t.config).catch((e: unknown) => e)
    expect((err as ProviderError).code).toBe('LOGIN_INVALID_CLIENT')
    expect((err as ProviderError).message).toContain('重新登录')
    expect(JSON.parse(t.store.get('provider:prov_1')!).refreshToken).toBe('REFRESH-1')
    expect((await t.login.status('prov_1', 'provider:prov_1')).lastError?.code).toBe(
      'refresh_rejected',
    )
  })

  it('a refusal that is neither temporary nor in the documented list keeps the credentials, but says plainly that signing in again may help, in the error and in the status', async () => {
    const t = setup()
    await signIn(t)
    t.world.now = T0 + 3600_000
    t.world.tokenReply = () => ({ status: 400, body: { error: 'some_new_error' } })
    const err = await t.login.accessToken(t.config).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err).not.toBeInstanceOf(LoginRequiredError)
    expect((err as ProviderError).code).toBe('LOGIN_REFRESH_REJECTED')
    expect((err as ProviderError).message).toContain('可以尝试重新登录')
    expect(JSON.parse(t.store.get('provider:prov_1')!).refreshToken).toBe('REFRESH-1') // not wiped
    const status = await t.login.status('prov_1', 'provider:prov_1')
    expect(status.state).toBe('signed_in')
    expect(status.lastError).toMatchObject({ code: 'refresh_rejected' })
    expect(status.lastError!.message).toContain('可以尝试重新登录')
    // a later success clears the hint
    t.world.tokenReply = () => ({
      body: {
        access_token: 'ACCESS-OK',
        refresh_token: 'REFRESH-OK',
        expires_in: 3600,
        scope: OPENAI_LOGIN.scope,
      },
    })
    expect(await t.login.accessToken(t.config)).toBe('ACCESS-OK')
    expect((await t.login.status('prov_1', 'provider:prov_1')).lastError).toBeUndefined()
  })

  it('never signed in: login required (not_signed_in)', async () => {
    const t = setup()
    const err = await t.login.accessToken(t.config).catch((e: unknown) => e)
    expect((err as LoginRequiredError).reason).toBe('not_signed_in')
  })
})

describe('OpenAI login: signing in again', () => {
  it('re-authorizes with the saved client id, no agent_name_hint, a login_hint, and the same account replaces the credentials', async () => {
    const t = setup()
    await signIn(t)
    const { q } = await begin(t)
    expect(q.get('client_id')).toBe(CLIENT)
    expect(q.has('agent_name_hint')).toBe(false)
    expect(q.get('login_hint')).toBe('me@example.com')
    expect(q.has('id_token_hint')).toBe(false) // the ID token never leaves the server
    withNonce(t, q, { access_token: 'ACCESS-NEW', refresh_token: 'REFRESH-NEW' })
    expect(await t.callback({ code: 'C2', state: q.get('state')! })).toEqual({ ok: true }) // reauthorization may omit client_id
    expect(await t.login.accessToken(t.config)).toBe('ACCESS-NEW')
  })

  it('a different account on re-authorization is rejected and the saved credentials stay untouched', async () => {
    const t = setup()
    await signIn(t)
    const before = t.store.get('provider:prov_1')
    const { q } = await begin(t)
    withNonce(t, q, { access_token: 'ACCESS-OTHER' }, { sub: 'user-2', email: 'other@example.com' })
    expect(await t.callback({ code: 'C2', state: q.get('state')!, client_id: CLIENT })).toEqual({
      ok: false,
      error: 'account_mismatch',
    })
    expect(t.store.get('provider:prov_1')).toBe(before)
  })

  it('a callback that names another client id on re-authorization is rejected', async () => {
    const t = setup()
    await signIn(t)
    const { q } = await begin(t)
    withNonce(t, q)
    expect(
      await t.callback({ code: 'C2', state: q.get('state')!, client_id: 'oaiapp_other' }),
    ).toEqual({ ok: false, error: 'client_mismatch' })
  })

  it('switching accounts registers again, and the old refresh token is revoked once the new login succeeded', async () => {
    const t = setup()
    await signIn(t)
    const { q } = await begin(t, { account: 'new' })
    expect(q.get('client_id')).toBe('dynamic_agent_client')
    expect(q.get('agent_name_hint')).toBe('dramai')
    expect(q.has('login_hint')).toBe(false)
    withNonce(
      t,
      q,
      { access_token: 'ACCESS-B', refresh_token: 'REFRESH-B' },
      { sub: 'user-2', email: 'b@example.com', aud: 'oaiapp_new_client' },
    )
    expect(
      await t.callback({ code: 'C3', state: q.get('state')!, client_id: 'oaiapp_new_client' }),
    ).toEqual({ ok: true })
    expect(t.world.revokeRequests.map((r) => r.get('token'))).toEqual(['REFRESH-1'])
    expect(JSON.parse(t.store.get('provider:prov_1')!)).toMatchObject({
      clientId: 'oaiapp_new_client',
      subject: 'user-2',
    })
  })
})

describe('OpenAI login: sign out', () => {
  it('revokes the refresh token at the documented endpoint, clears the tokens, keeps the registration', async () => {
    const t = setup()
    await signIn(t)
    expect(await t.login.logout('prov_1', 'provider:prov_1')).toEqual({ revoked: 'confirmed' })
    expect(Object.fromEntries(t.world.revokeRequests[0]!)).toEqual({
      token: 'REFRESH-1',
      token_type_hint: 'refresh_token',
      client_id: CLIENT,
    })
    const record = JSON.parse(t.store.get('provider:prov_1')!)
    expect(record.accessToken).toBeUndefined()
    expect(record.refreshToken).toBeUndefined()
    expect(record.idToken).toBeUndefined()
    expect(record).toMatchObject({ clientId: CLIENT, subject: 'user-1', email: 'me@example.com' })
    expect(await t.login.status('prov_1', 'provider:prov_1')).toMatchObject({
      state: 'signed_out',
      account: { label: 'me@example.com' },
    })
    // signing in afterwards reuses the registration
    const { q } = await begin(t)
    expect(q.get('client_id')).toBe(CLIENT)
  })

  it('retries a failing revoke, and tells the truth when it could not be confirmed (tokens are cleared anyway)', async () => {
    const t = setup()
    await signIn(t)
    t.world.revokeStatus = [503, 503, 503]
    expect(await t.login.logout('prov_1', 'provider:prov_1')).toEqual({ revoked: 'unconfirmed' })
    expect(t.world.revokeRequests).toHaveLength(3)
    expect(JSON.parse(t.store.get('provider:prov_1')!).refreshToken).toBeUndefined()
    const u = setup()
    await signIn(u)
    u.world.revokeStatus = [503, 200]
    expect(await u.login.logout('prov_1', 'provider:prov_1')).toEqual({ revoked: 'confirmed' })
  })

  it('logging out while a login is pending cancels it; logging out when never signed in is a no-op', async () => {
    const t = setup()
    await begin(t)
    expect(await t.login.logout('prov_1', 'provider:prov_1')).toEqual({
      revoked: 'nothing_to_revoke',
    })
    expect(t.listeners[0]!.closed).toBe(true)
  })
})

describe('OpenAI login: nothing secret leaks', () => {
  it('no token, code, verifier or state appears in the status, the authorization URL or the log events', async () => {
    const t = setup()
    const { started, q } = await begin(t)
    withNonce(t, q)
    await t.callback({ code: 'SECRET-CODE', state: q.get('state')!, client_id: CLIENT })
    await t.login.logout('prov_1', 'provider:prov_1')
    const status = await t.login.status('prov_1', 'provider:prov_1')
    const verifier = t.world.tokenRequests[0]!.get('code_verifier')!
    const haystack = JSON.stringify({ status, events: t.events, url: started.authorizationUrl })
    for (const secret of ['ACCESS-1', 'REFRESH-1', 'SECRET-CODE', verifier, 'eyJ'])
      expect(haystack, secret).not.toContain(secret)
  })
})
