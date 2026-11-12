import { Link, useMatch } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Clapperboard,
  FileText,
  Film,
  FolderOpen,
  LayoutDashboard,
  Library,
  SlidersHorizontal,
  Tags,
  Upload,
} from 'lucide-react'
import { Wordmark, iconProps } from '@dramai/ui/v2'
import { useCurrentEpisode } from '@/data/current-episode'
import { useAssets, useCandidates, useMaterials, useProject, useProjects } from '@/data/queries'
import { NavItem } from './NavItem'
import { EpisodeSwitcher } from './EpisodeSwitcher'
import { ServiceStatus } from './ServiceStatus'
import { projectMeta } from '@/features/projects/project-meta'
import { useProjectEpisodeCounts } from './use-episode-counts'

export function Brand() {
  return (
    <Link to="/projects" aria-label="dramai" className="flex h-8 items-center px-2">
      <Wordmark className="h-6 w-auto" />
    </Link>
  )
}

function ProjectNav({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const project = useProject(projectId)
  const materials = useMaterials(projectId)
  const assets = useAssets(projectId)
  const candidates = useCandidates(projectId)
  const { current } = useCurrentEpisode(projectId)
  const shots = useProjectEpisodeCounts(projectId, current?.id)
  const epBase = current ? `/projects/${projectId}/episodes/${current.id}` : undefined
  return (
    <>
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-background p-3">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1 text-xs text-subtle hover:text-foreground"
        >
          <ArrowLeft {...iconProps} size={12} aria-hidden />
          {t('shell.allProjects')}
        </Link>
        <div className="font-display text-title-sm leading-snug font-bold">
          {project.data?.name ?? '…'}
        </div>
        {project.data && (
          <div className="text-xs text-muted-foreground">{projectMeta(project.data, t)}</div>
        )}
      </div>

      <nav className="flex flex-col gap-0.5" aria-label={t('shell.projectNav')}>
        <div className="mb-1 px-3 text-xs text-subtle">{t('shell.groupProject')}</div>
        <NavItem to={`/projects/${projectId}`} end icon={<LayoutDashboard {...iconProps} />}>
          {t('nav.overview')}
        </NavItem>
        <NavItem
          to={`/projects/${projectId}/materials`}
          icon={<FolderOpen {...iconProps} />}
          count={materials.data?.items.length}
        >
          {t('nav.materials')}
        </NavItem>
        <NavItem
          to={`/projects/${projectId}/assets`}
          icon={<Library {...iconProps} />}
          count={assets.data?.items.length}
        >
          {t('nav.assets')}
        </NavItem>
        <NavItem
          to={`/projects/${projectId}/candidates`}
          icon={<Tags {...iconProps} />}
          count={candidates.data?.progress.pending}
          hot
        >
          {t('nav.candidates')}
        </NavItem>
      </nav>

      <EpisodeSwitcher projectId={projectId} />

      {epBase && (
        <nav className="flex flex-col gap-0.5" aria-label={t('shell.episodeNav')}>
          <NavItem to={`${epBase}/storyboard`} icon={<Clapperboard {...iconProps} />} count={shots}>
            {t('nav.storyboard')}
          </NavItem>
          <NavItem to={`${epBase}/compose`} icon={<Film {...iconProps} />}>
            {t('nav.compose')}
          </NavItem>
          <NavItem to={`${epBase}/export`} icon={<Upload {...iconProps} />}>
            {t('nav.export')}
          </NavItem>
        </nav>
      )}
    </>
  )
}

export function Sidebar() {
  const { t } = useTranslation()
  const match = useMatch('/projects/:projectId/*')
  const projectId = match?.params.projectId
  const projects = useProjects()
  return (
    <aside className="flex flex-col gap-4 overflow-y-auto border-r border-border bg-surface px-3 py-4 max-[800px]:hidden">
      <Brand />
      {projectId ? (
        <ProjectNav projectId={projectId} />
      ) : (
        <nav className="flex flex-col gap-0.5" aria-label={t('shell.mainNav')}>
          <NavItem
            to="/projects"
            icon={<FileText {...iconProps} />}
            count={projects.data?.items.length}
          >
            {t('nav.projects')}
          </NavItem>
        </nav>
      )}
      <div className="mt-auto flex flex-col gap-2">
        <NavItem to="/settings" icon={<SlidersHorizontal {...iconProps} />}>
          {t('nav.settings')}
        </NavItem>
        <ServiceStatus showDataDir={!projectId} />
      </div>
    </aside>
  )
}
