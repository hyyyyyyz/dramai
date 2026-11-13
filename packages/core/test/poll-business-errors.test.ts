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
