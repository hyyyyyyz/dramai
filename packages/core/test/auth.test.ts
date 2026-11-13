import { describe, expect, it } from 'vitest'
import {
  createCredentialResolver,
  effectiveAuth,
  LoginRequiredError,
} from '../src/providers/auth.ts'
import type { LoginChannel } from '../src/providers/auth.ts'
import { ProviderError, toJobError } from '../src/providers/errors.ts'
import { authFor } from '../src/pipeline/deps.ts'
import type { ProviderConfig } from '../src/providers/types.ts'

const cfg = (extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'p1',
  label: 'x',
  kind: 'llm',
  protocol: 'openai-chat',
  baseUrl: 'https://api.example.com/v1',
  model: 'm',
  enabled: true,
  ...extra,
})
const secrets = (values: Record<string, string>) => ({
  get: async (ref: string) => values[ref],
  set: async () => {},
  delete: async () => {},
  has: async (ref: string) => ref in values,
})

describe('effectiveAuth: old data without an auth field', () => {
  it('has a key → api_key; no key → none; an explicit auth always wins', () => {
    expect(effectiveAuth(cfg({ secretRef: 'provider:p1' }))).toEqual({ type: 'api_key' })
    expect(effectiveAuth(cfg())).toEqual({ type: 'none' })
    expect(effectiveAuth(cfg({ auth: { type: 'none' }, secretRef: 'provider:p1' }))).toEqual({
      type: 'none',
    })
    expect(
      effectiveAuth(cfg({ auth: { type: 'account_login', channel: 'openai-chatgpt' } })),
    ).toEqual({ type: 'account_login', channel: 'openai-chatgpt' })
  })
})

describe('credential resolution', () => {
  it('api key: read from the secret store; none: no bearer; old config unchanged', async () => {
    const deps = { secrets: secrets({ 'provider:p1': 'sk-123' }) }
    const a = await authFor(deps, cfg({ secretRef: 'provider:p1' }))
    expect(a).toMatchObject({
      apiKey: 'sk-123',
      method: 'api_key',
      baseUrl: 'https://api.example.com/v1',
    })
    const b = await authFor(deps, cfg())
    expect(b.apiKey).toBeUndefined()
    expect(b.method).toBe('none')
  })

  it('account login: the channel supplies the access token', async () => {
    const calls: string[] = []
    const channel: LoginChannel = {
      id: 'openai-chatgpt',
      accessToken: async (c) => {
        calls.push(c.id)
        return 'access-token-1'
      },
    }
    const credentials = createCredentialResolver({
      secrets: secrets({}),
      channels: { 'openai-chatgpt': channel },
    })
    const config = cfg({
      protocol: 'openai-responses',
      auth: { type: 'account_login', channel: 'openai-chatgpt' },
    })
    expect(await authFor({ secrets: secrets({}), credentials }, config)).toMatchObject({
      apiKey: 'access-token-1',
      method: 'account_login',
      channel: 'openai-chatgpt',
    })
    expect(calls).toEqual(['p1'])
  })

  it('account login without a channel, or on a non-text protocol, fails clearly', async () => {
    const config = cfg({
      protocol: 'openai-responses',
      auth: { type: 'account_login', channel: 'openai-chatgpt' },
    })
    await expect(authFor({ secrets: secrets({}) }, config)).rejects.toBeInstanceOf(
      LoginRequiredError,
    )
    const media = cfg({
      kind: 'image',
      protocol: 'openai-images',
      auth: { type: 'account_login', channel: 'openai-chatgpt' },
    })
    const err = await authFor({ secrets: secrets({}) }, media).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).code).toBe('LOGIN_TEXT_ONLY')
  })

  it('"login required" is its own error, not a network error, and maps to a user-fixable job failure', () => {
    const err = new LoginRequiredError('openai-chatgpt', 'refresh_failed', '需要重新登录')
    expect(err.kind).toBe('auth')
    expect(err.code).toBe('LOGIN_REQUIRED')
    expect(toJobError(err)).toMatchObject({ category: 'invalid_input', code: 'LOGIN_REQUIRED' })
  })
})
