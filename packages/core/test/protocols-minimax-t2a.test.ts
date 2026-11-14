import { describe, expect, it } from 'vitest'
import { runGeneration } from '../src/providers/executor.ts'
import { getMediaProtocol, hexToBytes, minimaxT2a } from '../src/providers/protocols/index.ts'
import type { AuthContext, HttpRequestSpec, RawResponse } from '../src/providers/types.ts'

/** MiniMax T2A v2 (sync, hex audio). Built from the official pages of 2026-11-13; never run against the real service. */

const auth = (over: Partial<AuthContext> = {}): AuthContext => ({
  baseUrl: 'https://api.minimax.io/v1',
  model: 'speech-2.8-hd',
  apiKey: 'sk-mm-secret',
  method: 'api_key',
  ...over,
})
const body = (spec: HttpRequestSpec) => (spec.body as { value: Record<string, unknown> }).value
const HEX = Buffer.from([0x49, 0x44, 0x33, 4, 5]).toString('hex') // "ID3" + 2 bytes
const ok = (extra: Record<string, unknown> = {}) => ({
  data: { audio: HEX, status: 2 },
  extra_info: { audio_format: 'mp3', audio_length: 1200 },
  base_resp: { status_code: 0, status_msg: 'success' },
  ...extra,
})
const raw = (json: unknown, over: Partial<RawResponse> = {}): RawResponse => ({
  status: 200,
  headers: {},
  text: JSON.stringify(json),
  json,
  ...over,
})

describe('minimax-t2a: the request', () => {
  it('POST {baseUrl}/t2a_v2 with the key in the Authorization header only', () => {
    const spec = minimaxT2a.buildGenerateRequest(auth(), {
      text: '你好',
      voice: 'Chinese (Mandarin)_News_Anchor',
      speed: 1.2,
    })
    expect(spec.method).toBe('POST')
    expect(spec.url).toBe('https://api.minimax.io/v1/t2a_v2')
    expect(spec.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-mm-secret',
    })
    expect(body(spec)).toEqual({
      model: 'speech-2.8-hd',
      text: '你好',
      stream: false,
      voice_setting: { voice_id: 'Chinese (Mandarin)_News_Anchor', speed: 1.2 },
      audio_setting: { format: 'mp3' },
      output_format: 'hex',
    })
    expect(spec.url).not.toContain('sk-mm-secret')
    expect(JSON.stringify(spec.body)).not.toContain('sk-mm-secret')
  })

  it('trailing slashes in the address are normalised; the China site address works the same way', () => {
    const spec = minimaxT2a.buildGenerateRequest(auth({ baseUrl: 'https://api.minimax.cn/v1//' }), {
      text: 'x',
      voice: 'v',
    })
    expect(spec.url).toBe('https://api.minimax.cn/v1/t2a_v2')
  })

  it('no speed is sent unless asked; speed outside 0.5-2 is clamped and reported', () => {
    const none = body(minimaxT2a.buildGenerateRequest(auth(), { text: 'x', voice: 'v' }))
    expect(none.voice_setting).toEqual({ voice_id: 'v' })
    for (const [asked, sent] of [
      [0.25, 0.5],
      [4, 2],
      [0.5, 0.5],
      [2, 2],
      [1, 1],
    ] as const) {
      const b = body(
        minimaxT2a.buildGenerateRequest(auth(), { text: 'x', voice: 'v', speed: asked }),
      )
      expect((b.voice_setting as { speed: number }).speed).toBe(sent)
    }
    expect(minimaxT2a.ignoredInputs!(auth(), { text: 'x', speed: 4 })).toEqual(['speed'])
    expect(minimaxT2a.ignoredInputs!(auth(), { text: 'x', speed: 1.5 })).toEqual([])
  })

  it('maps the language hint to the four official spellings; others are dropped and reported', () => {
    const lang = (language: string) =>
      body(minimaxT2a.buildGenerateRequest(auth(), { text: 'x', voice: 'v', language }))
        .language_boost
    expect(lang('zh')).toBe('Chinese')
    expect(lang('yue')).toBe('Chinese,Yue')
    expect(lang('EN')).toBe('English')
    expect(lang('ja')).toBe('Japanese')
    expect(lang('ko')).toBeUndefined()
    expect(minimaxT2a.ignoredInputs!(auth(), { text: 'x', language: 'ko' })).toEqual(['language'])
    expect(minimaxT2a.ignoredInputs!(auth(), { text: 'x', language: 'zh' })).toEqual([])
  })

  it('instructions have no counterpart: dropped and reported', () => {
    const b = body(
      minimaxT2a.buildGenerateRequest(auth(), { text: 'x', voice: 'v', instructions: '低沉' }),
    )
    expect(JSON.stringify(b)).not.toContain('低沉')
    expect(minimaxT2a.ignoredInputs!(auth(), { text: 'x', instructions: '低沉' })).toEqual([
      'instructions',
    ])
  })

  it('wav is sent as wav; ogg is refused instead of guessed; a missing voice is refused before any request', () => {
    expect(
      body(minimaxT2a.buildGenerateRequest(auth(), { text: 'x', voice: 'v', format: 'wav' }))
        .audio_setting,
    ).toEqual({ format: 'wav' })
    expect(() =>
      minimaxT2a.buildGenerateRequest(auth(), { text: 'x', voice: 'v', format: 'ogg' }),
    ).toThrow(expect.objectContaining({ kind: 'capability', code: 'FORMAT_UNSUPPORTED' }))
    expect(() => minimaxT2a.buildGenerateRequest(auth(), { text: 'x' })).toThrow(
      expect.objectContaining({ kind: 'capability', code: 'VOICE_REQUIRED' }),
    )
  })

  it('declares no async parts and the registry returns it', () => {
    expect(getMediaProtocol('minimax-t2a')).toBe(minimaxT2a)
    expect(minimaxT2a.media).toBe('audio')
    expect(minimaxT2a.buildPollRequest).toBeUndefined()
  })
})

