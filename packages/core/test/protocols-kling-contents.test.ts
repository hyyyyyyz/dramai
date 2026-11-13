import { describe, expect, it } from 'vitest'
import { ProviderError } from '../src/providers/errors.ts'
import { runGeneration } from '../src/providers/executor.ts'
import { getMediaProtocol, klingContents } from '../src/providers/protocols/index.ts'
import type { AuthContext, RawResponse, VideoGenInput } from '../src/providers/types.ts'

const SG = 'https://api-singapore.klingai.com'
const BJ = 'https://api-beijing.klingai.com'
const auth = (model = 'kling-4.0', baseUrl = SG): AuthContext => ({
  baseUrl,
  model,
  apiKey: 'kl-key',
  method: 'api_key',
})
const png = (n: number) => ({ bytes: new Uint8Array([n, n, n]), mime: 'image/png' })
const b64 = (n: number) => Buffer.from([n, n, n]).toString('base64')
const ref = (n: number) => ({
  kind: 'image' as const,
  media: { kind: 'bytes' as const, ...png(n) },
})
const raw = (json: unknown, status = 200): RawResponse => ({
  status,
  headers: {},
  text: JSON.stringify(json),
  json,
})
const build = (input: VideoGenInput, a = auth()) => {
  const spec = klingContents.buildGenerateRequest(a, input)
  return { url: spec.url, body: (spec.body as { value: Record<string, unknown> }).value, spec }
}
const base = { prompt: '开场', durationSec: 5, aspectRatio: '9:16' as const, resolution: '720p' }
const options = { watermark_info: { enabled: false } }

