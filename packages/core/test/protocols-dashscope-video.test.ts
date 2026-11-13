import { describe, expect, it } from 'vitest'
import { ProviderError } from '../src/providers/errors.ts'
import { runGeneration } from '../src/providers/executor.ts'
import { dashscopeVideo, getMediaProtocol } from '../src/providers/protocols/index.ts'
import type { AuthContext, RawResponse, VideoGenInput } from '../src/providers/types.ts'

const CN = 'https://ws1.cn-beijing.maas.aliyuncs.com'
const SG = 'https://ws1.ap-southeast-1.maas.aliyuncs.com'
const auth = (baseUrl = CN, model = 'wan3.0-video'): AuthContext => ({
  baseUrl,
  model,
  apiKey: 'sk-bailian',
  method: 'api_key',
})
const png = (n: number) => ({ bytes: new Uint8Array([n, n, n]), mime: 'image/png' })
const du = (n: number) => `data:image/png;base64,${Buffer.from([n, n, n]).toString('base64')}`
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
  const spec = dashscopeVideo.buildGenerateRequest(a, input)
  return { spec, body: (spec.body as { value: Record<string, unknown> }).value }
}
const base = { prompt: '开场', durationSec: 5, aspectRatio: '9:16' as const, resolution: '720P' }
const PARAMS = { duration: 5, audio: false, prompt_extend: true, watermark: false }

