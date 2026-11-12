import { describe, expect, it } from 'vitest'
import {
  aliyunVideo,
  buildChatRequest,
  extractContentDelta,
  geminiImage,
  genericVideo,
  getMediaProtocol,
  klingVideo,
  openaiImages,
  openaiTts,
  volcengineVideo,
} from '../src/providers/protocols/index.ts'
import type { AuthContext, PollParse, RawResponse } from '../src/providers/types.ts'

const auth = (extra: Partial<AuthContext> = {}): AuthContext => ({
  baseUrl: 'https://api.example.com/',
  model: 'm-1',
  apiKey: 'sk-test',
  ...extra,
})
const png = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }
const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64')
const raw = (json: unknown, status = 200, headers: Record<string, string> = {}): RawResponse => ({
  status,
  headers,
  text: JSON.stringify(json),
  json,
})
const jsonBody = (spec: { body?: { type: string; value?: unknown } }) =>
  (spec.body as { type: 'json'; value: Record<string, unknown> }).value

describe('openai-chat', () => {
  it('builds a streaming request with optional params', () => {
    const spec = buildChatRequest(auth(), {
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 100,
      jsonMode: true,
    })
    expect(spec.url).toBe('https://api.example.com/chat/completions')
    expect(spec.headers.Authorization).toBe('Bearer sk-test')
    expect(jsonBody(spec)).toEqual({
      model: 'm-1',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 100,
      response_format: { type: 'json_object' },
    })
  })

  it('omits Authorization without a key', () => {
    const spec = buildChatRequest(auth({ apiKey: undefined }), { messages: [] })
    expect(spec.headers.Authorization).toBeUndefined()
  })

  it.each([
    [{ choices: [{ delta: { content: 'abc' } }] }, 'abc', undefined],
    [{ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] }, 'x', 'stop'],
    [{ choices: [{ message: { content: 'full' }, finish_reason: null }] }, 'full', null],
    [
      {
        choices: [
          {
            delta: {
              content: [
                { type: 'text', text: 'a' },
                { type: 'text', text: 'b' },
              ],
            },
          },
        ],
      },
      'ab',
      undefined,
    ],
    [{ choices: [] }, '', undefined],
    [{}, '', undefined],
    [null, '', undefined],
  ])('extracts delta from %j', (chunk, delta, finishReason) => {
    expect(extractContentDelta(chunk)).toEqual({ delta, finishReason })
  })
})

describe('openai-images', () => {
  it('builds a request with size, quality, negative prompt and reference images', () => {
    const spec = openaiImages.buildGenerateRequest(auth(), {
      prompt: 'a cat',
      negativePrompt: 'blurry',
      size: { width: 720, height: 1280 },
      quality: 'hd',
      n: 2,
      references: [png, png],
    })
    expect(spec.url).toBe('https://api.example.com/images/generations')
    const body = jsonBody(spec)
    expect(body).toMatchObject({
      model: 'm-1',
      prompt: 'a cat',
      n: 2,
      size: '720x1280',
      quality: 'hd',
      negative_prompt: 'blurry',
      response_format: 'b64_json',
    })
    expect(body.image).toBe(`data:image/png;base64,${b64([1, 2, 3])}`)
    expect(body.reference_images).toHaveLength(2)
  })

  it('omits reference fields when there are no references', () => {
    const body = jsonBody(openaiImages.buildGenerateRequest(auth(), { prompt: 'x' }))
    expect(body).not.toHaveProperty('image')
    expect(body).not.toHaveProperty('reference_images')
  })

  it.each([
    ['b64_json', { data: [{ b64_json: b64([9, 8]) }] }, { kind: 'bytes', mime: 'image/png' }],
    [
      'data URL b64',
      { data: [{ b64_json: `data:image/jpeg;base64,${b64([9])}` }] },
      { kind: 'bytes', mime: 'image/jpeg' },
    ],
    ['url', { data: [{ url: 'https://x/y.png' }] }, { kind: 'url', url: 'https://x/y.png' }],
  ])('parses %s output', (_name, json, expected) => {
    const parsed = openaiImages.parseGenerateResponse(raw(json))
    expect(parsed.status).toBe('sync')
    if (parsed.status === 'sync') expect(parsed.outputs[0]).toMatchObject(expected)
  })

  it.each([
    ['empty data', { data: [] }],
    ['error object', { error: { message: 'quota exceeded' } }],
    ['unrecognised entries', { data: [{ foo: 1 }] }],
    ['not an object', 'oops'],
  ])('fails on %s', (_name, json) => {
    expect(openaiImages.parseGenerateResponse(raw(json)).status).toBe('failed')
  })

  it('surfaces the provider error message', () => {
    const parsed = openaiImages.parseGenerateResponse(raw({ error: { message: 'quota exceeded' } }))
    expect(parsed).toEqual({ status: 'failed', message: 'quota exceeded' })
  })
})