describe('kling-contents: endpoint and body per model and task type', () => {
  it('headers: Bearer API key, JSON', () => {
    expect(build({ ...base, image: png(1) }).spec.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer kl-key',
    })
  })

  it('4.0 text to video: its own endpoint, top-level prompt, an explicit ratio, no contents', () => {
    const { url, body } = build(base)
    expect(url).toBe(`${SG}/text-to-video/kling-4.0`)
    expect(body).toEqual({
      prompt: '开场',
      settings: { resolution: '720p', duration: 5, aspect_ratio: '9:16' },
      options,
    })
  })

  it('4.0 image to video: image-to-video endpoint, raw base64 first_frame, no aspect ratio and no audio setting', () => {
    const { url, body } = build({ ...base, image: png(1), withAudio: true })
    expect(url).toBe(`${SG}/image-to-video/kling-4.0`)
    expect(body).toEqual({
      contents: [
        { type: 'prompt', text: '开场' },
        { type: 'first_frame', url: b64(1) },
      ],
      settings: { resolution: '720p', duration: 5 },
      options,
    })
  })

  it('4.0 first + last frame: last frame is the last item', () => {
    const { url, body } = build({ ...base, image: png(1), lastImage: png(2) })
    expect(url).toBe(`${SG}/image-to-video/kling-4.0`)
    expect((body.contents as Array<{ type: string }>).map((c) => c.type)).toEqual([
      'prompt',
      'first_frame',
      'last_frame',
    ])
  })

  it('4.0 with reference images: omni endpoint, ids image_1…, the frame may go together with the references', () => {
    const { url, body } = build({
      ...base,
      cameraInstruction: '推近',
      image: png(1),
      lastImage: png(9),
      references: [ref(2), ref(3)],
      withAudio: true,
    })
    expect(url).toBe(`${SG}/omni-video/kling-4.0`)
    expect(body).toEqual({
      contents: [
        { type: 'prompt', text: '开场. 推近' },
        { type: 'first_frame', url: b64(1) },
        { type: 'refer_image', url: b64(2), id: 'image_1' },
        { type: 'refer_image', url: b64(3), id: 'image_2' },
        { type: 'last_frame', url: b64(9) },
      ],
      settings: { resolution: '720p', duration: 5, aspect_ratio: 'adaptive', audio: 'native' },
      options,
    })
  })

  it('omni without a frame uses the project ratio; audio is only sent when asked (it cannot be switched off)', () => {
    const { body } = build({ ...base, references: [ref(2)] })
    expect(body.settings).toEqual({ resolution: '720p', duration: 5, aspect_ratio: '9:16' })
  })

  it('url references go through as they are; a reference video must be a public url', () => {
    const { body } = build({
      ...base,
      references: [
        { kind: 'image', media: { kind: 'url', url: 'https://x/a.png' } },
        { kind: 'video', media: { kind: 'url', url: 'https://x/v.mp4' } },
      ],
    })
    expect(body.contents).toEqual([
      { type: 'prompt', text: '开场' },
      { type: 'refer_image', url: 'https://x/a.png', id: 'image_1' },
      { type: 'feature_video', url: 'https://x/v.mp4', id: 'video_1' },
    ])
  })

  it.each([
    ['text to video', {}, '/omni-video/kling-4.0-flash'],
    ['image to video', { image: png(1) }, '/omni-video/kling-4.0-flash'],
    ['references', { references: [ref(2)] }, '/omni-video/kling-4.0-flash'],
  ])('4.0 Flash always uses the omni endpoint: %s', (_n, extra, path) => {
    const { url, body } = build({ ...base, ...extra }, auth('kling-4.0-flash'))
    expect(url).toBe(`${SG}${path}`)
    expect(Array.isArray(body.contents)).toBe(true)
  })

  it('the domestic host differs only by address', () => {
    expect(build({ ...base, image: png(1) }, auth('kling-4.0', BJ)).url).toBe(
      `${BJ}/image-to-video/kling-4.0`,
    )
  })

  it.each([
    ['last frame only', { lastImage: png(2) }, 'FIRST_FRAME_REQUIRED'],
    [
      'an asset-id image (kling elements are not supported)',
      { references: [{ kind: 'image' as const, media: { kind: 'asset' as const, id: 'e1' } }] },
      'REFERENCE_KIND_UNSUPPORTED',
    ],
    [
      'local video bytes',
      {
        references: [
          {
            kind: 'video' as const,
            media: { kind: 'bytes' as const, bytes: new Uint8Array([1]), mime: 'video/mp4' },
          },
        ],
      },
      'REFERENCE_KIND_UNSUPPORTED',
    ],
    [
      'an audio reference',
      {
        references: [
          { kind: 'audio' as const, media: { kind: 'url' as const, url: 'https://x/a.mp3' } },
        ],
      },
      'REFERENCE_KIND_UNSUPPORTED',
    ],
  ])('refuses %s', (_n, extra, code) => {
    try {
      build({ ...base, ...extra } as VideoGenInput)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError)
      expect((e as ProviderError).code).toBe(code)
    }
  })
})

