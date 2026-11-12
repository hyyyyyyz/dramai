import type { ApiErrorBody } from '@dramai/api'
import { DomainError } from '@dramai/core'
import type { DomainErrorKind, NotFoundEntity } from '@dramai/core'

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

const ENTITY_LABEL: Record<NotFoundEntity, string> = {
  project: '项目',
  episode: '分集',
  scene: '场',
  shot: '镜头',
  asset: '资产',
  candidate: '候选',
  timeline_revision: '时间线修订',
  timeline_clip: '时间线片段',
  media_version: '版本',
  variant: '衍生形态',
  material: '素材',
  job: '任务',
  provider: '服务商配置',
  provider_preset: '服务商预设',
  file: '文件',
  route: '接口',
  artifact: '产物',
}

/**
 * 找不到。**一律带实体类型和 id**（`details: { entity, id }`），界面据此显示"找不到这个镜头"之类的具体提示；
 * `message` 只是给人看的兜底文案。
 */
export const notFound = (entity: NotFoundEntity, id: string) =>
  new HttpError(404, 'NOT_FOUND', `${ENTITY_LABEL[entity]}不存在：${id}`, { entity, id })
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