describe('minimax-t2a: the response', () => {
  it('decodes the hex audio into bytes with the right type', () => {
    const r = minimaxT2a.parseGenerateResponse(raw(ok()))
    expect(r).toEqual({
      status: 'sync',
      outputs: [
        { kind: 'bytes', bytes: new Uint8Array([0x49, 0x44, 0x33, 4, 5]), mime: 'audio/mpeg' },
      ],
    })
    const wav = minimaxT2a.parseGenerateResponse(raw(ok({ extra_info: { audio_format: 'wav' } })))
    expect(wav).toMatchObject({ outputs: [{ mime: 'audio/wav' }] })
    const noInfo = minimaxT2a.parseGenerateResponse(raw({ data: { audio: HEX, status: 2 } }))
    expect(noInfo).toMatchObject({ status: 'sync', outputs: [{ mime: 'audio/mpeg' }] })
  })

  it('accepts upper case hex and a string "0" status code', () => {
    const r = minimaxT2a.parseGenerateResponse(
      raw(ok({ data: { audio: HEX.toUpperCase(), status: 2 }, base_resp: { status_code: '0' } })),
    )
    expect(r.status).toBe('sync')
  })

  const bad: Array<[string, unknown]> = [
    ['not JSON at all', undefined],
    ['a JSON array', [1, 2]],
    ['a JSON string', 'hello'],
    ['no data', { base_resp: { status_code: 0 } }],
    ['data without audio', { data: { status: 2 }, base_resp: { status_code: 0 } }],
    ['empty audio', { data: { audio: '', status: 2 }, base_resp: { status_code: 0 } }],
    ['audio is not a string', { data: { audio: 12, status: 2 }, base_resp: { status_code: 0 } }],
    ['odd-length hex', { data: { audio: 'abc', status: 2 }, base_resp: { status_code: 0 } }],
    ['non-hex characters', { data: { audio: 'zz11', status: 2 }, base_resp: { status_code: 0 } }],
    [
      'base64 instead of hex',
      { data: { audio: 'SUQzBAU=', status: 2 }, base_resp: { status_code: 0 } },
    ],
    ['still synthesizing', { data: { audio: HEX, status: 1 }, base_resp: { status_code: 0 } }],
  ]
  it.each(bad)('%s is a failed parse that is NOT called a clear rejection', (_name, json) => {
    const r = minimaxT2a.parseGenerateResponse(
      json === undefined ? { status: 200, headers: {}, text: 'oops' } : raw(json),
    )
    expect(r.status).toBe('failed')
    expect(r).not.toHaveProperty('rejected')
  })

  it('hex decoding is strict', () => {
    expect(hexToBytes('00ff')).toEqual(new Uint8Array([0, 255]))
    expect(hexToBytes('')).toBeUndefined()
    expect(hexToBytes('0')).toBeUndefined()
    expect(hexToBytes('0g')).toBeUndefined()
  })

  const codes: Array<[number, string]> = [
    [1004, '鉴权失败'],
    [2049, '鉴权失败'],
    [1008, '余额不足'],
    [1002, '稍后再试'],
    [1039, '稍后再试'],
    [1026, '敏感内容'],
    [2013, '参数不合法'],
    [20132, '音色不存在'],
    [2054, '音色不存在'],
    [2042, '音色不存在'],
    [2043, '不支持该音色'],
    [2022, '型号不存在'],
    [1000, '稍后再试'],
  ]
  it.each(codes)(
    'base_resp status_code %i is a clear rejection with a stable code and a hint',
    (code, hint) => {
      const r = minimaxT2a.parseGenerateResponse(
        raw({ base_resp: { status_code: code, status_msg: 'upstream words' } }),
      )
      expect(r).toMatchObject({ status: 'failed', rejected: true, code: `MINIMAX_${code}` })
      const message = (r as { message: string }).message
      expect(message).toContain(hint)
      expect(message).toContain('upstream words')
    },
  )

  it('an unknown code still gets its stable code and the upstream words', () => {
    const r = minimaxT2a.parseGenerateResponse(
      raw({ base_resp: { status_code: 9999, status_msg: 'brand new' } }),
    )
    expect(r).toMatchObject({ rejected: true, code: 'MINIMAX_9999' })
    expect((r as { message: string }).message).toContain('brand new')
  })

  it('a failure code wins even when audio is present', () => {
    const r = minimaxT2a.parseGenerateResponse(
      raw(ok({ base_resp: { status_code: 1008, status_msg: 'x' } })),
    )
    expect(r).toMatchObject({ rejected: true, code: 'MINIMAX_1008' })
  })

  it('HTTP error bodies: the code and words are read; 429 / 5xx are retryable, 401 is not', () => {
    const e = (status: number, json: unknown) =>
      minimaxT2a.parseHttpError!({ status, headers: {}, text: JSON.stringify(json), json })
    expect(e(401, { base_resp: { status_code: 1004, status_msg: 'bad key' } })).toMatchObject({
      code: 'MINIMAX_1004',
      recoverable: false,
    })
    expect(e(429, { base_resp: { status_code: 1002, status_msg: 'slow down' } })).toMatchObject({
      code: 'MINIMAX_1002',
      recoverable: true,
    })
    expect(e(500, { error: { message: 'boom' } })).toMatchObject({
      message: 'boom',
      recoverable: true,
    })
    expect(e(400, { message: 'bad body' })).toMatchObject({
      message: 'bad body',
      recoverable: false,
    })
    expect(
      minimaxT2a.parseHttpError!({ status: 502, headers: {}, text: '<html>', json: undefined }),
    ).toEqual({
      recoverable: true,
    })
  })
})

