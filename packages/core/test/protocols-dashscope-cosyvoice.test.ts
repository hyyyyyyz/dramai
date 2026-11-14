import { describe, expect, it } from 'vitest'
import { runGeneration } from '../src/providers/executor.ts'
import {
  dashscopeCosyvoice,
  getMediaProtocol,
  instructionLength,
} from '../src/providers/protocols/index.ts'
import type { AuthContext, HttpRequestSpec, RawResponse } from '../src/providers/types.ts'

/** Alibaba CosyVoice, HTTP non-streaming form. Built from the official pages of 2026-11-13; never run against the real service. */

const auth = (over: Partial<AuthContext> = {}): AuthContext => ({
  baseUrl: 'https://ws1.cn-beijing.maas.aliyuncs.com',
  model: 'cosyvoice-v3-flash',
  apiKey: 'sk-ali-secret',
  method: 'api_key',
  ...over,
})
const body = (spec: HttpRequestSpec) =>
  (spec.body as { value: { model: string; input: Record<string, unknown> } }).value
const URL_OK = 'https://oss.example.com/cosy/abc.mp3?Expires=1&Signature=x'
const ok = (url: unknown = URL_OK) => ({
  request_id: 'r1',
  output: { finish_reason: 'stop', audio: { url, expires_at: 1790000000, id: 'a1' } },
  usage: { characters: 12 },
})
const raw = (json: unknown, over: Partial<RawResponse> = {}): RawResponse => ({
  status: 200,
  headers: {},
  text: JSON.stringify(json),
  json,
  ...over,
})

describe('dashscope-cosyvoice: the request', () => {
  it('POST /api/v1/services/audio/tts/SpeechSynthesizer, everything inside input, key in the header only', () => {
    const spec = dashscopeCosyvoice.buildGenerateRequest(auth(), {
      text: '你好',
      voice: 'longanyang',
      speed: 1.1,
    })
    expect(spec.method).toBe('POST')
    expect(spec.url).toBe(
      'https://ws1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
    )
    expect(spec.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-ali-secret',
    })
    expect(spec.headers).not.toHaveProperty('X-DashScope-SSE') // never the streaming form
    expect(body(spec)).toEqual({
      model: 'cosyvoice-v3-flash',
      input: { text: '你好', voice: 'longanyang', format: 'mp3', rate: 1.1 },
    })
    expect(spec.url).not.toContain('sk-ali-secret')
    expect(JSON.stringify(spec.body)).not.toContain('sk-ali-secret')
  })

  it('declares the streaming switch as protected, so extra headers cannot turn the stream on', async () => {
    expect(dashscopeCosyvoice.protectedHeaders).toContain('X-DashScope-SSE')
    const seen: Array<Record<string, string>> = []
    await runGeneration(
      dashscopeCosyvoice,
      auth({
        dialect: { extraHeaders: { 'X-DashScope-SSE': 'enable', 'X-DashScope-WorkSpace': 'ws1' } },
      }),
      { text: 'x', voice: 'v' },
      {
        fetch: async (url, init) => {
          if (url.startsWith('https://oss.example.com'))
            return new Response(new Uint8Array([1, 2]), {
              headers: { 'content-type': 'audio/mpeg' },
            })
          seen.push(init!.headers as Record<string, string>)
          return new Response(JSON.stringify(ok()))
        },
      },
    )
    expect(seen[0]).not.toHaveProperty('X-DashScope-SSE')
    expect(seen[0]).toMatchObject({
      'X-DashScope-WorkSpace': 'ws1',
      Authorization: 'Bearer sk-ali-secret',
    })
  })

  it('rate: nothing unless asked; outside 0.5-2 it is clamped and reported', () => {
    const none = body(dashscopeCosyvoice.buildGenerateRequest(auth(), { text: 'x', voice: 'v' }))
    expect(none.input).not.toHaveProperty('rate')
    for (const [asked, sent] of [
      [0.25, 0.5],
      [4, 2],
      [1.5, 1.5],
    ] as const) {
      const b = body(
        dashscopeCosyvoice.buildGenerateRequest(auth(), { text: 'x', voice: 'v', speed: asked }),
      )
      expect(b.input.rate).toBe(sent)
    }
    expect(dashscopeCosyvoice.ignoredInputs!(auth(), { text: 'x', speed: 4 })).toEqual(['speed'])
  })

  it('instruction goes to input.instruction', () => {
    const b = body(
      dashscopeCosyvoice.buildGenerateRequest(auth(), {
        text: 'x',
        voice: 'v',
        instructions: '用四川话说',
      }),
    )
    expect(b.input.instruction).toBe('用四川话说')
  })

  it('instruction length: 100 characters with a Chinese character counting as 2, checked before any request', () => {
    expect(instructionLength('abc')).toBe(3)
    expect(instructionLength('四川话')).toBe(6)
    expect(instructionLength('a四')).toBe(3)
    const fifty = '字'.repeat(50)
    const fiftyOne = '字'.repeat(51)
    expect(
      dashscopeCosyvoice.inputProblem!(auth(), { text: 'x', instructions: fifty }),
    ).toBeUndefined()
    expect(
      dashscopeCosyvoice.inputProblem!(auth(), { text: 'x', instructions: fiftyOne }),
    ).toMatchObject({
      code: 'INSTRUCTION_TOO_LONG',
    })
    expect(() =>
      dashscopeCosyvoice.buildGenerateRequest(auth(), {
        text: 'x',
        voice: 'v',
        instructions: fiftyOne,
      }),
    ).toThrow(expect.objectContaining({ kind: 'capability', code: 'INSTRUCTION_TOO_LONG' }))
  })

  it('language_hints: one official code only; unknown ones are dropped and reported', () => {
    const b = body(
      dashscopeCosyvoice.buildGenerateRequest(auth(), { text: 'x', voice: 'v', language: 'ZH' }),
    )
    expect(b.input.language_hints).toEqual(['zh'])
    const unk = body(
      dashscopeCosyvoice.buildGenerateRequest(auth(), {
        text: 'x',
        voice: 'v',
        language: 'klingon',
      }),
    )
    expect(unk.input).not.toHaveProperty('language_hints')
    expect(dashscopeCosyvoice.ignoredInputs!(auth(), { text: 'x', language: 'klingon' })).toEqual([
      'language',
    ])
    expect(dashscopeCosyvoice.ignoredInputs!(auth(), { text: 'x', language: 'ja' })).toEqual([])
  })

  it('wav is sent as wav; ogg is refused; a missing voice is refused (no default is guessed)', () => {
    expect(
      body(
        dashscopeCosyvoice.buildGenerateRequest(auth(), { text: 'x', voice: 'v', format: 'wav' }),
      ).input.format,
    ).toBe('wav')
    expect(() =>
      dashscopeCosyvoice.buildGenerateRequest(auth(), { text: 'x', voice: 'v', format: 'ogg' }),
    ).toThrow(expect.objectContaining({ code: 'FORMAT_UNSUPPORTED' }))
    expect(() => dashscopeCosyvoice.buildGenerateRequest(auth(), { text: 'x' })).toThrow(
      expect.objectContaining({ code: 'VOICE_REQUIRED' }),
    )
  })

  it('the registry returns it; it is a sync protocol', () => {
    expect(getMediaProtocol('dashscope-cosyvoice')).toBe(dashscopeCosyvoice)
    expect(dashscopeCosyvoice.buildPollRequest).toBeUndefined()
  })
})

