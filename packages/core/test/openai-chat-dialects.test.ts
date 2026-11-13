import { describe, expect, it } from 'vitest'
import { chatOnce, streamText } from '../src/providers/llm.ts'
import { buildChatRequest } from '../src/providers/protocols/openai-chat.ts'
import { ProviderError } from '../src/providers/errors.ts'
import type { AuthContext, ProviderDialect } from '../src/providers/types.ts'
import { ThinkTagStripper } from '../src/util/think-tags.ts'
import { deepMerge } from '../src/util/merge.ts'

const auth = (dialect?: ProviderDialect): AuthContext => ({
  baseUrl: 'https://api.example.com/v1',
  model: 'm',
  apiKey: 'sk-test',
  method: 'api_key',
  ...(dialect ? { dialect } : {}),
})
const body = (a: AuthContext, input: Parameters<typeof buildChatRequest>[1]) =>
  (buildChatRequest(a, input).body as { value: Record<string, unknown> }).value

describe('openai-chat request: dialect options (table)', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }]

  it('without a dialect the request is exactly what it was before (the four tested presets do not change)', () => {
    expect(
      body(auth(), { messages, temperature: 0.7, topP: 0.9, maxTokens: 100, jsonMode: true }),
    ).toEqual({
      model: 'm',
      messages,
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 100,
      response_format: { type: 'json_object' },
    })
    const spec = buildChatRequest(auth(), { messages })
    expect(spec.url).toBe('https://api.example.com/v1/chat/completions')
    expect(spec.headers.Authorization).toBe('Bearer sk-test')
  })

  const tokenCases: Array<[string, ProviderDialect | undefined, string]> = [
    ['default', undefined, 'max_tokens'],
    [
      'explicit max_tokens (DeepSeek, Zhipu, SiliconFlow, Ollama)',
      { maxTokensField: 'max_tokens' },
      'max_tokens',
    ],
    [
      'max_completion_tokens (OpenAI, Moonshot, MiniMax, Qwen, Groq)',
      { maxTokensField: 'max_completion_tokens' },
      'max_completion_tokens',
    ],
  ]
  for (const [name, dialect, field] of tokenCases) {
    it(`output length field — ${name}`, () => {
      const b = body(auth(dialect), { messages, maxTokens: 321 })
      expect(b[field]).toBe(321)
      const other = field === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
      expect(b).not.toHaveProperty(other)
    })
  }

  it('JSON mode: json_object by default, nothing sent for prompt_only (the parse-and-retry loop does the work)', () => {
    expect(body(auth(), { messages, jsonMode: true }).response_format).toEqual({
      type: 'json_object',
    })
    expect(
      body(auth({ jsonMode: 'json_object' }), { messages, jsonMode: true }).response_format,
    ).toEqual({ type: 'json_object' })
    expect(
      body(auth({ jsonMode: 'prompt_only' }), { messages, jsonMode: true }),
    ).not.toHaveProperty('response_format')
    expect(body(auth(), { messages })).not.toHaveProperty('response_format')
  })

  const thinkingOff: Array<[string, Record<string, unknown>]> = [
    ['Qwen / SiliconFlow', { enable_thinking: false }],
    ['Volcengine / Zhipu / DeepSeek / MiniMax M3 / Kimi K2.6', { thinking: { type: 'disabled' } }],
    ['Moonshot K3 / OpenAI / Mistral', { reasoning_effort: 'low' }],
    ['OpenRouter', { reasoning: { effort: 'none' } }],
  ]
  for (const [name, extraBody] of thinkingOff) {
    it(`extra body — ${name}: merged into the request, user text untouched`, () => {
      const b = body(auth({ extraBody }), { messages, maxTokens: 10 })
      expect(b).toMatchObject(extraBody)
      expect(b.messages).toEqual(messages)
      expect(b.model).toBe('m')
    })
  }

  it('extra body is merged deeply, and cannot replace model, messages or stream', () => {
    const b = body(
      auth({
        extraBody: {
          response_format: { type: 'text' },
          model: 'evil',
          messages: [],
          stream: false,
          extra: { a: 1 },
        },
      }),
      {
        messages,
        jsonMode: true,
      },
    )
    expect(b.model).toBe('m')
    expect(b.messages).toEqual(messages)
    expect(b.stream).toBe(true)
    expect(b.response_format).toEqual({ type: 'text' }) // the preset may override the generated field
    expect(b.extra).toEqual({ a: 1 })
    expect(deepMerge({ a: { b: 1, c: 2 }, l: [1] }, { a: { b: 9 }, l: [2], z: undefined })).toEqual(
      { a: { b: 9, c: 2 }, l: [2] },
    )
  })
})

// --- streams as the vendors really send them (shapes from the provider survey) ---

const enc = (chunks: Array<unknown | string>) =>
  chunks
    .map((c) => (typeof c === 'string' ? `${c}\n\n` : `data: ${JSON.stringify(c)}\n\n`))
    .join('') + 'data: [DONE]\n\n'
const fetchOf = (text: string) =>
  (async () =>
    new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })) as unknown as typeof fetch
const run = async (chunks: Array<unknown | string>, a = auth()) =>
  chatOnce(a, { messages: [{ role: 'user', content: 'x' }] }, { fetch: fetchOf(enc(chunks)) })
const ch = (
  delta: Record<string, unknown>,
  finish: string | null = null,
  extra: Record<string, unknown> = {},
) => ({
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...extra,
})
const usage = { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 }
const U = { promptTokens: 11, completionTokens: 22, totalTokens: 33 }