describe('gemini-image', () => {
  it('builds generateContent with refs, aspect ratio and both auth headers', () => {
    const spec = geminiImage.buildGenerateRequest(auth({ model: 'gemini-2.5-flash-image' }), {
      prompt: 'scene',
      aspectRatio: '9:16',
      references: [png],
    })
    expect(spec.url).toBe(
      'https://api.example.com/v1beta/models/gemini-2.5-flash-image:generateContent',
    )
    expect(spec.headers.Authorization).toBe('Bearer sk-test')
    expect(spec.headers['x-goog-api-key']).toBe('sk-test')
    expect(jsonBody(spec)).toEqual({
      contents: [
        {
          parts: [
            { text: 'scene' },
            { inline_data: { mime_type: 'image/png', data: b64([1, 2, 3]) } },
          ],
        },
      ],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '9:16' } },
    })
  })

  it('does not send imageConfig without an aspect ratio', () => {
    const body = jsonBody(geminiImage.buildGenerateRequest(auth(), { prompt: 'x' }))
    expect(body.generationConfig).toEqual({ responseModalities: ['IMAGE'] })
  })

  it('parses snake_case and camelCase inline data', () => {
    const snake = geminiImage.parseGenerateResponse(
      raw({
        candidates: [
          {
            content: {
              parts: [{ text: 'cap' }, { inline_data: { mime_type: 'image/png', data: b64([1]) } }],
            },
          },
        ],
      }),
    )
    const camel = geminiImage.parseGenerateResponse(
      raw({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: 'image/webp', data: b64([2]) } }] } },
        ],
      }),
    )
    expect(snake).toMatchObject({ status: 'sync', outputs: [{ kind: 'bytes', mime: 'image/png' }] })
    expect(camel).toMatchObject({
      status: 'sync',
      outputs: [{ kind: 'bytes', mime: 'image/webp' }],
    })
  })

  it('reports a blocked prompt', () => {
    const parsed = geminiImage.parseGenerateResponse(
      raw({ promptFeedback: { blockReason: 'SAFETY' } }),
    )
    expect(parsed).toMatchObject({ status: 'failed' })
    expect((parsed as { message: string }).message).toContain('SAFETY')
  })

  it('fails when there is no image', () => {
    expect(
      geminiImage.parseGenerateResponse(
        raw({ candidates: [{ content: { parts: [{ text: 'sorry' }] } }] }),
      ).status,
    ).toBe('failed')
  })
})

