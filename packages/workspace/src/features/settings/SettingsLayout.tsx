import { NavLink, Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { PageHead } from '@/features/common/PageHead'

const TABS = ['providers', 'general', 'access', 'data', 'about'] as const

export function SettingsLayout() {
  const { t } = useTranslation()
  return (
    <>
      <PageHead title={t('nav.settings')} />
      <div className="grid grid-cols-[180px_minmax(0,1fr)] items-start gap-6 max-[800px]:grid-cols-1">
        <nav
          aria-label={t('settings.tabsLabel')}
          className="flex flex-col gap-0.5 max-[800px]:flex-row max-[800px]:overflow-x-auto max-[800px]:border-b max-[800px]:border-border"
        >
          {TABS.map((tab) => (
            <NavLink
              key={tab}
              to={`/settings/${tab}`}
              className="flex h-9 items-center rounded-md px-3 whitespace-nowrap text-muted-foreground hover:bg-surface-2 hover:text-foreground aria-[current=page]:bg-surface-2 aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            >
              {t(`settings.tabs.${tab}`)}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </>
  )
}
