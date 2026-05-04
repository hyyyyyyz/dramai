import { NavLink, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/layout/BrandMark'
import { GithubIcon } from '@/components/icons/GithubIcon'
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher'

export function AppHeader() {
  const { t } = useTranslation()
  const NAV_ITEMS = [
    { label: t('nav.home'), to: '/' },
    { label: t('nav.projects'), to: '/projects' },
    { label: t('nav.settings'), to: '/settings' },
    { label: t('nav.about'), to: '/about' },
  ]

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="group flex items-center gap-2">
          <BrandMark className="h-7 w-7" />
          <span className="text-base font-semibold tracking-tight">{t('brand.name')}</span>
          <span className="hidden rounded-full bg-background-soft-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:inline-block">
            v0.4.1
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 sm:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-background-soft text-foreground'
                    : 'text-muted hover:bg-background-soft hover:text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <LocaleSwitcher />
          <Link to="/settings" className="sm:hidden">
            <Button variant="ghost" size="icon" aria-label={t('nav.settings')}>
              <SettingsIcon />
            </Button>
          </Link>
          <a href="https://github.com/hyyyyyyz/dramai" target="_blank" rel="noreferrer noopener">
            <Button variant="outline" size="sm" className="gap-2">
              <GithubIcon />
              <span className="hidden sm:inline">{t('nav.github')}</span>
            </Button>
          </a>
        </div>
      </div>
    </header>
  )
}
