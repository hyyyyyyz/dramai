import { describe, expect, it } from 'vitest'
import {
  aliyunVideo,
  genericVideo,
  klingImage,
  klingVideo,
  volcengineVideo,
} from '../src/providers/protocols/index.ts'
import { bodyError } from '../src/providers/http.ts'
import type { MediaProtocol, RawResponse } from '../src/providers/types.ts'

const raw = (json: unknown): RawResponse => ({
  status: 200,
  headers: {},
  text: JSON.stringify(json),
  json,
})

// 业务错误的响应（HTTP 200，但没有任务状态）：必须立刻失败并带上 message，不能当"排队中"等 10 分钟。
const ERROR_BODIES: Array<[string, MediaProtocol<never>, unknown, string]> = [
  [
    'kling-image: code≠0',
    klingImage,
    { code: 1001, message: 'Authorization is empty' },
    'Authorization is empty',
  ],
  [
    'kling-image: code≠0 + data without status',
    klingImage,
    { code: 1203, message: 'task not found', data: {} },
    'task not found',
  ],
  [
    'kling-video: code≠0',
    klingVideo,
    { code: 1002, message: 'Authorization is invalid' },
    'Authorization is invalid',
  ],
  [
    'aliyun-video: top-level code',
    aliyunVideo,
    { code: 'InvalidApiKey', message: 'Invalid API-key provided.' },
    'Invalid API-key provided.',
  ],
  [
    'aliyun-video: output.code',
    aliyunVideo,
    { output: { code: 'InvalidParameter', message: 'bad input' } },
    'bad input',
  ],
  [
    'volcengine-video: error object',
    volcengineVideo,
    { error: { code: 'AuthenticationError', message: 'key invalid' } },
    'key invalid',
  ],
  ['generic-video: error string', genericVideo, { error: 'quota exceeded' }, 'quota exceeded'],
  [
    'generic-video: code + message',
    genericVideo,
    { code: 401, message: 'unauthorized' },
    'unauthorized',
  ],
]