describe('openai-chat streams: vendor dialects (table)', () => {
  const cases: Array<{
    name: string
    chunks: Array<unknown | string>
    text: string
    usage?: typeof U
  }> = [
    {
      name: 'OpenAI: usage in a final chunk with choices: []',
      chunks: [
        ch({ role: 'assistant', content: '' }),
        ch({ content: 'Hel' }),
        ch({ content: 'lo' }, 'stop'),
        { choices: [], usage },
      ],
      text: 'Hello',
      usage: U,
    },
    {
      name: 'DeepSeek: reasoning_content first, usage on the last content chunk',
      chunks: [
        ch({ reasoning_content: '用户要JSON' }),
        ch({ reasoning_content: '。' }),
        ch({ content: '{"a"' }),
        ch({ content: ':1}' }, 'stop', { usage }),
      ],
      text: '{"a":1}',
      usage: U,
    },
    {
      name: 'Qwen / Volcengine / Zhipu / SiliconFlow: reasoning_content, then content, usage chunk with choices: []',
      chunks: [
        ch({ reasoning_content: 'think' }),
        ch({ content: '好' }),
        ch({ content: '的' }, 'stop'),
        { choices: [], usage },
      ],
      text: '好的',
      usage: U,
    },
    {
      name: 'Moonshot K3: long reasoning_content before content',
      chunks: [
        ch({ role: 'assistant', content: '', reasoning_content: 'a' }),
        ch({ reasoning_content: 'b' }),
        ch({ content: 'ok' }, 'stop'),
        { choices: [], usage },
      ],
      text: 'ok',
      usage: U,
    },
    {
      name: 'OpenRouter: SSE comment lines, reasoning + reasoning_details, usage on a last chunk that has choices',
      chunks: [
        ': OPENROUTER PROCESSING',
        ch({
          role: 'assistant',
          content: '',
          reasoning: 'hm',
          reasoning_details: [{ type: 'reasoning.text', text: 'hm' }],
        }),
        ': OPENROUTER PROCESSING',
        ch({ content: 'Hi' }),
        ch({ content: ' there' }, 'stop'),
        ch({ content: '' }, 'stop', { usage }),
      ],
      text: 'Hi there',
      usage: U,
    },
    {
      name: 'Groq: delta.reasoning',
      chunks: [ch({ reasoning: 'think' }), ch({ content: 'done' }, 'stop')],
      text: 'done',
    },
    {
      name: 'Mistral: content is an array of blocks; thinking blocks are dropped',
      chunks: [
        ch({ content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'let me think' }] }] }),
        ch({ content: [{ type: 'text', text: 'Bon' }] }),
        ch(
          {
            content: [
              { type: 'text', text: 'jour' },
              { type: 'reference', reference_ids: [1] },
            ],
          },
          'stop',
        ),
      ],
      text: 'Bonjour',
    },
    {
      name: 'MiniMax (reasoning_split off): <think> inline in content, split across chunks',
      chunks: [
        ch({ content: '<thi' }),
        ch({ content: 'nk>plan the shots</th' }),
        ch({ content: 'ink>\n{"shots":' }),
        ch({ content: '[]}' }, 'stop'),
      ],
      text: '\n{"shots":[]}',
    },
    {
      name: 'chunks without choices or with null content are harmless',
      chunks: [{ id: 'x' }, ch({ content: null }), ch({ content: 'ok' }, 'stop'), { choices: [] }],
      text: 'ok',
    },
    {
      name: 'a stream that ends without [DONE] is accepted (some local servers)',
      chunks: [ch({ content: 'fine' }, 'stop')],
      text: 'fine',
    },
  ]
  for (const c of cases) {
    it(c.name, async () => {
      const res = await run(c.chunks)
      expect(res.text).toBe(c.text)
      if (c.usage) expect(res.usage).toEqual(c.usage)
      // thinking never leaks into the text
      expect(res.text).not.toMatch(/think|reasoning|let me|用户要/i)
    })
  }

  it('deltas yielded to the caller are the cleaned text too', async () => {
    const it = streamText(
      'openai-chat',
      auth(),
      { messages: [] },
      {
        fetch: fetchOf(
          enc([
            ch({ reasoning_content: 'secret' }),
            ch({ content: 'A' }),
            ch({ content: 'B' }, 'stop'),
          ]),
        ),
      },
    )
    const seen: string[] = []
    for (;;) {
      const n = await it.next()
      if (n.done) break
      seen.push(n.value.delta)
    }
    expect(seen).toEqual(['A', 'B'])
  })

  it('output cut by the length limit with no text (thinking used it all) is a clear error, not an empty string', async () => {
    const err = await run([
      ch({ reasoning_content: 'a very long thought' }),
      ch({}, 'length'),
    ]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect((err as ProviderError).code).toBe('EMPTY_OUTPUT_TRUNCATED')
    // truncated but with text is returned as before
    expect((await run([ch({ content: 'part' }, 'length')])).text).toBe('part')
  })
})

describe('ThinkTagStripper', () => {
  const strip = (parts: string[]) => {
    const s = new ThinkTagStripper()
    return parts.map((p) => s.push(p)).join('') + s.flush()
  }
  it('removes think blocks however the stream is cut, and keeps everything else', () => {
    expect(strip(['<think>a</think>b'])).toBe('b')
    expect(strip(['a<think>x</think>b<think>y</think>c'])).toBe('abc')
    expect(strip(['<', 'think>', 'x', '</', 'think>', 'ok'])).toBe('ok')
    expect(strip(['1 < 2 and <b>bold</b>'])).toBe('1 < 2 and <b>bold</b>')
    expect(strip(['trailing <thi'])).toBe('trailing <thi')
    expect(strip(['<think>never closed'])).toBe('')
    expect(strip(['plain text'])).toBe('plain text')
  })
})