describe('kling-contents: responses', () => {
  it('submit', () => {
    expect(
      klingContents.parseGenerateResponse(
        raw({ code: 0, data: { id: 'k1', status: 'submitted' } }),
      ),
    ).toEqual({
      status: 'async',
      taskId: 'k1',
    })
    expect(klingContents.parseGenerateResponse(raw({ code: 1201, message: 'bad param' }))).toEqual({
      status: 'failed',
      message: 'bad param',
    })
    expect(klingContents.parseGenerateResponse(raw({ code: 0, data: {} })).status).toBe('failed')
  })

  it('poll request: GET /tasks?task_ids= with the encoded id', () => {
    expect(klingContents.buildPollRequest!(auth('kling-4.0', BJ), 'a b/1')).toEqual({
      method: 'GET',
      url: `${BJ}/tasks?task_ids=a%20b%2F1`,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer kl-key' },
    })
  })

  const task = (t: Record<string, unknown>) => raw({ code: 0, message: 'ok', data: [t] })
  it.each([
    ['submitted', task({ id: '1', status: 'submitted' }), { status: 'queued' }],
    ['processing', task({ id: '1', status: 'processing' }), { status: 'processing' }],
    ['unknown word', task({ id: '1', status: 'zzz' }), { status: 'queued' }],
    [
      'succeeded: the video is picked out of mixed outputs, duration is a string',
      task({
        status: 'succeeded',
        outputs: [
          { type: 'audio', mp3_url: 'https://a.mp3' },
          {
            type: 'video',
            id: 'v',
            url: 'https://v/1.mp4',
            watermark_url: 'https://v/w.mp4',
            duration: '5.04',
          },
        ],
      }),
      {
        status: 'completed',
        durationSec: 5.04,
        outputs: [{ kind: 'url', url: 'https://v/1.mp4', mime: 'video/mp4', role: 'video' }],
      },
    ],
    [
      'succeeded with no video',
      task({ status: 'succeeded', outputs: [{ type: 'image', url: 'https://i.png' }] }),
      { status: 'failed', message: 'Kling: 任务成功但 outputs 里没有视频地址' },
    ],
    [
      'failed with a reason',
      task({ status: 'failed', message: 'content blocked' }),
      { status: 'failed', message: 'content blocked' },
    ],
    [
      'failed without a reason',
      task({ status: 'failed' }),
      { status: 'failed', message: 'Kling 任务失败（未提供原因）' },
    ],
    [
      'empty data right after submit: keep waiting',
      raw({ code: 0, data: [] }),
      { status: 'queued' },
    ],
    [
      'business error without data',
      raw({ code: 1002, message: 'Authorization is invalid' }),
      { status: 'failed', message: 'Authorization is invalid' },
    ],
  ])('poll: %s', (_n, r, expected) => {
    expect(klingContents.parsePollResponse!(r)).toEqual(expected)
  })

  it.each([
    [401, { code: 1002, message: 'Authorization is invalid' }, 'KLING_1002', false],
    [429, { code: 1101, message: 'in arrears' }, 'KLING_1101', false],
    [429, { code: 1102, message: 'package exhausted' }, 'KLING_1102', false],
    [403, { code: 1103, message: 'no access' }, 'KLING_1103', false],
    [400, { code: 1301, message: 'content policy' }, 'KLING_1301', false],
    [429, { code: 1302, message: 'rate limit' }, 'KLING_1302', true],
    [429, { code: 1303, message: 'parallel task over resource pack limit' }, 'KLING_1303', true],
    [500, { code: 5000, message: 'internal' }, 'KLING_5000', true],
    [503, { code: 5001, message: 'maintenance' }, 'KLING_5001', true],
    [504, { code: 5002, message: 'timeout' }, 'KLING_5002', true],
    [502, 'gateway html', undefined, true],
  ])('http error %i %j', (status, json, code, recoverable) => {
    const r = klingContents.parseHttpError!(raw(json, status))
    expect(r.code).toBe(code)
    expect(r.recoverable).toBe(recoverable)
  })
})

describe('kling-contents: through the executor with a fake fetch', () => {
  it('submit → poll → download (the signed url is fetched as is); extra headers on submit and poll only', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } })
      if (url.includes('/image-to-video/'))
        return new Response(JSON.stringify({ code: 0, data: { id: 'T7', status: 'submitted' } }))
      if (url.includes('/tasks?')) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: [
              {
                id: 'T7',
                status: 'succeeded',
                outputs: [{ type: 'video', url: 'https://cdn/k.mp4?sig=abc', duration: '5' }],
              },
            ],
          }),
        )
      }
      return new Response(new Uint8Array([4]), { headers: { 'content-type': 'video/mp4' } })
    }
    const res = await runGeneration(
      getMediaProtocol('kling-contents'),
      { ...auth(), dialect: { extraHeaders: { 'X-Team': 't' } } },
      { ...base, image: png(1) },
      { fetch, sleep: async () => {} },
    )
    expect(res.taskId).toBe('T7')
    expect(res.durationSec).toBe(5)
    expect(calls.map((c) => c.url)).toEqual([
      `${SG}/image-to-video/kling-4.0`,
      `${SG}/tasks?task_ids=T7`,
      'https://cdn/k.mp4?sig=abc',
    ])
    expect(calls[0]!.headers['X-Team']).toBe('t')
    expect(calls[1]!.headers['X-Team']).toBe('t')
    expect(calls[2]!.headers).toEqual({})
  })

  it('concurrency over the limit surfaces as a retryable stable code', async () => {
    const fetch = async () =>
      new Response(
        JSON.stringify({ code: 1303, message: 'parallel task over resource pack limit' }),
        { status: 429 },
      )
    try {
      await runGeneration(klingContents, auth(), { ...base, image: png(1) }, { fetch })
      throw new Error('should fail')
    } catch (e) {
      const err = e as ProviderError
      expect(err).toMatchObject({
        code: 'KLING_1303',
        status: 429,
        recoverable: true,
        submission: 'rejected',
      })
    }
  })
})

