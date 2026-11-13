import { describe, expect, it } from 'vitest'
import { chatOnce, streamText } from '../src/providers/llm.ts'
import {
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  ANTHROPIC_VERSION,
  anthropicProviderError,
  buildMessagesRequest,
  parseAnthropicModels,
  parseMessagesErrorBody,
  parseMessagesEvent,
} from '../src/providers/protocols/anthropic-messages.ts'
import {
  buildGeminiRequest,
  parseGeminiChunk,
  parseGeminiErrorBody,
  parseGeminiModels,
} from '../src/providers/protocols/gemini-chat.ts'
import { ProviderError } from '../src/providers/errors.ts'
import type { AuthContext, ProviderDialect } from '../src/providers/types.ts'
import type { ChatMessage } from '../src/providers/protocols/openai-chat.ts'

const A = (extra: Partial<AuthContext> = {}): AuthContext => ({
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-5-5',
  apiKey: 'sk-ant-test',
  method: 'api_key',
  ...extra,
})
const G = (extra: Partial<AuthContext> = {}): AuthContext => ({
  baseUrl: 'https://generativelanguage.googleapis.com',
  model: 'gemini-3.8-flash',
  apiKey: 'AIza-test',
  method: 'api_key',
  ...extra,
})
const png = 'data:image/png;base64,AAAA'
const messages: ChatMessage[] = [
  { role: 'system', content: '你是剧本资料员' },
  { role: 'user', content: '拆分，输出 JSON' },
  { role: 'assistant', content: '好' },
  {
    role: 'user',
    content: [
      { type: 'text', text: '看图' },
      { type: 'image_url', image_url: { url: png } },
    ],
  },
]
const bodyOf = (spec: { body?: { type: string; value?: unknown } }) =>
  (spec.body as { value: Record<string, unknown> }).value

describe('anthropic-messages: request', () => {
  it('endpoint, both documented auth headers, the version header, streaming', () => {
    const { spec } = buildMessagesRequest(A(), { messages })
    expect(spec.url).toBe('https://api.anthropic.com/v1/messages')
    expect(spec.headers).toMatchObject({
      'x-api-key': 'sk-ant-test',
      Authorization: 'Bearer sk-ant-test',
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    })
    expect(bodyOf(spec).stream).toBe(true)
  })

  it('system goes to the top-level field; roles are user/assistant; images are base64 or url blocks', () => {
    const b = bodyOf(buildMessagesRequest(A(), { messages }).spec)
    expect(b.system).toBe('你是剧本资料员')
    expect((b.messages as Array<{ role: string }>).map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
    expect(JSON.stringify(b.messages)).not.toContain('"system"')
    expect((b.messages as Array<{ content: unknown }>)[2]!.content).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ])
    const url = bodyOf(
      buildMessagesRequest(A(), {
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: 'https://x.example/a.png' } }],
          },
        ],
      }).spec,
    )
    expect((url.messages as Array<{ content: unknown }>)[0]!.content).toEqual([
      { type: 'image', source: { type: 'url', url: 'https://x.example/a.png' } },
    ])
  })

  it('max_tokens is always present (required); a generous default; the caller can set it', () => {
    expect(bodyOf(buildMessagesRequest(A(), { messages }).spec).max_tokens).toBe(
      ANTHROPIC_DEFAULT_MAX_TOKENS,
    )
    expect(bodyOf(buildMessagesRequest(A(), { messages, maxTokens: 777 }).spec).max_tokens).toBe(
      777,
    )
  })

  it('temperature and top_p are not sent (Claude 4.7+/5.x reject them) and are reported; JSON mode adds nothing', () => {
    const { spec, dropped } = buildMessagesRequest(A(), {
      messages,
      temperature: 0.3,
      topP: 0.5,
      jsonMode: true,
    })
    expect(dropped.map((d) => d.param)).toEqual(['temperature', 'top_p'])
    const b = bodyOf(spec)
    for (const k of ['temperature', 'top_p', 'response_format', 'output_config'])
      expect(b).not.toHaveProperty(k)
  })

  it('the extra body can set thinking or max_tokens, but not the model, messages or stream', () => {
    const dialect: ProviderDialect = {
      extraBody: {
        thinking: { type: 'adaptive' },
        max_tokens: 64_000,
        model: 'x',
        stream: false,
        messages: [],
      },
    }
    const b = bodyOf(buildMessagesRequest(A({ dialect }), { messages }).spec)
    expect(b).toMatchObject({
      thinking: { type: 'adaptive' },
      max_tokens: 64_000,
      model: 'claude-sonnet-5-5',
      stream: true,
    })
    expect((b.messages as unknown[]).length).toBe(3)
  })
})

