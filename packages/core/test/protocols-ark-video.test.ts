import { describe, expect, it } from 'vitest'
import { ProviderError } from '../src/providers/errors.ts'
import { runGeneration } from '../src/providers/executor.ts'
import { arkVideo, getMediaProtocol } from '../src/providers/protocols/index.ts'
import type { AuthContext, RawResponse, VideoGenInput } from '../src/providers/types.ts'

const CN = 'https://ark.cn-beijing.volces.com/api/v3'
const INTL = 'https://ark.ap-southeast.bytepluses.com/api/v3'
const auth = (over: Partial<AuthContext> = {}): AuthContext => ({
  baseUrl: CN,
  model: 'doubao-seedance-2-0-260128',
  apiKey: 'ark-key',
  method: 'api_key',
  ...over,
})
const png = (n: number) => ({ bytes: new Uint8Array([n, n, n]), mime: 'image/png' })
const b64 = (n: number) => Buffer.from([n, n, n]).toString('base64')
const du = (n: number) => `data:image/png;base64,${b64(n)}`
const ref = (n: number, extra: object = {}) => ({
  kind: 'image' as const,
  media: { kind: 'bytes' as const, ...png(n) },
  ...extra,
})
const raw = (json: unknown, status = 200): RawResponse => ({
  status,
  headers: {},
  text: JSON.stringify(json),
  json,
})
const body = (input: VideoGenInput, a = auth()) =>
  (arkVideo.buildGenerateRequest(a, input).body as { value: Record<string, unknown> }).value

const base = { prompt: '开场', durationSec: 5, aspectRatio: '9:16' as const, resolution: '720p' }

describe('ark-video: request', () => {
  it('url, method and headers (domestic and international hosts differ only by address)', () => {
    for (const baseUrl of [CN, INTL, `${CN}/`]) {
      const spec = arkVideo.buildGenerateRequest(auth({ baseUrl }), { ...base, image: png(1) })
      expect(spec.method).toBe('POST')
      expect(spec.url).toBe(`${baseUrl.replace(/\/$/, '')}/contents/generations/tasks`)
      expect(spec.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer ark-key',
      })
    }
  })

  it('image to video: first_frame role, ratio adaptive (whatever the project ratio), explicit audio flag', () => {
    expect(body({ ...base, image: png(1) })).toEqual({
      model: 'doubao-seedance-2-0-260128',
      content: [
        { type: 'text', text: '开场' },
        { type: 'image_url', image_url: { url: du(1) }, role: 'first_frame' },
      ],
      resolution: '720p',
      ratio: 'adaptive',
      duration: 5,
      generate_audio: false,
      watermark: false,
    })
  })

  it('first + last frame: both roles, adaptive', () => {
    const b = body({ ...base, image: png(1), lastImage: png(2) })
    expect(b.content).toEqual([
      { type: 'text', text: '开场' },
      { type: 'image_url', image_url: { url: du(1) }, role: 'first_frame' },
      { type: 'image_url', image_url: { url: du(2) }, role: 'last_frame' },
    ])
    expect(b.ratio).toBe('adaptive')
  })

  it('text to video: only text; the project ratio is used', () => {
    expect(body({ ...base, withAudio: true })).toEqual({
      model: 'doubao-seedance-2-0-260128',
      content: [{ type: 'text', text: '开场' }],
      resolution: '720p',
      ratio: '9:16',
      duration: 5,
      generate_audio: true,
      watermark: false,
    })
  })

  it('reference images: reference_image role in the given order, project ratio, no frame', () => {
    const b = body({
      ...base,
      references: [ref(1), ref(2, { purpose: 'character', label: '林夏' }), ref(3)],
    })
    expect(b.content).toEqual([
      { type: 'text', text: '开场' },
      { type: 'image_url', image_url: { url: du(1) }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: du(2) }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: du(3) }, role: 'reference_image' },
    ])
    expect(b.ratio).toBe('9:16')
    expect(JSON.stringify(b)).not.toContain('林夏') // purpose and label are never sent
  })

  it('url and asset references, and audio bytes (base64 audio is allowed by the docs)', () => {
    const b = body({
      ...base,
      references: [
        { kind: 'image', media: { kind: 'asset', id: 'asset-123' } },
        { kind: 'image', media: { kind: 'url', url: 'https://x/a.png' } },
        { kind: 'video', media: { kind: 'url', url: 'https://x/v.mp4' } },
        { kind: 'audio', media: { kind: 'bytes', bytes: new Uint8Array([5]), mime: 'audio/WAV' } },
      ],
    })
    expect(b.content).toEqual([
      { type: 'text', text: '开场' },
      { type: 'image_url', image_url: { url: 'asset://asset-123' }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: 'https://x/a.png' }, role: 'reference_image' },
      { type: 'video_url', video_url: { url: 'https://x/v.mp4' }, role: 'reference_video' },
      {
        type: 'audio_url',
        audio_url: { url: 'data:audio/wav;base64,BQ==' },
        role: 'reference_audio',
      },
    ])
  })

  it('camera instruction joins the prompt; an empty prompt sends no text item', () => {
    expect(
      (body({ ...base, cameraInstruction: '推近', image: png(1) }).content as unknown[])[0],
    ).toEqual({
      type: 'text',
      text: '开场. 推近',
    })
    expect((body({ ...base, prompt: '', image: png(1) }).content as unknown[])[0]).toMatchObject({
      type: 'image_url',
    })
  })

  it('duration is a whole number; resolution and audio have explicit defaults; return_last_frame only when asked', () => {
    const b = body({ prompt: 'p', image: png(1), durationSec: 7.6 })
    expect(b).toMatchObject({ duration: 8, resolution: '720p', generate_audio: false })
    expect(b).not.toHaveProperty('return_last_frame')
    expect(body({ prompt: 'p', image: png(1) }).duration).toBe(5)
    expect(body({ prompt: 'p', image: png(1), returnLastFrame: true }).return_last_frame).toBe(true)
  })

  it('never sends the 1.0-pro-only or unwanted fields', () => {
    const b = body({ ...base, image: png(1), withAudio: true, returnLastFrame: true })
    for (const k of [
      'seed',
      'camera_fixed',
      'frames',
      'service_tier',
      'callback_url',
      'priority',
      'tools',
      'draft',
      'output_format',
      'omni_reference_task_type',
    ])
      expect(b, k).not.toHaveProperty(k)
  })

  it.each([
    ['frame + references', { image: png(1), references: [ref(2)] }, 'FRAME_WITH_REFS_UNSUPPORTED'],
    [
      'last frame + references',
      { image: png(1), lastImage: png(2), references: [ref(3)] },
      'FRAME_WITH_REFS_UNSUPPORTED',
    ],
    ['last frame only', { lastImage: png(2) }, 'FIRST_FRAME_REQUIRED'],
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
  ])('refuses %s with %s', (_name, extra, code) => {
    try {
      arkVideo.buildGenerateRequest(auth(), { ...base, ...extra } as VideoGenInput)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError)
      expect((e as ProviderError).code).toBe(code)
    }
  })
})

