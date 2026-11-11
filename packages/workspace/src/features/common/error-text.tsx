import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Notice, Button } from '@dramai/ui/v2'
import { errorInfo } from '@/data/errors'
import { useErrorText } from './use-error-text'

/** 某些错误有明确的下一步：去配大模型服务商、重新检查服务。 */
export function ErrorNotice({ error, className }: { error: unknown; className?: string }) {
  const { t } = useTranslation()
  const text = useErrorText()
  if (!error) return null
  const { code } = errorInfo(error)
  return (
    <Notice
      tone="danger"
      className={className}
      actions={
        code === 'NO_LLM_PROVIDER' ? (
          <Link to="/settings/providers">
            <Button size="sm" variant="secondary" tabIndex={-1}>
              {t('errors.goProviders')}
            </Button>
          </Link>
        ) : undefined
      }
    >
      {text(error)}
    </Notice>
  )
}