describe('dashscope-cosyvoice: the response', () => {
  it('gives a url output with an audio type hint (storage often answers octet-stream)', () => {
    expect(dashscopeCosyvoice.parseGenerateResponse(raw(ok()))).toEqual({
      status: 'sync',
      outputs: [{ kind: 'url', url: URL_OK, mime: 'audio/mpeg' }],
    })
    expect(
      dashscopeCosyvoice.parseGenerateResponse(raw(ok('https://x.example/a.wav?sig=1'))),
    ).toMatchObject({
      outputs: [{ mime: 'audio/wav' }],
    })
  })

  const bad: Array<[string, unknown]> = [
    ['not JSON', undefined],
    ['a JSON array', []],
    ['no output', { request_id: 'r' }],
    ['output without audio', { output: { finish_reason: 'stop' } }],
    ['audio without url', { output: { audio: { id: 'a' } } }],
    ['empty url', ok('')],
    ['url is not a string', ok(42)],
    ['url is not http', ok('ftp://x/y.mp3')],
    ['streaming-style base64 data only', { output: { audio: { data: 'AAAA' } } }],
  ]
  it.each(bad)('%s is a failed parse, not a clear rejection', (_n, json) => {
    const r = dashscopeCosyvoice.parseGenerateResponse(
      json === undefined ? { status: 200, headers: {}, text: 'oops' } : raw(json),
    )
    expect(r.status).toBe('failed')
    expect(r).not.toHaveProperty('rejected')
  })

  it('a business error inside a 200 body keeps the upstream code but is NOT called a clear rejection (the page says nothing about charging)', () => {
    const r = dashscopeCosyvoice.parseGenerateResponse(
      raw({ code: 'InvalidParameter', message: 'voice not found', request_id: 'r' }),
    )
    expect(r).toMatchObject({
      status: 'failed',
      code: 'InvalidParameter',
      message: 'voice not found',
    })
    expect(r).not.toHaveProperty('rejected')
  })

  it('HTTP error bodies: code and message are read; only 429 / 5xx are retryable', () => {
    const e = (status: number, json: unknown) =>
      dashscopeCosyvoice.parseHttpError!({ status, headers: {}, text: JSON.stringify(json), json })
    expect(e(401, { code: 'InvalidApiKey', message: 'bad key', request_id: 'r' })).toEqual({
      code: 'InvalidApiKey',
      message: 'bad key',
      recoverable: false,
    })
    expect(e(400, { code: 'Arrearage', message: 'overdue' })).toMatchObject({
      code: 'Arrearage',
      recoverable: false,
    })
    expect(e(429, { code: 'Throttling.RateQuota', message: 'slow' })).toMatchObject({
      recoverable: true,
    })
    expect(e(503, { code: 'ServiceUnavailable' })).toEqual({
      code: 'ServiceUnavailable',
      recoverable: true,
    })
    expect(e(502, undefined)).toEqual({ recoverable: true })
  })
})