const sse = (events: Array<[string, unknown]>) =>
  events.map(([n, d]) => `event: ${n}\ndata: ${JSON.stringify(d)}\n\n`).join('')
const respond = (text: string, init: { status?: number; type?: string } = {}) => {
  const calls: Array<{
    url: string
    headers: Record<string, string>
    body: Record<string, unknown>
  }> = []
  const fn = (async (url: string | URL | Request, req?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: req?.headers as Record<string, string>,
      body: JSON.parse(String(req?.body ?? '{}')) as Record<string, unknown>,
    })
    return new Response(text, {
      status: init.status ?? 200,
      headers: {
        'Content-Type':
          init.type ??
          (init.status && init.status >= 400 ? 'application/json' : 'text/event-stream'),
      },
    })
  }) as unknown as typeof fetch
  return { fetch: fn, calls }
}

const textDelta = (t: string) =>
  [
    'content_block_delta',
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
  ] as [string, unknown]
const okStream = sse([
  [
    'message_start',
    {
      type: 'message_start',
      message: {
        id: 'm',
        role: 'assistant',
        content: [],
        usage: { input_tokens: 472, output_tokens: 2 },
      },
    },
  ],
  [
    'content_block_start',
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  ],
  ['ping', { type: 'ping' }],
  [
    'content_block_delta',
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'secret thought' },
    },
  ],
  [
    'content_block_delta',
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
  ],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  [
    'content_block_start',
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  ],
  textDelta('{"a":'),
  textDelta('1}'),
  ['content_block_stop', { type: 'content_block_stop', index: 1 }],
  [
    'message_delta',
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 15 },
    },
  ],
  ['message_stop', { type: 'message_stop' }],
])

