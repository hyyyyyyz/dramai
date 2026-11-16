import { describe, expect, it } from 'vitest'
import { ProviderError, redactProviderError } from '../src/providers/errors.ts'
import { runGeneration } from '../src/providers/executor.ts'
import { chatOnce } from '../src/providers/llm.ts'
import { geminiImage } from '../src/providers/protocols/gemini-image.ts'
import { openaiImages } from '../src/providers/protocols/openai-images.ts'
import { testProvider } from '../src/providers/test-connection.ts'
import { REDACTED, RESULT_TEXT_FIELDS, redactFields, redactText } from '../src/util/redact.ts'
import type { AuthContext, ProtocolId } from '../src/providers/types.ts'

const KEY = 'sk-echo-0123456789abcdef'
const TOKEN = 'eyJhbGciOi.access-token.value' // an account-login access token travels exactly like a key

/** An upstream that refuses and repeats whatever credential it was given. */
const echo = async (_url: string, init?: RequestInit): Promise<Response> => {
  const h = (init?.headers ?? {}) as Record<string, string>
  const given =
    (h.Authorization ?? '').replace(/^Bearer /, '') || h['x-api-key'] || h['x-goog-api-key'] || ''
  return new Response(JSON.stringify({ error: { message: `bad credential ${given}` } }), {
    status: 401,
  })
}