describe('dashscope-video: request', () => {
  it('url (native DashScope path, no /aliyun prefix) and headers', () => {
    for (const b of [CN, SG, `${CN}/`]) {
      const { spec } = build({ ...base, image: png(1) }, auth(b))
      expect(spec.url).toBe(
        `${b.replace(/\/$/, '')}/api/v1/services/aigc/video-generation/video-synthesis`,
      )
      expect(spec.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-bailian',
        'X-DashScope-Async': 'enable',
      })
    }
  })

  it('text to video: prompt only, no media key at all; the project ratio', () => {
    expect(build(base).body).toEqual({
      model: 'wan3.0-video',
      input: { prompt: '开场' },
      parameters: { resolution: '720P', ratio: '9:16', ...PARAMS },
    })
  })

  it('first frame: media first_frame, ratio adaptive, explicit audio flag', () => {
    expect(build({ ...base, image: png(1), withAudio: true }).body).toEqual({
      model: 'wan3.0-video',
      input: { prompt: '开场', media: [{ type: 'first_frame', url: du(1) }] },
      parameters: { resolution: '720P', ratio: 'adaptive', ...PARAMS, audio: true },
    })
  })

  it('first + last frame', () => {
    const { body } = build({ ...base, cameraInstruction: '推近', image: png(1), lastImage: png(2) })
    expect(body.input).toEqual({
      prompt: '开场. 推近',
      media: [
        { type: 'first_frame', url: du(1) },
        { type: 'last_frame', url: du(2) },
      ],
    })
  })

  it('reference images: reference_image in order; public url and oss:// ids pass through; project ratio', () => {
    const { body } = build({
      ...base,
      references: [
        ref(1),
        { kind: 'image', media: { kind: 'asset', id: 'oss://dashscope-instant/x/a.png' } },
        { kind: 'video', media: { kind: 'url', url: 'https://x/v.mp4' } },
        { kind: 'audio', media: { kind: 'asset', id: 'oss://dashscope-instant/x/a.mp3' } },
      ],
    })
    expect(body.input).toEqual({
      prompt: '开场',
      media: [
        { type: 'reference_image', url: du(1) },
        { type: 'reference_image', url: 'oss://dashscope-instant/x/a.png' },
        { type: 'reference_video', url: 'https://x/v.mp4' },
        { type: 'reference_audio', url: 'oss://dashscope-instant/x/a.mp3' },
      ],
    })
    expect((body.parameters as { ratio: string }).ratio).toBe('9:16')
  })

  it('no negative_prompt, seed or other unwanted fields; resolution/audio/duration have defaults', () => {
    const { body } = build({ prompt: 'p', image: png(1) })
    expect(body.parameters).toEqual({
      resolution: '720P',
      ratio: 'adaptive',
      duration: 5,
      audio: false,
      prompt_extend: true,
      watermark: false,
    })
    expect(JSON.stringify(body)).not.toMatch(/negative_prompt|seed/)
  })

  it.each([
    [
      'frame + references (the white-list forbids it)',
      { image: png(1), references: [ref(2)] },
      'FRAME_WITH_REFS_UNSUPPORTED',
    ],
    ['last frame only', { lastImage: png(2) }, 'FIRST_FRAME_REQUIRED'],
    [
      'local video bytes (only images may be base64)',
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
      'local audio bytes',
      {
        references: [
          {
            kind: 'audio' as const,
            media: { kind: 'bytes' as const, bytes: new Uint8Array([1]), mime: 'audio/mpeg' },
          },
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

describe('dashscope-video: responses', () => {
  it('submit', () => {
    expect(
      dashscopeVideo.parseGenerateResponse(
        raw({ output: { task_id: 't1', task_status: 'PENDING' } }),
      ),
    ).toEqual({ status: 'async', taskId: 't1' })
    expect(
      dashscopeVideo.parseGenerateResponse(
        raw({ code: 'InvalidApiKey', message: 'Invalid API-key provided.' }),
      ),
    ).toEqual({
      status: 'failed',
      message: 'Invalid API-key provided.',
    })
    expect(dashscopeVideo.parseGenerateResponse(raw({ output: {} })).status).toBe('failed')
  })

  it('poll request: native tasks path, only the auth header', () => {
    expect(dashscopeVideo.buildPollRequest!(auth(SG), 'a/b')).toEqual({
      method: 'GET',
      url: `${SG}/api/v1/tasks/a%2Fb`,
      headers: { Authorization: 'Bearer sk-bailian' },
    })
  })

  it.each([
    ['PENDING', { output: { task_status: 'PENDING' } }, { status: 'queued' }],
    ['RUNNING', { output: { task_status: 'RUNNING' } }, { status: 'processing' }],
    [
      'SUCCEEDED',
      {
        output: { task_status: 'SUCCEEDED', video_url: 'https://v/1.mp4' },
        usage: { output_video_duration: 5, duration: 5 },
      },
      {
        status: 'completed',
        durationSec: 5,
        outputs: [{ kind: 'url', url: 'https://v/1.mp4', mime: 'video/mp4', role: 'video' }],
      },
    ],
    [
      'SUCCEEDED without url',
      { output: { task_status: 'SUCCEEDED' } },
      { status: 'failed', message: 'DashScope: 任务成功但缺少 output.video_url' },
    ],
    [
      'FAILED with code and message',
      {
        output: {
          task_status: 'FAILED',
          code: 'DataInspectionFailed',
          message: 'Input data may contain inappropriate content.',
        },
      },
      {
        status: 'failed',
        message: 'Input data may contain inappropriate content.',
        code: 'DataInspectionFailed',
      },
    ],
    [
      'FAILED bare',
      { output: { task_status: 'FAILED' } },
      { status: 'failed', message: '任务失败（百炼未提供详细错误）' },
    ],
    [
      'CANCELED',
      { output: { task_status: 'CANCELED' } },
      { status: 'failed', message: '任务已取消', code: 'TASK_CANCELLED' },
    ],
    [
      'UNKNOWN is a failure here (the legacy protocol waits forever on it)',
      { output: { task_status: 'UNKNOWN' } },
      {
        status: 'failed',
        message: '任务不存在或已过期（任务号只保留 24 小时）',
        code: 'TASK_UNKNOWN',
      },
    ],
    [
      'business error without a state',
      { code: 'InvalidApiKey', message: 'bad key' },
      { status: 'failed', message: 'bad key' },
    ],
    ['empty body keeps waiting', {}, { status: 'queued' }],
  ])('poll: %s', (_n, json, expected) => {
    expect(dashscopeVideo.parsePollResponse!(raw(json))).toEqual(expected)
  })

  it.each([
    [401, { code: 'InvalidApiKey', message: 'Invalid API-key provided.' }, 'InvalidApiKey', false],
    [400, { code: 'DataInspectionFailed', message: 'x' }, 'DataInspectionFailed', false],
    [403, { code: 'Arrearage', message: 'overdue' }, 'Arrearage', false],
    [429, { code: 'Throttling.RateQuota', message: 'slow' }, 'Throttling.RateQuota', true],
    [500, { code: 'InternalError', message: 'oops' }, 'InternalError', true],
    [400, { code: 100004, message: 'missing' }, '100004', false],
    [502, 'html', undefined, true],
  ])('http error %i', (status, json, code, recoverable) => {
    const r = dashscopeVideo.parseHttpError!(raw(json, status))
    expect(r.code).toBe(code)
    expect(r.recoverable).toBe(recoverable)
  })
})

describe('dashscope-video: through the executor with a fake fetch', () => {
  it('submit → poll → download; extra headers on submit and poll only', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    const fetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } })
      if (url.endsWith('/video-synthesis'))
        return new Response(JSON.stringify({ output: { task_id: 'W1', task_status: 'PENDING' } }))
      if (url.includes('/tasks/'))
        return new Response(
          JSON.stringify({
            output: { task_status: 'SUCCEEDED', video_url: 'https://oss/w.mp4' },
            usage: { output_video_duration: 5 },
          }),
        )
      return new Response(new Uint8Array([3]), { headers: { 'content-type': 'video/mp4' } })
    }
    const res = await runGeneration(
      getMediaProtocol('dashscope-video'),
      { ...auth(), dialect: { extraHeaders: { 'X-Project': 'p' } } },
      { ...base, image: png(1) },
      { fetch, sleep: async () => {} },
    )
    expect(res.taskId).toBe('W1')
    expect(calls.map((c) => c.url)).toEqual([
      `${CN}/api/v1/services/aigc/video-generation/video-synthesis`,
      `${CN}/api/v1/tasks/W1`,
      'https://oss/w.mp4',
    ])
    expect(calls[0]!.headers['X-Project']).toBe('p')
    expect(calls[1]!.headers['X-Project']).toBe('p')
    expect(calls[2]!.headers).toEqual({})
  })

  it('an expired task fails with a stable code instead of waiting', async () => {
    let n = 0
    const fetch = async () =>
      ++n === 1
        ? new Response(JSON.stringify({ output: { task_id: 'W2' } }))
        : new Response(JSON.stringify({ output: { task_status: 'UNKNOWN' } }))
    try {
      await runGeneration(
        dashscopeVideo,
        auth(),
        { ...base, image: png(1) },
        { fetch, sleep: async () => {} },
      )
      throw new Error('should fail')
    } catch (e) {
      expect((e as ProviderError).code).toBe('TASK_UNKNOWN')
    }
    expect(n).toBe(2)
  })
})