describe('anthropic-messages: streaming', () => {
  it('collects only text (thinking and signatures ignored), pings ignored, usage from start + cumulative delta', async () => {
    const f = respond(okStream)
    const res = await chatOnce(A(), { messages }, { fetch: f.fetch }, 'anthropic-messages')
    expect(res.text).toBe('{"a":1}')
    expect(res.usage).toEqual({ promptTokens: 472, completionTokens: 15, totalTokens: 487 })
    expect(res.finishReason).toBe('end_turn')
    expect(res.text).not.toContain('secret')
    expect(f.calls[0]!.url).toBe('https://api.anthropic.com/v1/messages')
    expect(f.calls[0]!.headers['anthropic-version']).toBe(ANTHROPIC_VERSION)
  })

  it('yields text deltas as they come', async () => {
    const it = streamText(
      'anthropic-messages',
      A(),
      { messages },
      { fetch: respond(okStream).fetch },
    )
    const seen: string[] = []
    for (;;) {
      const n = await it.next()
      if (n.done) break
      seen.push(n.value.delta)
    }
    expect(seen).toEqual(['{"a":', '1}'])
  })

  it('an error event in the middle of the stream fails with the documented error type and its HTTP status', async () => {
    const f = respond(
      sse([
        textDelta('partial'),
        ['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }],
      ]),
    )
    const err = await chatOnce(A(), { messages }, { fetch: f.fetch }, 'anthropic-messages').catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).code).toBe('overloaded_error')
    expect((err as ProviderError).status).toBe(529)
  })

  it('a stream that ends before message_stop is an interruption; [DONE] is not completion', async () => {
    const f = respond(sse([textDelta('half')]) + 'data: [DONE]\n\n')
    const err = await chatOnce(A(), { messages }, { fetch: f.fetch }, 'anthropic-messages').catch(
      (e: unknown) => e,
    )
    expect((err as ProviderError).code).toBe('STREAM_INTERRUPTED')
  })

  it('max_tokens reached with no text (thinking used it up) is a clear error', async () => {
    const f = respond(
      sse([
        ['message_start', { type: 'message_start', message: { usage: { input_tokens: 5 } } }],
        [
          'message_delta',
          {
            type: 'message_delta',
            delta: { stop_reason: 'max_tokens' },
            usage: { output_tokens: 100 },
          },
        ],
        ['message_stop', { type: 'message_stop' }],
      ]),
    )
    const err = await chatOnce(A(), { messages }, { fetch: f.fetch }, 'anthropic-messages').catch(
      (e: unknown) => e,
    )
    expect((err as ProviderError).code).toBe('EMPTY_OUTPUT_TRUNCATED')
  })

  const httpErrors: Array<[number, string]> = [
    [400, 'invalid_request_error'],
    [401, 'authentication_error'],
    [402, 'billing_error'],
    [403, 'permission_error'],
    [404, 'not_found_error'],
    [413, 'request_too_large'],
    [429, 'rate_limit_error'],
    [500, 'api_error'],
    [529, 'overloaded_error'],
  ]
  for (const [status, type] of httpErrors) {
    it(`HTTP ${status} ${type}: parsed from {type:'error', error:{…}, request_id}`, async () => {
      const f = respond(
        JSON.stringify({ type: 'error', error: { type, message: 'm' }, request_id: 'req_1' }),
        { status },
      )
      const err = await chatOnce(A(), { messages }, { fetch: f.fetch }, 'anthropic-messages').catch(
        (e: unknown) => e,
      )
      expect((err as ProviderError).status).toBe(status)
      expect((err as ProviderError).code).toBe(type)
      expect((err as ProviderError).message).toContain('req_1')
    })
  }

  it('event / error / model-list parsers', () => {
    expect(
      parseMessagesEvent({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{' },
      }),
    ).toEqual({ kind: 'ignored' })
    expect(parseMessagesEvent({ type: 'ping' })).toEqual({ kind: 'ignored' })
    expect(
      parseMessagesEvent({ delta: { type: 'text_delta', text: 'x' } }, 'content_block_delta'),
    ).toEqual({ kind: 'delta', text: 'x' })
    expect(parseMessagesErrorBody('not json')).toMatchObject({ message: 'not json' })
    expect(anthropicProviderError({ type: 'rate_limit_error' }).status).toBe(429)
    expect(
      parseAnthropicModels({
        data: [
          { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', lifecycle: 'active' },
          { id: 'old', lifecycle: 'retired' },
          { id: 'claude-x' },
        ],
      }),
    ).toEqual([
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-x', label: 'claude-x' },
    ])
  })
})

describe('gemini-chat: request', () => {
  it('path, streaming query, the key header (not Bearer), model prefix tolerated', () => {
    const { spec } = buildGeminiRequest(G(), { messages })
    expect(spec.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
    )
    expect(spec.headers['x-goog-api-key']).toBe('AIza-test')
    expect(spec.headers).not.toHaveProperty('Authorization')
    expect(
      buildGeminiRequest(G({ model: 'models/gemini-3.8-flash' }), { messages }).spec.url,
    ).toContain('/models/gemini-3.8-flash:streamGenerateContent')
  })

  it('system → systemInstruction, assistant → model, image → inlineData, JSON → responseMimeType, max tokens', () => {
    const b = bodyOf(buildGeminiRequest(G(), { messages, jsonMode: true, maxTokens: 900 }).spec)
    expect(b.systemInstruction).toEqual({ parts: [{ text: '你是剧本资料员' }] })
    const contents = b.contents as Array<{ role: string; parts: unknown[] }>
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(contents[2]!.parts).toEqual([
      { text: '看图' },
      { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
    ])
    expect(b.generationConfig).toEqual({
      maxOutputTokens: 900,
      responseMimeType: 'application/json',
    })
    expect(bodyOf(buildGeminiRequest(G(), { messages }).spec)).not.toHaveProperty(
      'generationConfig',
    )
  })

  it('temperature and topP are not sent and are reported; a network image address is refused (base64 only)', () => {
    const { spec, dropped } = buildGeminiRequest(G(), { messages, temperature: 0.2, topP: 0.9 })
    expect(dropped.map((d) => d.param)).toEqual(['temperature', 'topP'])
    expect(JSON.stringify(bodyOf(spec))).not.toMatch(/temperature|topP/)
    expect(() =>
      buildGeminiRequest(G(), {
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: 'https://x.example/a.png' } }],
          },
        ],
      }),
    ).toThrow(/base64/)
  })

  it('the extra body is deep-merged into generationConfig (e.g. thinkingConfig) without losing what was generated', () => {
    const dialect: ProviderDialect = {
      extraBody: { generationConfig: { thinkingConfig: { thinkingLevel: 'LOW' } }, contents: [] },
    }
    const b = bodyOf(buildGeminiRequest(G({ dialect }), { messages, maxTokens: 50 }).spec)
    expect(b.generationConfig).toEqual({
      maxOutputTokens: 50,
      thinkingConfig: { thinkingLevel: 'LOW' },
    })
    expect((b.contents as unknown[]).length).toBe(3)
  })
})

