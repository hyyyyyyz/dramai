import { useNavigate, useMatch } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { Popover, iconProps, cn } from '@dramai/ui/v2'
import { useCurrentEpisode } from '@/data/current-episode'
import { useMaterials } from '@/data/queries'
import { sourceChapterRange } from '@/lib/episode'

/** 侧栏里的当前集切换器：点开列出各集和状态。 */
export function EpisodeSwitcher({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const { current, episodes, select } = useCurrentEpisode(projectId)
  const materials = useMaterials(projectId)
  const navigate = useNavigate()
  const onEpisodePage = useMatch('/projects/:projectId/episodes/:episodeId/:page')

  if (!episodes || episodes.length === 0) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-background p-3">
        <span className="text-xs text-subtle">{t('shell.currentEpisode')}</span>
        <span className="text-sm text-muted-foreground">{t('shell.noEpisodes')}</span>
      </div>
    )
  }

  const range = current ? sourceChapterRange(current, materials.data?.items ?? []) : undefined
  const title = (e: { number: number; title: string }) =>
    t('common.episodeTitle', { n: e.number, title: e.title })
  return (
    <div className="[&>span]:flex [&>span]:w-full">
      <Popover
        placement="bottom-start"
        aria-label={t('shell.switchEpisode')}
        trigger={
          <button
            type="button"
            className="flex w-full flex-col gap-1 rounded-lg border border-border bg-background p-3 text-left"
          >
            <span className="text-xs text-subtle">{t('shell.currentEpisode')}</span>
            <span className="flex items-center justify-between gap-2 font-medium leading-snug">
              <span className="min-w-0 truncate">{current ? title(current) : '—'}</span>
              <ChevronDown {...iconProps} aria-hidden className="shrink-0 text-subtle" />
            </span>
            {range && (
              <span className="text-xs text-muted-foreground">
                {t('common.sourceChapters', { from: range.from, to: range.to })}
              </span>
            )}
          </button>
        }
      >
        {(close) => (
          <ul
            className="flex w-64 flex-col p-1"
            role="listbox"
            aria-label={t('shell.switchEpisode')}
          >
            {episodes.map((e) => (
              <li key={e.id} role="option" aria-selected={e.id === current?.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-surface-2',
                    e.id === current?.id && 'bg-surface-2 font-medium',
                  )}
                  onClick={() => {
                    select(e.id)
                    close()
                    if (onEpisodePage)
                      void navigate(
                        `/projects/${projectId}/episodes/${e.id}/${onEpisodePage.params.page}`,
                      )
                  }}
                >
                  <span className="min-w-0 truncate">{title(e)}</span>
                  <span className="shrink-0 font-mono text-xs text-subtle">
                    {t(`episodeStatus.${e.status}`)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
    </div>
  )
}