describe('aliyun-video', () => {
  it('builds the async DashScope request and snaps the duration', () => {
    const spec = aliyunVideo.buildGenerateRequest(auth({ model: 'wan2.2-i2v-flash' }), {
      prompt: 'p',
      cameraInstruction: 'dolly in',
      image: png,
      durationSec: 6,
      resolution: '480P',
    })
    expect(spec.url).toBe(
      'https://api.example.com/aliyun/api/v1/services/aigc/video-generation/video-synthesis',
    )
    expect(spec.headers['X-DashScope-Async']).toBe('enable')
    expect(jsonBody(spec)).toEqual({
      model: 'wan2.2-i2v-flash',
      input: { prompt: 'p. dolly in', img_url: `data:image/png;base64,${b64([1, 2, 3])}` },
      parameters: { resolution: '480P', duration: 5, prompt_extend: true, watermark: false },
    })
  })

  it('uses the model duration steps when given', () => {
    const body = jsonBody(
      aliyunVideo.buildGenerateRequest(auth(), {
        prompt: 'p',
        image: png,
        durationSec: 9,
        allowedDurations: [5],
      }),
    )
    expect((body.parameters as { duration: number }).duration).toBe(5)
  })

  it('parses the submit response', () => {
    expect(
      aliyunVideo.parseGenerateResponse(raw({ output: { task_id: 't1', task_status: 'PENDING' } })),
    ).toEqual({ status: 'async', taskId: 't1' })
    expect(aliyunVideo.parseGenerateResponse(raw({ output: {} })).status).toBe('failed')
  })

  it('builds the poll request', () => {
    const spec = aliyunVideo.buildPollRequest!(auth(), 'a/b')
    expect(spec).toMatchObject({
      method: 'GET',
      url: 'https://api.example.com/aliyun/api/v1/tasks/a%2Fb',
    })
  })

  it.each<[string, unknown, PollParse]>([
    ['pending', { output: { task_status: 'PENDING' } }, { status: 'queued' }],
    ['unknown', { output: { task_status: 'UNKNOWN' } }, { status: 'queued' }],
    ['empty', {}, { status: 'queued' }],
    ['running', { output: { task_status: 'RUNNING' } }, { status: 'processing' }],
    [
      'succeeded',
      { output: { task_status: 'SUCCEEDED', video_url: 'https://v/1.mp4' } },
      {
        status: 'completed',
        outputs: [{ kind: 'url', url: 'https://v/1.mp4', mime: 'video/mp4' }],
      },
    ],
    [
      'succeeded via results',
      { output: { task_status: 'SUCCEEDED', results: [{ url: 'https://v/2.mp4' }] } },
      {
        status: 'completed',
        outputs: [{ kind: 'url', url: 'https://v/2.mp4', mime: 'video/mp4' }],
      },
    ],
    [
      'succeeded no url',
      { output: { task_status: 'SUCCEEDED' } },
      { status: 'failed', message: expect.stringContaining('video_url') as unknown as string },
    ],
    [
      'failed',
      { output: { task_status: 'FAILED', message: 'bad image' } },
      { status: 'failed', message: 'bad image' },
    ],
    [
      'canceled',
      { output: { task_status: 'CANCELED' } },
      { status: 'failed', message: '任务canceled' },
    ],
  ])('poll: %s', (_n, json, expected) => {
    expect(aliyunVideo.parsePollResponse!(raw(json))).toEqual(expected)
  })
})

