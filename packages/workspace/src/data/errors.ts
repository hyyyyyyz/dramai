import { ApiError, ERROR_CODES, isErrorCode, type ErrorCode } from '@dramai/api'

/**
 * 错误处理：永远按稳定的 `code`（@dramai/api 的 ERROR_CODES）分支，不看 `message`。
 * 服务端的 message 是给日志和开发者的，界面文案走 i18n（键是 `errors.<CODE>`）。
 */

/** 没有收到响应（服务没起来、网络断了、被浏览器拦截）。 */
export const NETWORK_ERROR = 'NETWORK_ERROR'

export interface ErrorInfo {
  /** 契约里的错误码，或 NETWORK_ERROR / HTTP_ERROR / UNKNOWN。 */
  code: ErrorCode | typeof NETWORK_ERROR | 'HTTP_ERROR' | 'UNKNOWN'
  status?: number
  details?: unknown
}

export function errorInfo(err: unknown): ErrorInfo {
  if (err instanceof ApiError) {
    if (isErrorCode(err.code)) return { code: err.code, status: err.status, details: err.details }
    return { code: err.code === 'HTTP_ERROR' ? 'HTTP_ERROR' : 'UNKNOWN', status: err.status }
  }
  // fetch 失败抛 TypeError
  if (err instanceof TypeError) return { code: NETWORK_ERROR }
  return { code: 'UNKNOWN' }
}

export function isApiCode(err: unknown, ...codes: ErrorCode[]): boolean {
  const info = errorInfo(err)
  return (codes as string[]).includes(info.code)
}

/** 需要整屏提示的错误：没有访问令牌、Host 不被允许、连不上服务。 */
export type BlockingKind = 'unauthorized' | 'host' | 'unreachable'
export function blockingKind(err: unknown): BlockingKind | undefined {
  const { code } = errorInfo(err)
  if (code === 'UNAUTHORIZED') return 'unauthorized'
  if (code === 'HOST_NOT_ALLOWED' || code === 'CROSS_ORIGIN') return 'host'
  if (code === NETWORK_ERROR) return 'unreachable'
  return undefined
}

/** 错误码 → 翻译键。表里没有的码落到 errors.UNKNOWN。 */
export function errorKey(code: string): `errors.${string}` {
  return (
    code in ERROR_CODES
      ? `errors.${code}`
      : `errors.${code === NETWORK_ERROR ? NETWORK_ERROR : 'UNKNOWN'}`
  ) as `errors.${string}`
}

/** 这些码值得整个重试；4xx 业务错误重试没有意义。 */
export function shouldRetry(failureCount: number, err: unknown): boolean {
  const info = errorInfo(err)
  if (info.code === NETWORK_ERROR) return failureCount < 2
  if (info.status !== undefined && info.status >= 500) return failureCount < 1
  return false
}
