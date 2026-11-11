import { useTranslation } from 'react-i18next'
import { Moon, Sun } from 'lucide-react'
import { IconButton, iconProps } from '@dramai/ui/v2'
import { useTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { t } = useTranslation()
  const [theme, setTheme] = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <IconButton
      label={t(next === 'light' ? 'shell.themeToLight' : 'shell.themeToDark')}
      onClick={() => setTheme(next)}
    >
      {theme === 'dark' ? <Sun {...iconProps} aria-hidden /> : <Moon {...iconProps} aria-hidden />}
    </IconButton>
  )
}
