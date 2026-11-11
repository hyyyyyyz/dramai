/**
 * 业务错误：带稳定错误码和分类，调用方（server、CLI）按 `code` / `kind` 处理，**不要**按文案匹配。
 *
 * 分类（`kind`）决定调用方怎么对待它：
 * - `not_found`：引用的东西不存在；
 * - `conflict`：与现有数据冲突（重名、已处理、版本重复）；
 * - `invalid`：输入本身不合法（类型不匹配、无法解析、未知模板）；
 * - `precondition`：当前状态不允许这个操作（还没有分镜、依据被阻断）。
 *
 * 其余（ffmpeg 失败、数据文件损坏、编程错误）仍是普通 `Error`——那不是调用方能处理的业务情形。
 */
export type DomainErrorKind = 'not_found' | 'conflict' | 'invalid' | 'precondition'

/** 全部错误码及其分类。`@dramai/api` 的 `ERROR_CODES` 与它保持一致（server 有测试核对）。 */
export const DOMAIN_ERROR_CODES = {
  NOT_FOUND: 'not_found',
  ASSET_NAME_TAKEN: 'conflict',
  CANDIDATE_ALREADY_HANDLED: 'conflict',
  CANDIDATE_NOT_LINKED: 'conflict',
  VERSION_EXISTS: 'conflict',
  KIND_MISMATCH: 'invalid',
  UNKNOWN_STYLE_TEMPLATE: 'invalid',
  MATERIAL_PARSE_FAILED: 'invalid',
  EPISODE_HAS_NO_SHOTS: 'precondition',
  EPISODE_HAS_NO_SOURCE: 'precondition',
  ARTIFACT_INPUTS_BLOCKED: 'precondition',
  ARTIFACT_UPSTREAM_MISSING: 'precondition',
} as const satisfies Record<string, DomainErrorKind>

export type DomainErrorCode = keyof typeof DOMAIN_ERROR_CODES

/** `NOT_FOUND` 的 `details.entity`。 */
export type NotFoundEntity =
  | 'project'
  | 'episode'
  | 'scene'
  | 'shot'
  | 'asset'
  | 'candidate'
  | 'timeline_revision'
  | 'timeline_clip'
  | 'media_version'

export class DomainError extends Error {
  readonly code: DomainErrorCode
  readonly kind: DomainErrorKind
  readonly details?: Record<string, unknown>
  constructor(
    code: DomainErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DomainError'
    this.code = code
    this.kind = DOMAIN_ERROR_CODES[code]
    this.details = options.details
  }
}

export function notFoundError(entity: NotFoundEntity, id: string, message?: string): DomainError {
  return new DomainError('NOT_FOUND', message ?? `${entity.replace('_', ' ')} not found: ${id}`, {
    details: { entity, id },
  })
}

export const isDomainError = (err: unknown): err is DomainError => err instanceof DomainError
