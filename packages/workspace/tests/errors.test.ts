import { describe, expect, it } from 'vitest'
import { ApiError, ERROR_CODES } from '@dramai/api'
import {
  blockingKind,
  errorInfo,
  errorKey,
  isApiCode,
  NETWORK_ERROR,
  shouldRetry,
} from '@/data/errors'
import zh from '@/i18n/locales/zh-CN'
import en from '@/i18n/locales/en'

describe('error codes drive the UI, never the message', () => {
  it('maps an ApiError by its code, ignoring the message text', () => {
    const a = new ApiError(409, 'CONFIRM_RECHARGE_REQUIRED', '随便什么文案', {
      requires: 'confirmRecharge',
    })
    const b = new ApiError(409, 'CONFIRM_RECHARGE_REQUIRED', 'completely different words')
    expect(errorInfo(a).code).toBe('CONFIRM_RECHARGE_REQUIRED')
    expect(errorInfo(b).code).toBe('CONFIRM_RECHARGE_REQUIRED')
    expect(errorInfo(a).details).toEqual({ requires: 'confirmRecharge' })
    expect(isApiCode(a, 'CONFIRM_RECHARGE_REQUIRED')).toBe(true)
    expect(isApiCode(a, 'ALREADY_FINISHED')).toBe(false)
  })

  it('codes outside the closed table fall back to UNKNOWN; transport failures are NETWORK_ERROR', () => {
    expect(errorInfo(new ApiError(500, 'SOMETHING_NEW', 'x')).code).toBe('UNKNOWN')
    expect(errorInfo(new ApiError(502, 'HTTP_ERROR', 'Bad Gateway')).code).toBe('HTTP_ERROR')
    expect(errorInfo(new TypeError('Failed to fetch')).code).toBe(NETWORK_ERROR)
    expect(errorInfo(new Error('boom')).code).toBe('UNKNOWN')
    expect(errorKey('SOMETHING_NEW')).toBe('errors.UNKNOWN')
    expect(errorKey('NO_LLM_PROVIDER')).toBe('errors.NO_LLM_PROVIDER')
  })

  it('every code in the contract has copy in both languages', () => {
    const codes = [...Object.keys(ERROR_CODES), NETWORK_ERROR, 'UNKNOWN']
    for (const code of codes) {
      expect(zh.errors, `zh-CN missing ${code}`).toHaveProperty(code)
      expect(en.errors, `en missing ${code}`).toHaveProperty(code)
    }
  })

  it('blocking errors get a full-screen treatment', () => {
    expect(blockingKind(new ApiError(401, 'UNAUTHORIZED', ''))).toBe('unauthorized')
    expect(blockingKind(new ApiError(403, 'HOST_NOT_ALLOWED', ''))).toBe('host')
    expect(blockingKind(new ApiError(403, 'CROSS_ORIGIN', ''))).toBe('host')
    expect(blockingKind(new TypeError('Failed to fetch'))).toBe('unreachable')
    expect(blockingKind(new ApiError(404, 'NOT_FOUND', ''))).toBeUndefined()
  })

  it('only transport failures and 5xx are retried', () => {
    expect(shouldRetry(0, new TypeError('x'))).toBe(true)
    expect(shouldRetry(2, new TypeError('x'))).toBe(false)
    expect(shouldRetry(0, new ApiError(500, 'INTERNAL', ''))).toBe(true)
    expect(shouldRetry(1, new ApiError(500, 'INTERNAL', ''))).toBe(false)
    expect(shouldRetry(0, new ApiError(409, 'BUSY', ''))).toBe(false)
    expect(shouldRetry(0, new ApiError(404, 'NOT_FOUND', ''))).toBe(false)
  })
})
