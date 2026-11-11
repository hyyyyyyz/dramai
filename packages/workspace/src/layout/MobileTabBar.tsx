import { useMatch } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  Clapperboard,
  Film,
  FileText,
  LayoutDashboard,
  Library,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'
import { iconProps } from '@dramai/ui/v2'
import { NavLink } from 'react-router'
import { useCurrentEpisode } from '@/data/current-episode'

function Tab({
  to,
  end,
  icon,
  label,
}: {
  to: string
  end?: boolean
  icon: React.ReactNode
  label: string
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className="flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground aria-[current=page]:text-foreground aria-[current=page]:[&_svg]:text-accent-text"
    >
      {icon}
      {label}
    </NavLink>
  )
}

/** ≤800px：侧栏变底部标签栏。项目内五项：概览、资产、分镜、合成、导出；其余入口从概览进入。 */
export function MobileTabBar() {
  const { t } = useTranslation()
  const match = useMatch('/projects/:projectId/*')
  const projectId = match?.params.projectId
  const { current } = useCurrentEpisode(projectId ?? '')
  const base = projectId && current ? `/projects/${projectId}/episodes/${current.id}` : undefined
  return (
    <nav
      aria-label={t('shell.mainNav')}
      className="fixed inset-x-0 bottom-0 z-20 hidden h-16 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] max-[800px]:grid"
      style={{ gridTemplateColumns: `repeat(${projectId ? 5 : 2}, 1fr)` }}
    >
      {projectId ? (
        <>
          <Tab
            to={`/projects/${projectId}`}
            end
            icon={<LayoutDashboard {...iconProps} />}
            label={t('nav.overview')}
          />
          <Tab
            to={`/projects/${projectId}/assets`}
            icon={<Library {...iconProps} />}
            label={t('nav.assets')}
          />
          <Tab
            to={base ? `${base}/storyboard` : `/projects/${projectId}`}
            icon={<Clapperboard {...iconProps} />}
            label={t('nav.storyboard')}
          />
          <Tab
            to={base ? `${base}/compose` : `/projects/${projectId}`}
            icon={<Film {...iconProps} />}
            label={t('nav.compose')}
          />
          <Tab
            to={base ? `${base}/export` : `/projects/${projectId}`}
            icon={<Upload {...iconProps} />}
            label={t('nav.export')}
          />
        </>
      ) : (
        <>
          <Tab to="/projects" icon={<FileText {...iconProps} />} label={t('nav.projects')} />
          <Tab
            to="/settings"
            icon={<SlidersHorizontal {...iconProps} />}
            label={t('nav.settings')}
          />
        </>
      )}
    </nav>
  )
}