describe('ark-video: responses', () => {
  it('submit', () => {
    expect(arkVideo.parseGenerateResponse(raw({ id: 'cgt-1' }))).toEqual({
      status: 'async',
      taskId: 'cgt-1',
    })
    expect(arkVideo.parseGenerateResponse(raw({})).status).toBe('failed')
    expect(arkVideo.parseGenerateResponse(raw({ error: { code: 'X', message: 'nope' } }))).toEqual({
      status: 'failed',
      message: 'nope',
    })
  })

  it('poll request', () => {
    const spec = arkVideo.buildPollRequest!(auth({ baseUrl: INTL }), 'cgt 1/2')
    expect(spec).toEqual({
      method: 'GET',
      url: `${INTL}/contents/generations/tasks/cgt%201%2F2`,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ark-key' },
    })
  })

  it.each([
    ['queued', { status: 'queued' }, { status: 'queued' }],
    ['running', { status: 'running' }, { status: 'processing' }],
    ['unknown word', { status: 'wat' }, { status: 'queued' }],
    [
      'succeeded',
      { status: 'succeeded', content: { video_url: 'https://v/a.mp4' }, duration: 5 },
      {
        status: 'completed',
        durationSec: 5,
        outputs: [{ kind: 'url', url: 'https://v/a.mp4', mime: 'video/mp4', role: 'video' }],
      },
    ],
    [
      'succeeded with last frame (the video stays first)',
      {
        status: 'succeeded',
        content: { video_url: 'https://v/a.mp4', last_frame_url: 'https://v/l.jpg' },
      },
      {
        status: 'completed',
        outputs: [
          { kind: 'url', url: 'https://v/a.mp4', mime: 'video/mp4', role: 'video' },
          { kind: 'url', url: 'https://v/l.jpg', mime: 'image/jpeg', role: 'last_frame' },
        ],
      },
    ],
    [
      'succeeded without url',
      { status: 'succeeded', content: {} },
      { status: 'failed', message: 'Ark: 任务成功但缺少 content.video_url' },
    ],
    [
      'failed with the real-person moderation code',
      {
        status: 'failed',
        error: {
          code: 'InputImageSensitiveContentDetected.PrivacyInformation',
          message: 'input image may contain real person',
        },
      },
      {
        status: 'failed',
        message: 'input image may contain real person',
        code: 'InputImageSensitiveContentDetected.PrivacyInformation',
      },
    ],
    [
      'failed without detail',
      { status: 'failed' },
      { status: 'failed', message: '任务失败（方舟未提供详细错误）' },
    ],
    [
      'expired',
      { status: 'expired' },
      {
        status: 'failed',
        message: '任务超时：48 小时内没有完成，已被方舟终止',
        code: 'TASK_EXPIRED',
      },
    ],
    [
      'cancelled',
      { status: 'cancelled' },
      { status: 'failed', message: '任务已取消', code: 'TASK_CANCELLED' },
    ],
  ])('poll: %s', (_n, json, expected) => {
    expect(arkVideo.parsePollResponse!(raw(json))).toEqual(expected)
  })

  it('a body with an error and no status fails at once; an empty body keeps waiting', () => {
    expect(
      arkVideo.parsePollResponse!(
        raw({ error: { code: 'AuthenticationError', message: 'bad key' } }),
      ),
    ).toEqual({
      status: 'failed',
      message: 'bad key',
    })
    expect(arkVideo.parsePollResponse!(raw({}))).toEqual({ status: 'queued' })
  })

  it.each([
    [
      400,
      { error: { code: 'InputImageSensitiveContentDetected.PrivacyInformation', message: 'm' } },
      'InputImageSensitiveContentDetected.PrivacyInformation',
      false,
    ],
    [401, { error: { code: 'AuthenticationError', message: 'bad' } }, 'AuthenticationError', false],
    [
      429,
      { error: { code: 'ModelAccountConcurrentRequestsLimitExceeded', message: 'busy' } },
      'ModelAccountConcurrentRequestsLimitExceeded',
      true,
    ],
    [503, { error: { type: 'ServiceUnavailable', message: 'x' } }, 'ServiceUnavailable', true],
    [500, 'not json', undefined, true],
  ])('http error %i', (status, json, code, recoverable) => {
    const r = arkVideo.parseHttpError!(raw(json, status))
    expect(r.code).toBe(code)
    expect(r.recoverable).toBe(recoverable)
  })
})

