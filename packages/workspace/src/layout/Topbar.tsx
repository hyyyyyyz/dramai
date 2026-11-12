import { Link, useLocation, useMatch } from 'react-router'
import { useTranslation } from 'react-i18next'
import { BrandMark } from '@dramai/ui/v2'
import { useProject } from '@/data/queries'
import { LocaleToggle } from './LocaleToggle'
import { TaskTrigger } from './TaskTrigger'
import { ThemeToggle } from './ThemeToggle'

const PAGE_KEYS = ['materials', 'assets', 'candidates', 'storyboard', 'compose', 'export'] as const
const SETTINGS_KEYS = ['providers', 'general', 'access', 'data', 'about'] as const

function ProjectCrumb({ projectId }: { projectId: string }) {
  const project = useProject(projectId)
  return <>{project.data?.name ?? '…'}</>
}

/** 面包屑：项目 / 项目名 / 当前页。窄屏只留当前页和品牌标。 */
function Crumbs() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const project = useMatch('/projects/:projectId/*')
  const projectId = project?.params.projectId
  const parts = pathname.split('/').filter(Boolean)
  const sep = <span className="text-border-strong max-[800px]:hidden">/</span>
  const link = 'hover:text-foreground max-[800px]:hidden'

  if (parts[0] === 'settings') {
    const sub = SETTINGS_KEYS.find((k) => k === parts[1]) ?? 'providers'
    return (
      <>
        <span className="text-muted-foreground">{t('nav.settings')}</span>
        {sep}
        <span className="truncate font-medium text-foreground">{t(`settings.tabs.${sub}`)}</span>
      </>
    )
  }
  if (projectId) {
    const rest = parts.slice(2)
    const page = rest[0] === 'episodes' ? rest[2] : rest[0]
    const key = PAGE_KEYS.find((k) => k === page) ?? 'overview'
    const label = key === 'overview' ? t('nav.overview') : t(`nav.${key}`)
    return (
      <>
        <Link to="/projects" className={link}>
          {t('nav.projects')}
        </Link>
        {sep}
        <Link to={`/projects/${projectId}`} className={link}>
          <ProjectCrumb projectId={projectId} />
        </Link>
        {sep}
        <span className="truncate font-medium text-foreground">{label}</span>
      </>
    )
  }
  return <span className="truncate font-medium text-foreground">{t('nav.projects')}</span>
}

export function Topbar({
  tasksOpen,
  onToggleTasks,
}: {
  tasksOpen: boolean
  onToggleTasks: () => void
}) {
  return (
    <header className="flex h-14 flex-none items-center gap-3 border-b border-border bg-background px-6 max-[800px]:h-[52px] max-[800px]:px-4">
      <Link to="/projects" aria-label="dramai" className="hidden max-[800px]:inline-flex">
        <BrandMark className="h-8 w-auto" />
      </Link>
      <nav
        aria-label="breadcrumb"
        className="flex min-w-0 items-center gap-2 whitespace-nowrap text-muted-foreground"
      >
        <Crumbs />
      </nav>
      <span className="flex-1" />
      <TaskTrigger open={tasksOpen} onToggle={onToggleTasks} />
      <LocaleToggle />
      <ThemeToggle />
    </header>
  )
}
