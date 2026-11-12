import { useTranslation } from 'react-i18next'
import { errorInfo, errorKey } from '@/data/errors'

/** 错误 → 本地化文字。按 code 取文案；NOT_FOUND 带上是哪一类东西。 */
export function useErrorText() {
  const { t } = useTranslation()
  return (err: unknown): string => {
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
