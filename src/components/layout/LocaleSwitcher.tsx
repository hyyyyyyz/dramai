import { Languages } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { LOCALE_LABEL, SUPPORTED_LOCALES, type SupportedLocale } from '@/i18n'

export function LocaleSwitcher() {
  const { i18n, t } = useTranslation()
  const current = (i18n.resolvedLanguage || i18n.language || 'zh-CN') as SupportedLocale
  const next: SupportedLocale =
    SUPPORTED_LOCALES[(SUPPORTED_LOCALES.indexOf(current) + 1) % SUPPORTED_LOCALES.length]

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => void i18n.changeLanguage(next)}
      aria-label={t('nav.language')}
      title={`${t('nav.language')} · ${LOCALE_LABEL[next]}`}
    >
      <Languages className="h-4 w-4" />
    </Button>
  )
}
