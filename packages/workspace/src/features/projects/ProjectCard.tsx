import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { ProjectListItem } from '@dramai/api'
import { FolderOpen, MoreHorizontal, Trash2 } from 'lucide-react'
import { Frame, IconButton, Menu, Pill, SegmentedProgress, iconProps } from '@dramai/ui/v2'
import { callBridge, isDesktop } from '@/desktop/bridge'
import { useApi } from '@/data/use-api'
import { useFormat } from '@/i18n/format'
import { episodeTone, projectStatus } from './project-status'

const STRIP = 6

/** 项目卡：封面条（最多 6 个小画框）、项目名、风格 / 画幅 / 镜数、分集进度、状态和更新时间。 */
export function ProjectCard({
  project,
  onDelete,
}: {
  project: ProjectListItem
  onDelete?: (p: ProjectListItem) => void
}) {
  const { t } = useTranslation()
  const api = useApi()
  const fmt = useFormat()
  const status = projectStatus(project)
  const thumbs = project.thumbnails.slice(0, STRIP)
  const eps = project.episodes
  const summary =
    eps.length > 0
      ? t('projects.card.episodesShots', { episodes: eps.length, shots: project.shotCounts.total })
      : t('projects.card.noEpisodes')

  let pill: { tone: 'neutral' | 'info' | 'accent' | 'success'; hollow?: boolean; label: string }
  switch (status.kind) {
    case 'draft':
      pill = { tone: 'neutral', hollow: true, label: t('projects.card.draft') }
      break
    case 'allPlanned':
      pill = {
        tone: 'neutral',
        hollow: true,
        label: t('projects.card.allPlanned', { count: status.episodes }),
      }
      break
    case 'exported':
      pill = { tone: 'success', label: t('episodeStatus.exported') }
      break
    case 'episode':
      pill = {
        tone:
          status.status === 'producing'
            ? 'accent'
            : status.status === 'composed'
              ? 'success'
              : 'info',
        label: t(`projects.card.episodeStatus.${status.status}`, { n: status.number }),
      }
      break
  }

  return (
    <div className="group relative flex">
      <Link
        to={`/projects/${project.id}`}
        className="flex w-full flex-col gap-4 rounded-lg border border-border bg-surface p-4 transition-colors duration-(--duration-fast) ease-standard hover:border-border-strong hover:bg-surface-2"
      >
        <div aria-hidden className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: STRIP }, (_, i) => {
            const th = thumbs[i]
            return (
              <Frame
                key={th?.shotId ?? `empty-${i}`}
                ratio={project.aspectRatio}
                src={th ? api.fileUrl(project.id, th.path) : undefined}
                className="min-w-0"
              />
            )
          })}
        </div>
        <div className="min-w-0">
          <h3 className="truncate font-display text-title-sm font-bold">{project.name}</h3>
          <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            {project.style.source !== 'none' && project.style.label && (
              <span>{project.style.label}</span>
            )}
            <span>{project.aspectRatio}</span>
            <span>{summary}</span>
          </div>
        </div>
        <SegmentedProgress
          aria-label={t('projects.card.progressLabel')}
          segments={eps.map((e) => episodeTone(e.status))}
        />
        <div className="mt-auto flex items-center justify-between gap-2 text-xs text-subtle">
          <Pill tone={pill.tone} hollow={pill.hollow}>
            {pill.label}
          </Pill>
          <span>{fmt.updated(project.updatedAt)}</span>
        </div>
      </Link>
      {onDelete && (
        <div className="absolute top-2 right-2">
          <Menu
            aria-label={t('projects.card.menu', { name: project.name })}
            trigger={
              <IconButton
                label={t('projects.card.menu', { name: project.name })}
                className="bg-surface/80"
              >
                <MoreHorizontal {...iconProps} aria-hidden />
              </IconButton>
            }
            items={[
              ...(isDesktop()
                ? [
                    {
                      key: 'reveal',
                      label: t('desktop.revealProject'),
                      icon: <FolderOpen {...iconProps} aria-hidden />,
                      onSelect: () =>
                        void callBridge(
                          (b) => b.revealProjectFile({ projectId: project.id }),
                          false,
                        ),
                    },
                  ]
                : []),
              {
                key: 'delete',
                label: t('projects.card.delete'),
                icon: <Trash2 {...iconProps} aria-hidden />,
                danger: true,
                onSelect: () => onDelete(project),
              },
            ]}
          />
        </div>
      )}
    </div>
  )
}
