import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-24 sm:px-6">
      <span className="text-gradient-brand text-6xl font-bold">404</span>
      <h1 className="text-2xl font-semibold">{t('notFound.title')}</h1>
      <p className="text-muted">{t('notFound.desc')}</p>
      <Link to="/">
        <Button>{t('notFound.back')}</Button>
      </Link>
    </section>
  )
}
