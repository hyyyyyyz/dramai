import { describe, expect, it } from 'vitest'
import { chatOnce, streamText } from '../src/providers/llm.ts'
import {
  buildResponsesRequest,
  parseResponsesErrorBody,
  parseResponsesEvent,
  parseResponsesModels,
  responsesProviderError,
} from '../src/providers/protocols/openai-responses.ts'
import { ProviderError } from '../src/providers/errors.ts'
import type { AuthContext } from '../src/providers/types.ts'
import type { ChatMessage } from '../src/providers/protocols/openai-chat.ts'

const KEY: AuthContext = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-x',
  apiKey: 'sk-test',
  method: 'api_key',
}
const LOGIN: AuthContext = {
  ...KEY,
  apiKey: 'access-token',
  method: 'account_login',
  channel: 'openai-chatgpt',
}

const messages: ChatMessage[] = [
  { role: 'system', content: '你是剧本资料员' },
  { role: 'user', content: '拆分这段文字，输出 JSON' },
  { role: 'assistant', content: '好的' },
  { role: 'user', content: '继续' },
]
const body = (r: ReturnType<typeof buildResponsesRequest>) =>
  (r.spec.body as { value: Record<string, unknown> }).value

describe('openai-responses: request construction (table)', () => {
  const cases: Array<{
    name: string
    auth: AuthContext
    input: Parameters<typeof buildResponsesRequest>[1]
    expectBody: Record<string, unknown>
    absent: string[]
    dropped: string[]
  }> = [
    {
      name: 'api key: tuning params pass through',
      auth: KEY,
      input: { messages, temperature: 0.3, topP: 0.9, maxTokens: 500, jsonMode: true },
      expectBody: {
        model: 'gpt-x',
        stream: true,
        store: false,
        instructions: '你是剧本资料员',
        temperature: 0.3,
        top_p: 0.9,
        max_output_tokens: 500,
        text: { format: { type: 'json_object' } },
      },
      absent: [],
      dropped: [],
    },
    {
      name: 'account login: unsupported fields are dropped and reported',
      auth: LOGIN,
      input: { messages, temperature: 0.3, topP: 0.9, maxTokens: 500, jsonMode: true },
      expectBody: {
        store: false,
        stream: true,
        instructions: '你是剧本资料员',
        text: { format: { type: 'json_object' } },
      },
      absent: [
        'temperature',
        'top_p',
        'max_output_tokens',
        'metadata',
        'previous_response_id',
        'user',
      ],
      dropped: ['temperature', 'top_p', 'max_output_tokens'],
    },
    {
      name: 'nothing to drop when nothing was set',
      auth: LOGIN,
      input: { messages: [{ role: 'user', content: 'hi' }] },
      expectBody: { store: false, stream: true },
      absent: ['instructions', 'text', 'temperature'],
      dropped: [],
    },
  ]
  for (const c of cases) {
    it(c.name, () => {
      const built = buildResponsesRequest(c.auth, c.input)
      const b = body(built)
      expect(b).toMatchObject(c.expectBody)
      for (const k of c.absent) expect(b, k).not.toHaveProperty(k)
      expect(built.dropped.map((d) => d.param)).toEqual(c.dropped)
      expect(built.spec.url).toBe('https://api.openai.com/v1/responses')
      expect(built.spec.method).toBe('POST')
      expect(built.spec.headers.Authorization).toBe(`Bearer ${c.auth.apiKey}`)
    })
  }

  it('never sends a system-role item: system messages become instructions, roles stay user/assistant', () => {
    for (const auth of [KEY, LOGIN]) {
      const b = body(buildResponsesRequest(auth, { messages }))
      const items = b.input as Array<{ role: string; content: unknown }>
      expect(items.map((i) => i.role)).toEqual(['user', 'assistant', 'user'])
      expect(JSON.stringify(b.input)).not.toContain('"system"')
      expect(items[0]).toEqual({ role: 'user', content: '拆分这段文字，输出 JSON' })
    }
  })

  it('several system messages are joined; images become input_image parts', () => {
    const b = body(
      buildResponsesRequest(KEY, {
        messages: [
          { role: 'system', content: 'A' },
          { role: 'system', content: [{ type: 'text', text: 'B' }] },
          {
            role: 'user',
            content: [
              { type: 'text', text: '看图' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            ],
          },
        ],
      }),
    )
    expect(b.instructions).toBe('A\n\nB')
    expect((b.input as Array<{ content: unknown }>)[0]!.content).toEqual([
      { type: 'input_text', text: '看图' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
    ])
  })
})

describe('openai-responses: events and errors (table)', () => {
  it('parses events by their type field', () => {
    expect(parseResponsesEvent({ type: 'response.output_text.delta', delta: 'hi' })).toEqual({
      kind: 'delta',
      text: 'hi',
    })
    expect(parseResponsesEvent({ type: 'response.output_text.delta', delta: '' })).toEqual({
      kind: 'ignored',
    })
    expect(
      parseResponsesEvent({
        type: 'response.completed',
        response: { usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 } },
      }),
    ).toEqual({
      kind: 'completed',
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
    })
    expect(
      parseResponsesEvent({
        type: 'response.failed',
        response: { error: { code: 'x', message: 'm' } },
      }),
    ).toEqual({ kind: 'failed', error: { code: 'x', message: 'm' } })
    expect(parseResponsesEvent({ type: 'response.failed', response: {} })).toMatchObject({
      error: { code: 'unknown_error' },
    })
    expect(
      parseResponsesEvent({
        type: 'response.incomplete',
        response: { incomplete_details: { reason: 'max_output_tokens' } },
      }),
    ).toEqual({ kind: 'incomplete', reason: 'max_output_tokens' })
    expect(parseResponsesEvent({ type: 'error', code: 'c', message: 'm' })).toEqual({
      kind: 'failed',
      error: { code: 'c', message: 'm', param: undefined },
    })
    expect(parseResponsesEvent({ type: 'response.created' })).toEqual({ kind: 'ignored' })
    expect(parseResponsesEvent({ delta: 'x' }, 'response.output_text.delta')).toEqual({
      kind: 'delta',
      text: 'x',
    })
  })

  const table: Array<[string, number]> = [
    ['subscription_sharing_user_not_eligible', 403],
    ['subscription_sharing_usage_limit_exceeded', 429],
    ['subscription_sharing_usage_unavailable', 503],
    ['subscription_sharing_unsupported_capability', 400],
    ['subscription_sharing_route_not_supported', 403],
    ['subscription_sharing_invalid_user', 401],
    ['chatpass_v2_scope_not_authorized', 403],
    ['chatpass_v2_invalid_authorization_context', 403],
    ['subscription_sharing_user_unavailable', 503],
  ]
  for (const [code, status] of table) {
    it(`error code ${code} → HTTP ${status}, with the code kept for the UI`, () => {
      const err = responsesProviderError({ code }, { where: 'stream' })
      expect(err).toBeInstanceOf(ProviderError)
      expect(err.status).toBe(status)
      expect(err.code).toBe(code)
      expect(err.message).toContain(code)
    })
  }

  it('parses rejected-request bodies: structured error, {detail}, plain text', () => {
    expect(
      parseResponsesErrorBody(
        '{"error":{"code":"subscription_sharing_unsupported_capability","param":"tools[0]","message":"no"}}',
      ),
    ).toEqual({
      code: 'subscription_sharing_unsupported_capability',
      param: 'tools[0]',
      message: 'no',
    })
    expect(parseResponsesErrorBody('{"detail":"Unauthorized"}')).toMatchObject({
      message: 'Unauthorized',
    })
    expect(parseResponsesErrorBody('<html>bad gateway</html>')).toMatchObject({
      message: '<html>bad gateway</html>',
    })
  })

  it('model lists: login shape keeps only visibility=list in server order; api-key shape lists ids', () => {
    expect(
      parseResponsesModels({
        models: [
          { slug: 'a', display_name: 'Model A', visibility: 'list' },
          { slug: 'hidden', display_name: 'H', visibility: 'hide' },
          { slug: 'b', visibility: 'list' },
        ],
      }),
    ).toEqual([
      { id: 'a', label: 'Model A' },
      { id: 'b', label: 'b' },
    ])
    expect(parseResponsesModels({ data: [{ id: 'gpt-x' }, { id: 'gpt-y' }] })).toEqual([
      { id: 'gpt-x', label: 'gpt-x' },
      { id: 'gpt-y', label: 'gpt-y' },
    ])
    expect(parseResponsesModels({})).toEqual([])
  })
})

// --- streaming through the real stream parser, with a fake fetch ---

const sse = (events: Array<[string, unknown]>, options: { done?: boolean } = {}) =>
  events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('') +
  (options.done ? 'data: [DONE]\n\n' : '')

const fetchOf = (text: string, init: { status?: number } = {}) => {
  const calls: Array<{
    url: string
    body: Record<string, unknown>
    headers: Record<string, string>
  }> = []
  const fn = async (url: string | URL | Request, req?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(req?.body ?? '{}')) as Record<string, unknown>,
      headers: req?.headers as Record<string, string>,
    })
    return new Response(text, {
      status: init.status ?? 200,
      headers: {
        'Content-Type':
          init.status && init.status >= 400 ? 'application/json' : 'text/event-stream',
      },
    })
  }
  return { fetch: fn as typeof fetch, calls }
}