describe('ark-video: through the executor with a fake fetch', () => {
  it('submit → two polls → download of the video and the last frame; extra headers on submit and poll only', async () => {
    const calls: Array<{ method: string; url: string; headers: Record<string, string> }> = []
    let polls = 0
    const fetch = async (url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url,
        headers: { ...(init?.headers as Record<string, string>) },
      })
      if (url.endsWith('/contents/generations/tasks'))
        return new Response(JSON.stringify({ id: 'cgt-9' }))
      if (url.endsWith('/tasks/cgt-9')) {
        return new Response(
          JSON.stringify(
            ++polls < 2
              ? { status: 'running' }
              : {
                  status: 'succeeded',
                  content: { video_url: 'https://cdn/v.mp4', last_frame_url: 'https://cdn/l.jpg' },
                },
          ),
        )
      }
      return new Response(new Uint8Array([url.endsWith('.jpg') ? 2 : 1]), {
        headers: { 'content-type': url.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4' },
      })
    }
    const res = await runGeneration(
      getMediaProtocol('ark-video'),
      {
        ...auth({ baseUrl: INTL }),
        dialect: { extraHeaders: { 'X-Project': 'p1', Cookie: 'evil' } },
      },
      { ...base, image: png(1), returnLastFrame: true },
      { fetch, sleep: async () => {} },
    )
    expect(res.taskId).toBe('cgt-9')
    expect(res.outputs.map((o) => [o.mime, o.bytes[0]])).toEqual([
      ['video/mp4', 1],
      ['image/jpeg', 2],
    ])
    expect(calls.map((c) => c.url)).toEqual([
      `${INTL}/contents/generations/tasks`,
      `${INTL}/contents/generations/tasks/cgt-9`,
      `${INTL}/contents/generations/tasks/cgt-9`,
      'https://cdn/v.mp4',
      'https://cdn/l.jpg',
    ])
    expect(calls[0]!.headers['X-Project']).toBe('p1')
    expect(calls[1]!.headers['X-Project']).toBe('p1')
    expect(calls[0]!.headers).not.toHaveProperty('Cookie')
    expect(calls[3]!.headers).toEqual({}) // downloads never carry the user's headers
  })

  it('the real-person moderation block is a stable, non-retryable code', async () => {
    const fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 'InputImageSensitiveContentDetected.PrivacyInformation',
            message: 'may contain real person',
          },
        }),
        { status: 400 },
      )
    try {
      await runGeneration(arkVideo, auth(), { ...base, image: png(1) }, { fetch })
      throw new Error('should fail')
    } catch (e) {
      const err = e as ProviderError
      expect(err.code).toBe('InputImageSensitiveContentDetected.PrivacyInformation')
      expect(err.submission).toBe('rejected')
      expect(err.recoverable).toBe(false)
    }
  })

  it('a failed task carries the upstream code into the error', async () => {
    let n = 0
    const fetch = async () =>
      ++n === 1
        ? new Response(JSON.stringify({ id: 'T' }))
        : new Response(
            JSON.stringify({
              status: 'failed',
              error: {
                code: 'InvalidParameter.TaskTypeConstraint',
                message: 'ratio must be adaptive',
              },
            }),
          )
    try {
      await runGeneration(
        arkVideo,
        auth(),
        { ...base, image: png(1) },
        { fetch, sleep: async () => {} },
      )
      throw new Error('should fail')
    } catch (e) {
      expect((e as ProviderError).code).toBe('InvalidParameter.TaskTypeConstraint')
    }
  })
})
