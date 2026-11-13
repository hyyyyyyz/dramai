import { describe, expect, it } from 'vitest'
import { arkVideo, dashscopeVideo, klingContents } from '../src/providers/protocols/index.ts'
import type { RawResponse } from '../src/providers/types.ts'

const raw = (json: unknown): RawResponse => ({
  status: 200,
  headers: {},
  text: JSON.stringify(json),
  json,
})

/** The new protocols use the same (fixed) body-error rule as the legacy ones: success codes and empty errors keep waiting. */
describe('new video protocols: a success code or an empty error object is not a failure', () => {
  const calm = [
    { code: 200, message: 'ok' },
    { code: '200', message: 'OK' },
    { code: 0 },
    { code: 'success' },
    { error: {} },
    { error: '' },
    {},
  ]
  it.each([
    ['ark-video', arkVideo],
    ['kling-contents', klingContents],
    ['dashscope-video', dashscopeVideo],
  ] as const)('%s keeps waiting', (_id, protocol) => {
    for (const body of calm)
      expect(protocol.parsePollResponse!(raw(body)), JSON.stringify(body)).toEqual({
        status: 'queued',
      })
  })

  it.each([
    [
      'ark-video',
      arkVideo,
      { error: { code: 'AuthenticationError', message: 'bad key' } },
      'bad key',
    ],
    [
      'kling-contents',
      klingContents,
      { code: 1002, message: 'Authorization is invalid' },
      'Authorization is invalid',
    ],
    ['dashscope-video', dashscopeVideo, { code: 'InvalidApiKey', message: 'bad key' }, 'bad key'],
  ] as const)('%s still fails fast on a real error', (_id, protocol, body, message) => {
    expect(protocol.parsePollResponse!(raw(body))).toEqual({ status: 'failed', message })
  })
})