describe('review fix 4: the shape of data in the poll response', () => {
  it('an object works like a one-element array', () => {
    const t = {
      id: '1',
      status: 'succeeded',
      outputs: [{ type: 'video', url: 'https://v/1.mp4', duration: '5' }],
    }
    expect(klingContents.parsePollResponse!(raw({ code: 0, data: t }))).toEqual(
      klingContents.parsePollResponse!(raw({ code: 0, data: [t] })),
    )
    expect(
      klingContents.parsePollResponse!(raw({ code: 0, data: { status: 'processing' } })),
    ).toEqual({ status: 'processing' })
    expect(
      klingContents.parsePollResponse!(
        raw({ code: 0, data: { status: 'failed', message: 'blocked' } }),
      ),
    ).toEqual({
      status: 'failed',
      message: 'blocked',
    })
  })

  it('anything else that is present is a parse failure (thrown), not "still queued"', () => {
    for (const data of ['oops', 5, null, true])
      expect(
        () => klingContents.parsePollResponse!(raw({ code: 0, data })),
        JSON.stringify(data),
      ).toThrow()
    // absent or empty keeps waiting, as before
    expect(klingContents.parsePollResponse!(raw({ code: 0 }))).toEqual({ status: 'queued' })
    expect(klingContents.parsePollResponse!(raw({ code: 0, data: [] }))).toEqual({
      status: 'queued',
    })
  })

  it('through the executor: a few unreadable polls are retried, an endless run of them ends as POLL_FAILED', async () => {
    let n = 0
    const fetch = async (url: string) => {
      if (url.includes('/text-to-video/'))
        return new Response(JSON.stringify({ code: 0, data: { id: 'T' } }))
      n++
      return new Response(JSON.stringify({ code: 0, data: 'garbage' }))
    }
    try {
      await runGeneration(klingContents, auth(), base, { fetch, sleep: async () => {} })
      throw new Error('should fail')
    } catch (e) {
      expect((e as ProviderError).code).toBe('POLL_FAILED')
    }
    expect(n).toBe(5)
  })
})

describe('follow-up 4: an array whose first item is not an object', () => {
  it('is a parse failure, like a data that is neither array nor object', () => {
    for (const data of [[null], ['x'], [5], [[]], [true]])
      expect(
        () => klingContents.parsePollResponse!(raw({ code: 0, data })),
        JSON.stringify(data),
      ).toThrow()
    // an empty array and a real first item are unchanged
    expect(klingContents.parsePollResponse!(raw({ code: 0, data: [] }))).toEqual({
      status: 'queued',
    })
    expect(
      klingContents.parsePollResponse!(raw({ code: 0, data: [{ status: 'processing' }] })),
    ).toEqual({ status: 'processing' })
  })

  it('through the executor it ends as POLL_FAILED instead of waiting for the poll timeout', async () => {
    let polls = 0
    const fetch = async (url: string) => {
      if (url.includes('/text-to-video/'))
        return new Response(JSON.stringify({ code: 0, data: { id: 'T' } }))
      polls++
      return new Response(JSON.stringify({ code: 0, data: [null] }))
    }
    try {
      await runGeneration(klingContents, auth(), base, { fetch, sleep: async () => {} })
      throw new Error('should fail')
    } catch (e) {
      expect((e as ProviderError).code).toBe('POLL_FAILED')
    }
    expect(polls).toBe(5)
  })
})