const completedStream = sse([
  ['response.created', { type: 'response.created' }],
  ['response.output_text.delta', { type: 'response.output_text.delta', delta: '{"a":' }],
  ['response.output_text.delta', { type: 'response.output_text.delta', delta: '1}' }],
  [
    'response.completed',
    {
      type: 'response.completed',
      response: { usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } },
    },
  ],
])

describe('openai-responses: streaming', () => {
  it('collects text, reports usage, and calls the documented endpoint with the bearer token', async () => {
    const f = fetchOf(completedStream)
    const dropped: string[][] = []
    const res = await chatOnce(
      LOGIN,
      { messages, temperature: 0.2, jsonMode: true },
      { fetch: f.fetch, onDropped: (d) => dropped.push(d.dropped.map((x) => x.param)) },
      'openai-responses',
    )
    expect(res.text).toBe('{"a":1}')
    expect(res.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 })
    expect(f.calls[0]!.url).toBe('https://api.openai.com/v1/responses')
    expect(f.calls[0]!.headers.Authorization).toBe('Bearer access-token')
    expect(f.calls[0]!.body).toMatchObject({ store: false, stream: true })
    expect(f.calls[0]!.body).not.toHaveProperty('temperature')
    expect(dropped).toEqual([['temperature']]) // the dropped parameter is recorded, not silent
  })

  it('yields deltas as they arrive', async () => {
    const f = fetchOf(completedStream)
    const seen: string[] = []
    const it = streamText('openai-responses', KEY, { messages }, { fetch: f.fetch })
    for (;;) {
      const n = await it.next()
      if (n.done) break
      seen.push(n.value.accumulated)
    }
    expect(seen).toEqual(['{"a":', '{"a":1}'])
  })

  it('a failure in the middle of the stream (usage limit) is an error with the documented code, not partial text', async () => {
    const f = fetchOf(
      sse([
        ['response.output_text.delta', { type: 'response.output_text.delta', delta: 'partial' }],
        [
          'response.failed',
          {
            type: 'response.failed',
            response: {
              error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' },
            },
          },
        ],
      ]),
    )
    const err = await chatOnce(LOGIN, { messages }, { fetch: f.fetch }, 'openai-responses').catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).code).toBe('subscription_sharing_usage_limit_exceeded')
    expect((err as ProviderError).status).toBe(429)
  })

  it('a stream that ends without response.completed is a failure (interrupted), never a success', async () => {
    const f = fetchOf(
      sse([['response.output_text.delta', { type: 'response.output_text.delta', delta: 'half' }]]),
    )
    const err = await chatOnce(KEY, { messages }, { fetch: f.fetch }, 'openai-responses').catch(
      (e: unknown) => e,
    )
    expect((err as ProviderError).code).toBe('STREAM_INTERRUPTED')
    // even an explicit [DONE] is not completion
    const g = fetchOf(
      sse([['response.output_text.delta', { type: 'response.output_text.delta', delta: 'x' }]], {
        done: true,
      }),
    )
    const err2 = await chatOnce(KEY, { messages }, { fetch: g.fetch }, 'openai-responses').catch(
      (e: unknown) => e,
    )
    expect((err2 as ProviderError).code).toBe('STREAM_INTERRUPTED')
  })

  it('response.incomplete and error events fail', async () => {
    const inc = fetchOf(
      sse([
        [
          'response.incomplete',
          {
            type: 'response.incomplete',
            response: { incomplete_details: { reason: 'content_filter' } },
          },
        ],
      ]),
    )
    const e1 = await chatOnce(KEY, { messages }, { fetch: inc.fetch }, 'openai-responses').catch(
      (e: unknown) => e,
    )
    expect((e1 as ProviderError).code).toBe('RESPONSE_INCOMPLETE')
    const ev = fetchOf(sse([['error', { type: 'error', code: 'server_error', message: 'boom' }]]))
    const e2 = await chatOnce(KEY, { messages }, { fetch: ev.fetch }, 'openai-responses').catch(
      (e: unknown) => e,
    )
    expect((e2 as ProviderError).code).toBe('server_error')
  })

  it('a rejected request maps the structured error code and keeps the HTTP status', async () => {
    const f = fetchOf('{"error":{"code":"subscription_sharing_user_not_eligible","message":"x"}}', {
      status: 403,
    })
    const err = await chatOnce(LOGIN, { messages }, { fetch: f.fetch }, 'openai-responses').catch(
      (e: unknown) => e,
    )
    expect((err as ProviderError).status).toBe(403)
    expect((err as ProviderError).code).toBe('subscription_sharing_user_not_eligible')
    const g = fetchOf('{"detail":"Unauthorized"}', { status: 401 })
    const err2 = await chatOnce(LOGIN, { messages }, { fetch: g.fetch }, 'openai-responses').catch(
      (e: unknown) => e,
    )
    expect((err2 as ProviderError).status).toBe(401)
  })

  it('JSON-dependent steps work the same: json mode asks for json_object, and the existing parse-validate-retry loop sits on top', async () => {
    const { llmJson, createProviderLlm } = await import('../src/pipeline/deps.ts')
    const { z } = await import('zod')
    let n = 0
    const fetchFn = (async (_u: string | URL | Request, req?: RequestInit) => {
      n++
      const reqBody = JSON.parse(String(req?.body)) as {
        text?: unknown
        input: Array<{ content: string }>
      }
      expect(reqBody.text).toEqual({ format: { type: 'json_object' } })
      const out = n === 1 ? 'not json' : '{"title":"第一集"}'
      return new Response(
        sse([
          ['response.output_text.delta', { type: 'response.output_text.delta', delta: out }],
          ['response.completed', { type: 'response.completed', response: {} }],
        ]),
        { status: 200 },
      )
    }) as typeof fetch
    const llm = createProviderLlm(
      {
        secrets: {
          get: async () => undefined,
          set: async () => {},
          delete: async () => {},
          has: async () => false,
        },
        executor: { fetch: fetchFn },
      },
      {
        id: 'p',
        label: 'x',
        kind: 'llm',
        protocol: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-x',
        enabled: true,
      },
    )
    const out = await llmJson(
      { llm },
      {
        task: 'episodes.plan',
        messages: [{ role: 'user', content: '输出 JSON' }],
        schema: z.object({ title: z.string() }),
      },
    )
    expect(out).toEqual({ title: '第一集' })
    expect(n).toBe(2) // the first answer was not JSON; the retry loop asked again
  })
})