describe('volcengine-video', () => {
  it('builds the request from the project aspect ratio, resolution and audio flag', () => {
    const spec = volcengineVideo.buildGenerateRequest(auth(), {
      prompt: 'p',
      image: png,
      aspectRatio: '9:16',
      durationSec: 8,
      resolution: '1080p',
      withAudio: true,
    })
    expect(spec.url).toBe('https://api.example.com/volcengine/api/v3/contents/generations/tasks')
    expect(jsonBody(spec)).toEqual({
      model: 'm-1',
      content: [
        { type: 'text', text: 'p' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64([1, 2, 3])}` } },
      ],
      ratio: '9:16',
      duration: 8,
      resolution: '1080p',
      generate_audio: true,
      watermark: false,
    })
  })

  it('defaults: adaptive ratio, 5 s, 720p, no audio; last frame gets roles', () => {
    const body = jsonBody(
      volcengineVideo.buildGenerateRequest(auth(), { prompt: '', image: png, lastImage: png }),
    )
    expect(body).toMatchObject({
      ratio: 'adaptive',
      duration: 5,
      resolution: '720p',
      generate_audio: false,
    })
    const content = body.content as Array<Record<string, unknown>>
    expect(content.map((c) => c.role)).toEqual(['first_frame', 'last_frame'])
    expect(content.some((c) => c.type === 'text')).toBe(false)
  })

  it('parses submit and poll responses', () => {
    expect(volcengineVideo.parseGenerateResponse(raw({ id: 'cgt-1' }))).toEqual({
      status: 'async',
      taskId: 'cgt-1',
    })
    expect(volcengineVideo.parseGenerateResponse(raw({})).status).toBe('failed')
    const p = (json: unknown) => volcengineVideo.parsePollResponse!(raw(json))
    expect(p({ status: 'queued' })).toEqual({ status: 'queued' })
    expect(p({ status: 'running' })).toEqual({ status: 'processing' })
    expect(p({ status: 'succeeded', content: { video_url: 'https://v/a.mp4' } })).toMatchObject({
      status: 'completed',
    })
    expect(p({ status: 'succeeded', content: {} }).status).toBe('failed')
    expect(p({ status: 'failed', error: { message: 'nsfw' } })).toEqual({
      status: 'failed',
      message: 'nsfw',
    })
    expect(p({ status: 'expired' }).status).toBe('failed')
    expect(p({ status: 'cancelled' }).status).toBe('failed')
  })
})

describe('kling-video', () => {
  it('builds the request with plain base64 and string duration', () => {
    const spec = klingVideo.buildGenerateRequest(auth({ model: 'kling-v1' }), {
      prompt: 'p',
      image: png,
      durationSec: 10,
      aspectRatio: '16:9',
    })
    expect(spec.url).toBe('https://api.example.com/v1/videos/image2video')
    expect(jsonBody(spec)).toEqual({
      model_name: 'kling-v1',
      image: b64([1, 2, 3]),
      prompt: 'p',
      duration: '10',
      aspect_ratio: '16:9',
    })
  })

  it('parses submit (nested or flat task id) and poll statuses', () => {
    expect(klingVideo.parseGenerateResponse(raw({ data: { task_id: 'k1' } }))).toEqual({
      status: 'async',
      taskId: 'k1',
    })
    expect(klingVideo.parseGenerateResponse(raw({ task_id: 'k2' }))).toEqual({
      status: 'async',
      taskId: 'k2',
    })
    expect(klingVideo.parseGenerateResponse(raw({ data: {} })).status).toBe('failed')
    const p = (status: string, extra: Record<string, unknown> = {}) =>
      klingVideo.parsePollResponse!(raw({ data: { task_status: status, ...extra } }))
    expect(p('submitted')).toEqual({ status: 'queued' })
    expect(p('processing', { task_status_msg: 'm' })).toEqual({
      status: 'processing',
      message: 'm',
    })
    expect(
      p('succeed', { task_result: { videos: [{ url: 'https://k/1.mp4', duration: '5.1' }] } }),
    ).toEqual({
      status: 'completed',
      outputs: [{ kind: 'url', url: 'https://k/1.mp4', mime: 'video/mp4' }],
      durationSec: 5.1,
    })
    expect(p('succeed', { task_result: { videos: [] } }).status).toBe('failed')
    expect(p('failed', { task_status_msg: 'moderation' })).toEqual({
      status: 'failed',
      message: 'moderation',
    })
  })

  it('sends image_tail only when a last frame is given', () => {
    const without = jsonBody(klingVideo.buildGenerateRequest(auth(), { prompt: '', image: png }))
    const withTail = jsonBody(
      klingVideo.buildGenerateRequest(auth(), { prompt: '', image: png, lastImage: png }),
    )
    expect(without).not.toHaveProperty('image_tail')
    expect(withTail).toHaveProperty('image_tail')
  })
})

describe('generic-video', () => {
  it('builds the request', () => {
    const spec = genericVideo.buildGenerateRequest(auth(), {
      prompt: 'p',
      image: png,
      durationSec: 4,
      aspectRatio: '1:1',
    })
    expect(spec.url).toBe('https://api.example.com/videos/generations')
    expect(jsonBody(spec)).toMatchObject({
      model: 'm-1',
      prompt: 'p',
      duration: 4,
      aspect_ratio: '1:1',
    })
  })

  it.each([
    [{ id: 'g1' }, 'g1'],
    [{ task_id: 'g2' }, 'g2'],
    [{ request_id: 'g3' }, 'g3'],
    [{ data: { id: 'g4' } }, 'g4'],
  ])('finds the task id in %j', (json, id) => {
    expect(genericVideo.parseGenerateResponse(raw(json))).toEqual({ status: 'async', taskId: id })
  })

  it('fails without a task id', () => {
    expect(genericVideo.parseGenerateResponse(raw({ ok: true })).status).toBe('failed')
  })

  it.each([
    [{ status: 'completed', url: 'https://g/1.mp4' }, 'completed'],
    [{ status: 'SUCCEEDED', output: { url: 'https://g/2.mp4' } }, 'completed'],
    [{ status: 'done', output: [{ url: 'https://g/3.mp4' }] }, 'completed'],
    [{ status: 'success', video: { url: 'https://g/4.mp4' } }, 'completed'],
    [{ status: 'success', data: [{ url: 'https://g/5.mp4' }] }, 'completed'],
    [{ status: 'success', data: { url: 'https://g/6.mp4' } }, 'completed'],
    [{ status: 'completed' }, 'failed'],
    [{ status: 'error', error: { message: 'x' } }, 'failed'],
    [{ status: 'in_progress' }, 'processing'],
    [{ status: 'queued' }, 'queued'],
    [{}, 'queued'],
  ])('poll %j → %s', (json, status) => {
    expect(genericVideo.parsePollResponse!(raw(json)).status).toBe(status)
  })
})

describe('openai-tts', () => {
  it('builds the speech request', () => {
    const spec = openaiTts.buildGenerateRequest(auth(), {
      text: '你好',
      voice: 'nova',
      format: 'wav',
      speed: 1.1,
    })
    expect(spec.url).toBe('https://api.example.com/audio/speech')
    expect(jsonBody(spec)).toEqual({
      model: 'm-1',
      input: '你好',
      voice: 'nova',
      response_format: 'wav',
      speed: 1.1,
    })
    expect(jsonBody(openaiTts.buildGenerateRequest(auth(), { text: 'x' }))).toMatchObject({
      voice: 'alloy',
      response_format: 'mp3',
    })
  })

  it('reads bytes and mime from the response', () => {
    const ok = openaiTts.parseGenerateResponse({
      status: 200,
      headers: { 'content-type': 'audio/wav; charset=x' },
      text: '',
      bytes: new Uint8Array([1, 2]),
    })
    expect(ok).toMatchObject({ status: 'sync', outputs: [{ kind: 'bytes', mime: 'audio/wav' }] })
    const fallback = openaiTts.parseGenerateResponse({
      status: 200,
      headers: {},
      text: '',
      bytes: new Uint8Array([1]),
    })
    expect(fallback).toMatchObject({ outputs: [{ mime: 'audio/mpeg' }] })
    expect(
      openaiTts.parseGenerateResponse({
        status: 200,
        headers: {},
        text: '',
        bytes: new Uint8Array(),
      }).status,
    ).toBe('failed')
  })
})

describe('registry', () => {
  it('resolves every media protocol and rejects chat', () => {
    for (const id of [
      'openai-images',
      'gemini-image',
      'aliyun-video',
      'volcengine-video',
      'kling-video',
      'generic-video',
      'openai-tts',
    ] as const) {
      expect(getMediaProtocol(id).id).toBe(id)
    }
    expect(() => getMediaProtocol('openai-chat')).toThrow()
  })
})
