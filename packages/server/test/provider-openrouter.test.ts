import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { OPENROUTER_LOGIN } from '@dramai/core'
import { createLoopbackListenerFactory } from '../src/login/loopback.ts'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

const KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'

async function boot() {
  const exchanges: Array<Record<string, string>> = []
  const logs: unknown[][] = []
  const upstream: Array<{ url: string; auth?: string; body?: Record<string, unknown> }> = []
  const h = await startServer({
    startWorker: false,
    logger: { error: (...a) => logs.push(a), info: (...a) => logs.push(a) },
    login: {
      listen: createLoopbackListenerFactory(),
      fetch: async (url, init) => {
        if (url !== OPENROUTER_LOGIN.exchangeUrl) throw new Error(`unexpected ${url}`)
        exchanges.push(JSON.parse(String(init?.body)) as Record<string, string>)
        return new Response(JSON.stringify({ key: KEY }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
    executor: {
      fetch: (async (url: string, init?: RequestInit) => {
        upstream.push({
          url,
          auth: (init?.headers as Record<string, string>)?.Authorization,
          body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
        })
        if (url.endsWith('/models'))
          return new Response(JSON.stringify({ data: [{ id: 'anthropic/claude-sonnet-5.5' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        const ev = (d: unknown) => `data: ${JSON.stringify(d)}\n\n`
        return new Response(
          `: OPENROUTER PROCESSING\n\n${ev({ choices: [{ delta: { reasoning: 'x' } }] })}${ev({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}data: [DONE]\n\n`,
          { status: 200 },
        )
      }) as never,
    },
  })
  return { h, exchanges, logs, upstream }
}
type B = Awaited<ReturnType<typeof boot>>

const create = (b: B) =>
  b.h.client.call('providers.fromPreset', { body: { presetId: 'openrouter-login' } })
async function signIn(b: B) {
  const p = await create(b)
  const started = await b.h.client.call('providers.login.start', {
    params: { providerId: p.id },
    body: {},
  })
  const q = new URL(started.authorizationUrl).searchParams
  const cb = new URL(started.redirectUri)
  cb.searchParams.set('code', 'THE-CODE')
  cb.searchParams.set('state', q.get('state')!)
  const res = await fetch(cb)
  return { p, res, started, q }
}

describe('OpenRouter account sign-in through the API', () => {
  it('the preset is an account-login provider (documented only, not auto-selected), text, pinned to OpenRouter', async () => {
    const b = await boot()
    const p = await create(b)
    expect(p).toMatchObject({
      auth: { type: 'account_login', channel: 'openrouter' },
      protocol: 'openai-chat',
      baseUrl: 'https://openrouter.ai/api/v1',
      hasKey: false,
      verification: { status: 'documented' },
      login: { channel: 'openrouter', state: 'signed_out', availability: { available: true } },
    })
    expect((await b.h.client.call('settings.get')).activeProviders.llm).toBeUndefined()
    await expect(
      b.h.client.call('providers.update', {
        params: { providerId: p.id },
        body: { baseUrl: 'https://evil.example/api/v1' },
      }),
    ).rejects.toMatchObject({ code: 'AUTH_NOT_ALLOWED' })
    await expect(
      b.h.client.call('providers.create', {
        body: {
          label: 'x',
          kind: 'llm',
          protocol: 'openai-responses',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'm',
          auth: { type: 'account_login', channel: 'openrouter' },
        },
      }),
    ).rejects.toMatchObject({ code: 'AUTH_NOT_ALLOWED' })
    await expect(
      b.h.client.call('providers.setKey', {
        params: { providerId: p.id },
        body: { apiKey: 'sk-x-1234567890' },
      }),
    ).rejects.toMatchObject({ code: 'KEY_NOT_APPLICABLE' })
  })

  it('start → browser callback on localhost → signed in; the status says the key came from sign-in, and no key is in any response or log', async () => {
    const b = await boot()
    const { p, res, started, q } = await signIn(b)
    expect(new URL(started.redirectUri).hostname).toBe('localhost')
    expect(started.authorizationUrl.startsWith('https://openrouter.ai/auth?')).toBe(true)
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(res.status).toBe(200)
    expect(b.exchanges[0]).toMatchObject({ code: 'THE-CODE', code_challenge_method: 'S256' })

    const status = await b.h.client.call('providers.login.status', { params: { providerId: p.id } })
    expect(status).toMatchObject({
      channel: 'openrouter',
      state: 'signed_in',
      credential: { kind: 'api_key', mask: expect.stringContaining('…') },
      manageUrl: `https://openrouter.ai/keys/${createHash('sha256').update(KEY).digest('hex')}`,
    })
    expect(status.planUsage).toBeUndefined()
    expect(status.expiresAt).toBeUndefined()
    const seen = JSON.stringify([
      status,
      await b.h.client.call('providers.list'),
      await b.h.client.call('providers.get', { params: { providerId: p.id } }),
      b.logs,
    ])
    expect(seen).not.toContain(KEY)
    expect(seen).not.toContain('THE-CODE')
    // the listener is gone afterwards
    await expect(fetch(started.redirectUri)).rejects.toThrow()
  })

  it('afterwards the provider is called exactly like an API key provider: Bearer key, chat completions, reasoning dropped, comment lines ignored', async () => {
    const b = await boot()
    const { p } = await signIn(b)
    await b.h.server.ctx.settings.patchActive('llm', p.id)
    const out = await b.h.server.ctx.deps.llm.complete({
      task: 't',
      messages: [{ role: 'user', content: 'u' }],
    })
    expect(out.text).toBe('ok')
    const call = b.upstream.find((u) => u.url === 'https://openrouter.ai/api/v1/chat/completions')!
    expect(call.auth).toBe(`Bearer ${KEY}`)
    expect(await b.h.client.call('providers.test', { params: { providerId: p.id } })).toMatchObject(
      { outcome: 'ok' },
    )
    expect(
      (await b.h.client.call('providers.models', { params: { providerId: p.id } })).items,
    ).toEqual([{ id: 'anthropic/claude-sonnet-5.5', label: 'anthropic/claude-sonnet-5.5' }])
  })

  it('a forged callback (wrong state) is refused with 400 and does not end the login; the real one still works', async () => {
    const b = await boot()
    const p = await create(b)
    const started = await b.h.client.call('providers.login.start', {
      params: { providerId: p.id },
      body: {},
    })
    const q = new URL(started.authorizationUrl).searchParams
    const forged = new URL(started.redirectUri)
    forged.searchParams.set('code', 'X')
    forged.searchParams.set('state', 'FORGED')
    expect((await fetch(forged)).status).toBe(400)
    expect(
      (await b.h.client.call('providers.login.status', { params: { providerId: p.id } })).state,
    ).toBe('pending')
    expect(b.exchanges).toHaveLength(0)
    const real = new URL(started.redirectUri)
    real.searchParams.set('code', 'C')
    real.searchParams.set('state', q.get('state')!)
    expect((await fetch(real)).status).toBe(200)
    expect(
      (await b.h.client.call('providers.login.status', { params: { providerId: p.id } })).state,
    ).toBe('signed_in')
  })

  it('cancel closes the listener; sign-in from another machine is refused', async () => {
    const b = await boot()
    const p = await create(b)
    const started = await b.h.client.call('providers.login.start', {
      params: { providerId: p.id },
      body: {},
    })
    expect(
      (await b.h.client.call('providers.login.cancel', { params: { providerId: p.id } })).state,
    ).toBe('signed_out')
    await expect(fetch(started.redirectUri)).rejects.toThrow()
    await expect(
      b.h.server.ctx.providers.loginStart(p.id, {}, { host: 'dramai.example.com' }),
    ).rejects.toMatchObject({ code: 'LOGIN_UNAVAILABLE_REMOTE' })
  })

  it('logout clears the local key and says plainly that OpenRouter has no revoke call: unconfirmed, with the page to invalidate the key', async () => {
    const b = await boot()
    const { p } = await signIn(b)
    const out = await b.h.client.call('providers.login.logout', { params: { providerId: p.id } })
    expect(out).toMatchObject({ revoked: 'unconfirmed', status: { state: 'signed_out' } })
    expect(out.manageUrl).toBe(
      `https://openrouter.ai/keys/${createHash('sha256').update(KEY).digest('hex')}`,
    )
    expect(await b.h.server.ctx.secrets.get(`provider:${p.id}`)).toBeUndefined()
    expect(b.exchanges).toHaveLength(1) // no other request went to OpenRouter's login service
    // and the provider is "login required" again
    await b.h.server.ctx.settings.patchActive('llm', p.id)
    await expect(
      b.h.server.ctx.deps.llm.complete({ task: 't', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' })
  })

  it('deleting the provider removes the key too', async () => {
    const b = await boot()
    const { p } = await signIn(b)
    await b.h.client.call('providers.delete', { params: { providerId: p.id } })
    expect(await b.h.server.ctx.secrets.get(`provider:${p.id}`)).toBeUndefined()
  })
})
