import { createSign, generateKeyPairSync } from 'node:crypto'
import { OPENAI_LOGIN } from '@dramai/core'

/** A made-up OpenAI for tests: keys are generated here, nothing talks to the network. */

const b64u = (v: string | Buffer) => Buffer.from(v).toString('base64url')
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = {
  ...pair.publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  use: 'sig',
  alg: 'RS256',
}

export const CLIENT_ID = 'oaiapp_test_client'
export const ACCESS = 'access-token-AAAA-secret'
export const REFRESH = 'refresh-token-RRRR-secret'

export function signIdToken(claims: Record<string, unknown>): string {
  const input = `${b64u(JSON.stringify({ alg: 'RS256', kid: 'test-key' }))}.${b64u(JSON.stringify(claims))}`
  return `${input}.${createSign('RSA-SHA256').update(input).sign(pair.privateKey).toString('base64url')}`
}

export interface FakeOpenAi {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  requests: Array<{ url: string; form?: URLSearchParams }>
  revoked: string[]
  /** the nonce of the most recent authorization, to put in the ID token */
  nonce: string
}

export function fakeOpenAi(options: { email?: string; scope?: string } = {}): FakeOpenAi {
  const state: FakeOpenAi = {
    fetch: async () => new Response('', { status: 500 }),
    requests: [],
    revoked: [],
    nonce: '',
  }
  state.fetch = async (url, init) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    if (url === OPENAI_LOGIN.jwksUrl) return json({ keys: [jwk] })
    if (url === OPENAI_LOGIN.discoveryUrl) {
      return json({
        issuer: OPENAI_LOGIN.issuer,
        revocation_endpoint: OPENAI_LOGIN.revokeUrl,
        jwks_uri: OPENAI_LOGIN.jwksUrl,
      })
    }
    const form = init?.body ? new URLSearchParams(String(init.body)) : undefined
    state.requests.push({ url, form })
    if (url === OPENAI_LOGIN.tokenUrl) {
      const now = Math.floor(Date.now() / 1000)
      if (form?.get('grant_type') === 'refresh_token') {
        return json({
          access_token: `${ACCESS}-refreshed`,
          refresh_token: `${REFRESH}-2`,
          expires_in: 3600,
          scope: options.scope ?? OPENAI_LOGIN.scope,
        })
      }
      return json({
        access_token: ACCESS,
        refresh_token: REFRESH,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: options.scope ?? OPENAI_LOGIN.scope,
        id_token: signIdToken({
          iss: OPENAI_LOGIN.issuer,
          aud: CLIENT_ID,
          sub: 'user-1',
          email: options.email ?? 'me@example.com',
          exp: now + 3600,
          iat: now,
          nonce: state.nonce,
        }),
      })
    }
    if (url === OPENAI_LOGIN.revokeUrl) {
      state.revoked.push(form?.get('token') ?? '')
      return new Response('', { status: 200 })
    }
    throw new Error(`unexpected request to ${url}`)
  }
  return state
}
