import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState } from '@dramai/ui/v2'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <EmptyState
      title={t('notFound.title')}
      description={t('notFound.body')}
      action={
        <Link to="/projects">
          <Button variant="secondary" tabIndex={-1}>
            {t('notFound.back')}
          </Button>
        </Link>
      }
    />
  )
}