describe('polling: a business error is a failure, not "still queued"', () => {
  it.each(ERROR_BODIES)('%s', (_name, protocol, body, message) => {
    expect(protocol.parsePollResponse!(raw(body))).toEqual({ status: 'failed', message })
  })

  it('without an error, an unknown or missing state is still waiting (unchanged)', () => {
    for (const protocol of [klingImage, klingVideo, aliyunVideo, volcengineVideo, genericVideo]) {
      expect(protocol.parsePollResponse!(raw({})), protocol.id).toEqual({ status: 'queued' })
    }
    // code 0 is "ok", not an error
    expect(klingImage.parsePollResponse!(raw({ code: 0, message: 'ok', data: {} }))).toEqual({
      status: 'queued',
    })
    expect(
      klingVideo.parsePollResponse!(raw({ code: 0, data: { task_status: 'submitted' } })),
    ).toEqual({ status: 'queued' })
  })

  it('a real task state wins over the code field', () => {
    expect(
      klingImage.parsePollResponse!(
        raw({ code: 0, data: { task_status: 'failed', task_status_msg: 'content blocked' } }),
      ),
    ).toEqual({ status: 'failed', message: 'content blocked' })
    expect(aliyunVideo.parsePollResponse!(raw({ output: { task_status: 'RUNNING' } }))).toEqual({
      status: 'processing',
    })
  })

  // 每个用到 bodyError 的协议：成功码 + 无状态 = 排队；非成功码 + 错误信息 = 失败并带信息。
  const PROTOCOLS: Array<[string, MediaProtocol<never>, unknown, unknown, string]> = [
    [
      'kling-image',
      klingImage,
      { code: 0, message: 'ok' },
      { code: 1203, message: 'gone' },
      'gone',
    ],
    [
      'kling-video',
      klingVideo,
      { code: 0, message: 'ok' },
      { code: 1203, message: 'gone' },
      'gone',
    ],
    [
      'aliyun-video',
      aliyunVideo,
      { code: 'success', message: 'ok' },
      { code: 'InvalidApiKey', message: 'bad key' },
      'bad key',
    ],
    [
      'volcengine-video',
      volcengineVideo,
      { error: {} },
      { error: { code: 'AuthenticationError', message: 'bad key' } },
      'bad key',
    ],
    ['generic-video', genericVideo, { code: 0 }, { code: 500, message: 'boom' }, 'boom'],
  ]
  it.each(PROTOCOLS)(
    '%s: success code without state waits, other code fails',
    (_n, p, ok, bad, msg) => {
      expect(p.parsePollResponse!(raw(ok))).toEqual({ status: 'queued' })
      expect(p.parsePollResponse!(raw(bad))).toEqual({ status: 'failed', message: msg })
    },
  )

  // 审查发现的回归：这些响应在 b06d198 是排队，不能变成失败。
  it('code 200 success envelopes and empty error objects stay queued', () => {
    // generic-video 只读顶层状态：状态在嵌套的 data 里时不新增解析，结果与 b06d198 一致（排队）
    expect(
      genericVideo.parsePollResponse!(raw({ code: 200, data: { status: 'running' } })),
    ).toEqual({ status: 'queued' })
    expect(klingVideo.parsePollResponse!(raw({ code: 200, data: {} }))).toEqual({
      status: 'queued',
    })
    expect(aliyunVideo.parsePollResponse!(raw({ code: 200, message: 'ok' }))).toEqual({
      status: 'queued',
    })
    expect(volcengineVideo.parsePollResponse!(raw({ error: {} }))).toEqual({ status: 'queued' })
  })

  it('bodyError: success codes are never errors', () => {
    for (const code of [
      0,
      200,
      201,
      204,
      299,
      '0',
      '200',
      '204',
      'success',
      'SUCCESS',
      'Ok',
      'ok',
      ' ok ',
      '',
    ]) {
      expect(bodyError({ code, message: 'm' }), String(code)).toBeUndefined()
      expect(
        bodyError({ output: { code, message: 'm' } }),
        `output ${String(code)}`,
      ).toBeUndefined()
    }
    // 3xx / 4xx / 5xx and named codes are errors
    for (const code of [1, 199, 300, 401, 500, '401', '1001', 'InvalidApiKey', 'fail']) {
      expect(bodyError({ code, message: 'm' }), String(code)).toBe('m')
    }
    expect(bodyError({ code: 401, msg: 'unauthorized' })).toBe('unauthorized')
  })

  it('bodyError: an empty error is not an error', () => {
    expect(bodyError({ error: {} })).toBeUndefined()
    expect(bodyError({ error: '' })).toBeUndefined()
    expect(bodyError({ error: '  ' })).toBeUndefined()
    expect(bodyError({ error: null })).toBeUndefined()
    expect(bodyError({ error: { message: '' } })).toBeUndefined()
    expect(bodyError({ error: { code: 0 } })).toBeUndefined()
    expect(bodyError({ error: { code: 200 } })).toBeUndefined()
    // with content it still fails
    expect(bodyError({ error: 'quota exceeded' })).toBe('quota exceeded')
    expect(bodyError({ error: { message: 'm' } })).toBe('m')
    expect(bodyError({ error: { msg: 'm2' } })).toBe('m2')
    expect(bodyError({ error: { code: 'Throttled' } })).toBe('上游返回错误')
  })

  it('bodyError reads only explicit errors', () => {
    expect(bodyError(undefined)).toBeUndefined()
    expect(bodyError({ code: 0 })).toBeUndefined()
    expect(bodyError({ code: '0' })).toBeUndefined()
    expect(bodyError({ code: 'success' })).toBeUndefined()
    expect(bodyError({ code: 5, message: 'm' })).toBe('m')
    expect(bodyError({ code: 5 })).toContain('5')
    expect(bodyError({ error: { code: 'x' } })).toBe('上游返回错误')
  })
})