const gchunk = (text: string, extra: Record<string, unknown> = {}, thought = false) => ({
  candidates: [
    {
      content: { role: 'model', parts: [{ text, ...(thought ? { thought: true } : {}) }] },
      index: 0,
      ...extra,
    },
  ],
})
const gsse = (chunks: unknown[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')
const usageMeta = {
  promptTokenCount: 9,
  candidatesTokenCount: 4,
  thoughtsTokenCount: 30,
  totalTokenCount: 43,
}

describe('gemini-chat: streaming', () => {
  it('collects text, skips thought parts, takes usage and the finish reason from the last chunk', async () => {
    const f = respond(
      gsse([
        gchunk('thinking...', {}, true),
        gchunk('{"a":'),
        { ...gchunk('1}', { finishReason: 'STOP' }), usageMetadata: usageMeta },
      ]),
    )
    const res = await chatOnce(G(), { messages }, { fetch: f.fetch }, 'gemini-chat')
    expect(res.text).toBe('{"a":1}')
    expect(res.usage).toEqual({ promptTokens: 9, completionTokens: 4, totalTokens: 43 })
    expect(res.finishReason).toBe('STOP')
    expect(f.calls[0]!.url).toContain(':streamGenerateContent?alt=sse')
  })

  it('also reads a plain JSON array response (if the server ignores alt=sse)', async () => {
    const f = respond(JSON.stringify([gchunk('ab'), gchunk('cd', { finishReason: 'STOP' })]), {
      type: 'application/json',
    })
    expect((await chatOnce(G(), { messages }, { fetch: f.fetch }, 'gemini-chat')).text).toBe('abcd')
  })

  it('blocked prompt, blocked output, error chunk, interruption, and truncation without text are all failures', async () => {
    const run = (text: string, type?: string) =>
      chatOnce(G(), { messages }, { fetch: respond(text, { type }).fetch }, 'gemini-chat').catch(
        (e: unknown) => e as ProviderError,
      )
    expect(
      ((await run(gsse([{ promptFeedback: { blockReason: 'SAFETY' } }]))) as ProviderError).code,
    ).toBe('GEMINI_PROMPT_SAFETY')
    expect(
      ((await run(gsse([gchunk('x'), gchunk('', { finishReason: 'SAFETY' })]))) as ProviderError)
        .code,
    ).toBe('GEMINI_SAFETY')
    expect(
      (
        (await run(
          gsse([
            gchunk('a'),
            { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } },
          ]),
        )) as ProviderError
      ).status,
    ).toBe(429)
    expect(((await run(gsse([gchunk('half')]))) as ProviderError).code).toBe('STREAM_INTERRUPTED')
    expect(
      ((await run(gsse([gchunk('', { finishReason: 'MAX_TOKENS' })]))) as ProviderError).code,
    ).toBe('EMPTY_OUTPUT_TRUNCATED')
    expect(((await run('not json at all', 'application/json')) as ProviderError).code).toBe(
      'GEMINI_BAD_RESPONSE',
    )
    // truncated but with text is returned
    expect(
      (
        await chatOnce(
          G(),
          { messages },
          { fetch: respond(gsse([gchunk('part', { finishReason: 'MAX_TOKENS' })])).fetch },
          'gemini-chat',
        )
      ).text,
    ).toBe('part')
  })

  it('a rejected request maps {error:{code,status,message}} and keeps the HTTP status', async () => {
    const f = respond(
      JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad' } }),
      { status: 400 },
    )
    const err = await chatOnce(G(), { messages }, { fetch: f.fetch }, 'gemini-chat').catch(
      (e: unknown) => e,
    )
    expect((err as ProviderError).status).toBe(400)
    expect((err as ProviderError).code).toBe('INVALID_ARGUMENT')
    expect(parseGeminiErrorBody('oops')).toMatchObject({ message: 'oops' })
  })

  it('chunk and model-list parsers', () => {
    expect(parseGeminiChunk({ candidates: [] })).toEqual([])
    expect(parseGeminiChunk(gchunk('x'))).toEqual([{ kind: 'text', text: 'x' }])
    expect(
      parseGeminiModels({
        models: [
          {
            name: 'models/gemini-3.8-flash',
            displayName: 'Gemini 3.8 Flash',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          { name: 'models/text-embedding-x', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-x' },
        ],
      }),
    ).toEqual([
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-x', label: 'gemini-x' },
    ])
  })

  it('dropped parameters are reported through the same hook as the other protocols', async () => {
    const dropped: string[][] = []
    await chatOnce(
      G(),
      { messages, temperature: 0.1 },
      {
        fetch: respond(gsse([gchunk('ok', { finishReason: 'STOP' })])).fetch,
        onDropped: (d) => dropped.push(d.dropped.map((x) => x.param)),
      },
      'gemini-chat',
    )
    expect(dropped).toEqual([['temperature']])
  })
})
