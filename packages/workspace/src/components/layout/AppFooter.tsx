import { useTranslation } from 'react-i18next'

export function AppFooter() {
  const { t } = useTranslation()
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>{t('footer.summary')}</span>
        <span className="opacity-70">
          {t('footer.buildOn')}{' '}
          <code className="rounded bg-background-soft px-1.5 py-0.5 text-[11px]">
            github.io/dramai
          </code>
        </span>
      </div>
    </footer>
  )
}
