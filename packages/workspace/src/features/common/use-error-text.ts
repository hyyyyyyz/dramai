import { useTranslation } from 'react-i18next'
import { errorInfo, errorKey } from '@/data/errors'
import { requestProblem } from '@/data/request-problem'

/** 错误 → 本地化文字。按 code 取文案；NOT_FOUND 带上是哪一类东西。 */
export function useErrorText() {
  const { t } = useTranslation()
  return (err: unknown): string => {
    // The client checks what it is about to send against the contract. A refusal there is not an API error and used to
    // read as "something went wrong": say which field, and why.
    const bad = requestProblem(err)
    if (bad) {
      const field = t(`errors.fields.${bad.path}` as 'errors.fields.name', {
        defaultValue: bad.path,
      })
      const reason =
        bad.kind === 'too_big'
          ? t('errors.reason.tooBig', { max: bad.limit })
          : bad.kind === 'empty'
            ? t('errors.reason.empty')
            : bad.kind === 'too_small'
              ? t('errors.reason.tooSmall', { min: bad.limit })
              : bad.message
      return t('errors.fieldInvalid', { field, reason })
    }
    const info = errorInfo(err)
    if (info.code === 'NOT_FOUND') {
      const entity = (info.details as { entity?: string } | undefined)?.entity
      return t('errors.NOT_FOUND', {
        entity: entity
          ? t(`entities.${entity}` as 'entities.project', { defaultValue: entity })
          : t('entities.unknown'),
      })
    }
    return t(errorKey(info.code === 'HTTP_ERROR' ? 'UNKNOWN' : info.code) as 'errors.UNKNOWN')
  }
}
