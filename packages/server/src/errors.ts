import type { ApiErrorBody } from '@dramai/api'
import { DomainError } from '@dramai/core'
import type { DomainErrorKind } from '@dramai/core'

/** 带 HTTP 状态码与稳定错误码的错误；路由处理层统一转成 `{ error: { code, message, details } }`。 */
export class HttpError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    }
  }
}

export const notFound = (what: string, id?: string) =>
  new HttpError(404, 'NOT_FOUND', id ? `${what} 不存在：${id}` : `${what} 不存在`)
export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', message, details)
export const conflict = (code: string, message: string, details?: unknown) =>
  new HttpError(409, code, message, details)

const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  not_found: 404,
  conflict: 409,
  invalid: 400,
  // 当前状态不允许这个操作：和冲突同属 409，前端据 code 给出下一步。
  precondition: 409,
}

/** core 的业务错误 → HTTP：状态码来自分类（kind），错误码原样透传；不看文案。 */
export function fromDomainError(err: DomainError): HttpError {
  return new HttpError(STATUS_BY_KIND[err.kind], err.code, err.message, err.details)
}