describe('redactText / redactDeep', () => {
  it('replaces the three ways a secret can be written, and nothing else', () => {
    const secret = 'ab"c d/e+f'
    const text = [
      secret,
      encodeURIComponent(secret),
      JSON.stringify(secret).slice(1, -1),
      'plain',
    ].join(' | ')
    const out = redactText(text, [secret])
    expect(out).toBe([REDACTED, REDACTED, REDACTED, 'plain'].join(' | '))
  })

  it('leaves text without the secret, and calls without a secret, exactly as they were', () => {
    const value = { a: ['x', { b: 'y' }], n: 1, ok: true }
    expect(redactText('hello', [KEY])).toBe('hello')
    expect(redactText('hello', [undefined, ''])).toBe('hello')
    expect(redactFields(value, [undefined], ['a'])).toBe(value) // the same object
    expect(redactFields(value, [KEY], RESULT_TEXT_FIELDS)).toEqual(value)
  })

  it('touches only the named text fields, wherever they are, and never structural ones', () => {
    expect(
      redactFields(
        { outcome: KEY, code: KEY, error: `x ${KEY}`, items: [{ id: KEY, message: KEY }] },
        [KEY],
        RESULT_TEXT_FIELDS,
      ),
    ).toEqual({
      outcome: KEY,
      code: KEY,
      error: `x ${REDACTED}`,
      items: [{ id: KEY, message: REDACTED }],
    })
  })

  it('a secret too short to be a credential (under 8 characters) is left alone instead of mangling the text', () => {
    expect(redactText('ok, unknown', ['k'])).toBe('ok, unknown')
    expect(redactText('ok, unknown', ['unknown'])).toBe('ok, unknown') // 7 characters
    expect(redactText('x abcdefgh y', ['abcdefgh'])).toBe(`x ${REDACTED} y`) // 8
  })

  it('finds the key written the ways an upstream is likely to repeat it', () => {
    const secret = `sk-a"b/c&d<e>é'f+g h_0123456789`
    const written: Record<string, string> = {
      raw: secret,
      url: encodeURIComponent(secret),
      form: encodeURIComponent(secret).replace(/%20/g, '+'),
      json: JSON.stringify(secret).slice(1, -1),
      'json, slash escaped': JSON.stringify(secret).slice(1, -1).replace(/\//g, '\\/'),
      'json, unicode escaped (lower)': JSON.stringify(secret).slice(1, -1).replace(/é/g, '\\u00e9'),
      'json, unicode escaped (upper)': JSON.stringify(secret).slice(1, -1).replace(/é/g, '\\u00E9'),
      'json, both (PHP default)': JSON.stringify(secret)
        .slice(1, -1)
        .replace(/\//g, '\\/')
        .replace(/é/g, '\\u00e9'),
      'html (&#39;)': secret
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
      'html (&#x27;)': secret
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;'),
      base64: Buffer.from(secret).toString('base64'),
      'base64, no padding': Buffer.from(secret).toString('base64').replace(/=+$/, ''),
      base64url: Buffer.from(secret).toString('base64url'),
    }
    for (const [name, form] of Object.entries(written)) {
      expect(redactText(`before ${form} after`, [secret]), name).toBe(`before ${REDACTED} after`)
    }
  })

  it('does not guess at partial echoes: a truncated or split key is left as it is (the stated limit)', () => {
    expect(redactText('key sk-echo-0123****cdef', ['sk-echo-0123456789abcdef'])).toBe(
      'key sk-echo-0123****cdef',
    )
    expect(redactText('sk-echo- 0123456789abcdef', ['sk-echo-0123456789abcdef'])).toBe(
      'sk-echo- 0123456789abcdef',
    )
  })

  it('a ProviderError keeps its kind, status, code and flags; only message and body change; unchanged errors stay the same object', () => {
    const err = new ProviderError('http', `HTTP 401 · ${KEY}`, {
      status: 401,
      body: KEY,
      submission: 'rejected',
      recoverable: true,
      code: 'X',
    })
    const out = redactProviderError(err, [KEY]) as ProviderError
    expect(out).toBeInstanceOf(ProviderError)
    expect(out).toMatchObject({
      kind: 'http',
      status: 401,
      submission: 'rejected',
      recoverable: true,
      code: 'X',
      message: `HTTP 401 · ${REDACTED}`,
      body: REDACTED,
    })
    const clean = new ProviderError('http', 'HTTP 500')
    expect(redactProviderError(clean, [KEY])).toBe(clean)
    const other = new Error('boom')
    expect(redactProviderError(other, [KEY])).toBe(other)
  })
})

describe('every exit of the provider layer removes a credential the upstream repeats', () => {
  const protocols: ProtocolId[] = [
    'openai-chat',
    'openai-responses',
    'anthropic-messages',
    'gemini-chat',
  ]

  it.each([KEY, TOKEN])(
    'testProvider (%s): API key and account-login token alike',
    async (secret) => {
      for (const protocol of [
        ...protocols,
        'gemini-image',
        'openai-images',
        'openai-tts',
      ] as ProtocolId[]) {
        const res = await testProvider(
          { baseUrl: 'https://x.example.test/v1', protocol, model: 'm' },
          secret,
          { fetch: echo as never },
        )
        expect(res.outcome, protocol).toBe('failed')
        expect(JSON.stringify(res), protocol).not.toContain(secret)
        expect(JSON.stringify(res), protocol).toContain(REDACTED)
      }
    },
  )

  it.each(protocols)('the text call (%s)', async (protocol) => {
    const auth: AuthContext = {
      baseUrl: 'https://x.example.test/v1',
      model: 'm',
      apiKey: KEY,
      method: 'api_key',
    }
    const err = await chatOnce(
      auth,
      { messages: [{ role: 'user', content: 'hi' }] },
      { fetch: echo as never },
      protocol,
    ).then(
      () => undefined,
      (e: ProviderError) => e,
    )
    expect(err).toBeInstanceOf(ProviderError)
    expect(`${err!.message} ${err!.body ?? ''}`).not.toContain(KEY)
    expect(err!.message).toContain(REDACTED)
    expect(err!.status).toBe(401) // the rest of the error is the same
  })

  it.each([
    ['openai-images', openaiImages],
    ['gemini-image', geminiImage],
  ] as const)('a generation call (%s)', async (_name, protocol) => {
    const auth: AuthContext = {
      baseUrl: 'https://x.example.test',
      model: 'm',
      apiKey: KEY,
      method: 'api_key',
    }
    const err = await runGeneration(
      protocol as never,
      auth,
      { prompt: 'p', aspectRatio: '9:16', size: { width: 64, height: 64 } },
      { fetch: echo as never },
    ).then(
      () => undefined,
      (e: ProviderError) => e,
    )
    expect(err).toBeInstanceOf(ProviderError)
    expect(`${err!.message} ${err!.body ?? ''}`).not.toContain(KEY)
    expect(err!.message).toContain(REDACTED)
    expect(err).toMatchObject({ kind: 'http', status: 401, submission: 'rejected' })
  })
})