describe('minimax-t2a: through the executor', () => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
  const run = (res: Response, over: Partial<AuthContext> = {}) => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    return {
      seen,
      promise: runGeneration(
        minimaxT2a,
        auth(over),
        { text: '旁白', voice: 'v' },
        {
          fetch: async (url, init) => {
            seen.push({ url, init })
            return res.clone()
          },
        },
      ),
    }
  }

  it('a good answer gives the decoded bytes in one request, nothing is downloaded', async () => {
    const { seen, promise } = run(json(ok()))
    const r = await promise
    expect(seen).toHaveLength(1)
    expect(r.outputs).toEqual([
      { bytes: new Uint8Array([0x49, 0x44, 0x33, 4, 5]), mime: 'audio/mpeg' },
    ])
  })

  it('HTTP 200 with a business error is an upstream failure with the stable code, rejected (no charge, not "unknown")', async () => {
    const { promise } = run(json({ base_resp: { status_code: 1004, status_msg: 'invalid key' } }))
    await expect(promise).rejects.toMatchObject({
      kind: 'upstream_failed',
      code: 'MINIMAX_1004',
      submission: 'rejected',
    })
  })

  it('HTTP 401 / 429 / 500 use the error body; 4xx is rejected, 5xx is unknown', async () => {
    await expect(
      run(json({ base_resp: { status_code: 1004, status_msg: 'k' } }, 401)).promise,
    ).rejects.toMatchObject({ kind: 'http', code: 'MINIMAX_1004', submission: 'rejected' })
    await expect(
      run(json({ base_resp: { status_code: 1002, status_msg: 'k' } }, 429)).promise,
    ).rejects.toMatchObject({ code: 'MINIMAX_1002', recoverable: true })
    await expect(
      run(new Response('<html>bad gateway</html>', { status: 502 })).promise,
    ).rejects.toMatchObject({
      kind: 'http',
      code: 'HTTP_502',
      submission: 'unknown',
    })
  })

  it('an empty body, non-JSON and broken hex are parse failures with an unknown submission outcome', async () => {
    for (const res of [
      new Response('', { status: 200 }),
      new Response('not json', { status: 200 }),
      json({ data: { audio: 'xyz', status: 2 }, base_resp: { status_code: 0 } }),
      json({ data: {}, base_resp: { status_code: 0 } }),
    ]) {
      await expect(run(res).promise).rejects.toMatchObject({
        kind: 'parse',
        submission: 'unknown',
        code: 'UNREADABLE_RESPONSE',
      })
    }
  })

  it('user extra headers join the request but cannot replace the key or the content type; the key stays out of the URL', async () => {
    const { seen, promise } = run(json(ok()), {
      dialect: {
        extraHeaders: { 'X-Gateway': 'g', Authorization: 'Bearer evil', 'content-type': 'x/y' },
      },
    })
    await promise
    const h = seen[0]!.init!.headers as Record<string, string>
    expect(h).toMatchObject({
      'X-Gateway': 'g',
      Authorization: 'Bearer sk-mm-secret',
      'Content-Type': 'application/json',
    })
    expect(Object.values(h)).not.toContain('Bearer evil')
    expect(seen[0]!.url).not.toContain('sk-mm-secret')
  })

  it('a network failure is "unknown" (the request may have been accepted)', async () => {
    await expect(
      runGeneration(
        minimaxT2a,
        auth(),
        { text: 'x', voice: 'v' },
        {
          fetch: async () => {
            throw new Error('socket hang up')
          },
        },
      ),
    ).rejects.toMatchObject({ kind: 'network', submission: 'unknown' })
  })
})

describe('executor: a failed submit parse can carry a code and a clear rejection', () => {
  it('without the new fields the behaviour is the old one (UNREADABLE_RESPONSE, unknown)', async () => {
    const proto = {
      ...minimaxT2a,
      parseGenerateResponse: () => ({ status: 'failed' as const, message: 'plain' }),
    }
    await expect(
      runGeneration(
        proto,
        auth(),
        { text: 'x', voice: 'v' },
        { fetch: async () => new Response('{}') },
      ),
    ).rejects.toMatchObject({ kind: 'parse', code: 'UNREADABLE_RESPONSE', submission: 'unknown' })
  })
})