describe('dashscope-cosyvoice: through the executor (submit, then the link is downloaded at once)', () => {
  const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
  const fake = (steps: { submit: Response; download?: Response }) => {
    const seen: string[] = []
    return {
      seen,
      fetch: async (url: string) => {
        seen.push(url)
        if (url.startsWith('https://oss.example.com')) return steps.download!.clone()
        return steps.submit.clone()
      },
    }
  }

  it('success: two requests, the second is the signed link without any of our headers; bytes come back typed', async () => {
    const f = fake({
      submit: j(ok()),
      download: new Response(new Uint8Array([7, 8]), {
        headers: { 'content-type': 'application/octet-stream' },
      }),
    })
    const calls: Array<{ url: string; headers: unknown }> = []
    const r = await runGeneration(
      dashscopeCosyvoice,
      auth(),
      { text: 'x', voice: 'v' },
      {
        fetch: async (url, init) => {
          calls.push({ url, headers: init?.headers })
          return f.fetch(url)
        },
      },
    )
    expect(calls.map((c) => c.url)).toEqual([
      'https://ws1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
      URL_OK,
    ])
    expect(calls[1]!.headers).toEqual({}) // no key, no extra headers to the storage host
    expect(r.outputs[0]).toMatchObject({
      bytes: new Uint8Array([7, 8]),
      mime: 'audio/mpeg',
      sourceUrl: URL_OK,
    })
  })

  it('the download failing (403 expired / 404) is a download failure, retried, never a silent empty audio', async () => {
    for (const status of [403, 404, 500]) {
      const f = fake({ submit: j(ok()), download: new Response('denied', { status }) })
      const sleeps: number[] = []
      await expect(
        runGeneration(
          dashscopeCosyvoice,
          auth(),
          { text: 'x', voice: 'v' },
          {
            fetch: async (url) => f.fetch(url),
            sleep: async (ms) => void sleeps.push(ms),
          },
        ),
      ).rejects.toMatchObject({
        kind: 'download_failed',
        code: `HTTP_${status}`,
        recoverable: true,
      })
      expect(f.seen.filter((u) => u.startsWith('https://oss')).length).toBe(3) // 1 try + 2 retries
    }
  })

  it('a network failure while downloading is a download failure too', async () => {
    await expect(
      runGeneration(
        dashscopeCosyvoice,
        auth(),
        { text: 'x', voice: 'v' },
        {
          fetch: async (url) => {
            if (url.startsWith('https://oss')) throw new Error('reset')
            return j(ok())
          },
          sleep: async () => {},
        },
      ),
    ).rejects.toMatchObject({ kind: 'download_failed', recoverable: true })
  })

  it('HTTP 401 / 429 / 500 on submit use the error body; 4xx rejected, 5xx unknown', async () => {
    const run = (res: Response) =>
      runGeneration(
        dashscopeCosyvoice,
        auth(),
        { text: 'x', voice: 'v' },
        { fetch: async () => res.clone() },
      )
    await expect(run(j({ code: 'InvalidApiKey', message: 'k' }, 401))).rejects.toMatchObject({
      kind: 'http',
      code: 'InvalidApiKey',
      submission: 'rejected',
    })
    await expect(run(j({ code: 'Throttling.RateQuota', message: 'k' }, 429))).rejects.toMatchObject(
      {
        code: 'Throttling.RateQuota',
        recoverable: true,
      },
    )
    await expect(run(new Response('upstream down', { status: 500 }))).rejects.toMatchObject({
      code: 'HTTP_500',
      submission: 'unknown',
    })
  })

  it('empty body / non-JSON / missing url / a business error in a 200 body', async () => {
    const run = (res: Response) =>
      runGeneration(
        dashscopeCosyvoice,
        auth(),
        { text: 'x', voice: 'v' },
        { fetch: async () => res.clone() },
      )
    for (const res of [new Response(''), new Response('plain text'), j({ output: {} })]) {
      await expect(run(res)).rejects.toMatchObject({
        kind: 'parse',
        code: 'UNREADABLE_RESPONSE',
        submission: 'unknown',
      })
    }
    await expect(
      run(j({ code: 'DataInspectionFailed', message: 'content' })),
    ).rejects.toMatchObject({
      kind: 'parse',
      code: 'DataInspectionFailed',
      submission: 'unknown', // an error shape the official page does not describe: not assumed to be free of charge
    })
  })
})
