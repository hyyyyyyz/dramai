import { useTranslation } from 'react-i18next'
import { Check, Languages } from 'lucide-react'
import { IconButton, Menu, iconProps } from '@dramai/ui/v2'
import { LOCALES, setLocale, type Locale } from '@/i18n'

const NAMES: Record<Locale, string> = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English' }

export function LocaleToggle() {
  const { t, i18n } = useTranslation()
  return (
    <Menu
      aria-label={t('shell.language')}
      trigger={
        <IconButton label={t('shell.language')}>
          <Languages {...iconProps} aria-hidden />
        </IconButton>
      }
      items={LOCALES.map((l) => ({
        key: l,
        label: NAMES[l],
        icon:
          i18n.language === l ? <Check {...iconProps} aria-hidden /> : <span className="size-4" />,
        onSelect: () => void setLocale(l),
      }))}
    />
  )
}
