import { Link, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { CallOutput } from '@dramai/api'
import { Button, Pill, SegmentedProgress, cn } from '@dramai/ui/v2'
import { Block } from '@/features/common/PageHead'
import { episodeStatusTone, sourceChapterRange } from '@/lib/episode'
import { shotSegments } from './next-steps'

type EpisodeItem = CallOutput<'episodes.list'>['items'][number]
type MaterialItem = CallOutput<'materials.list'>['items'][number]

/** 概览里的分集列表：序号、标题与原文范围、状态与镜头分段进度、成片状态、动作。 */
export function EpisodeList({
  projectId,
  episodes,
  materials,
  currentId,
  onSelect,
  onBreakdown,
  breakingDown,
}: {
  projectId: string
  episodes: EpisodeItem[]
  materials: MaterialItem[]
  currentId?: string
  onSelect: (id: string) => void
  onBreakdown: (id: string) => void
  breakingDown?: (episodeId: string) => boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const shots = episodes.reduce((n, e) => n + e.progress.split.shots, 0)
  return (
    <Block
      title={t('overview.episodes.title')}
      aside={t('overview.episodes.shotsTotal', { count: shots })}
      aria-label={t('overview.episodes.title')}
    >
      <div
        className="grid grid-cols-[40px_minmax(0,1.3fr)_minmax(0,1fr)_140px_auto] gap-x-4 bg-surface-2 px-4 py-2 text-xs text-subtle @max-3xl:hidden"
        aria-hidden
      >
        <span>{t('overview.episodes.colEpisode')}</span>
        <span>{t('overview.episodes.colTitle')}</span>
        <span>{t('overview.episodes.colStatus')}</span>
        <span>{t('overview.episodes.colCut')}</span>
        <span />
      </div>
      <ul>
        {episodes.map((e) => {
          const range = sourceChapterRange(e, materials)
          const planned = e.status === 'planned' && e.progress.split.shots === 0
          const segs = shotSegments(e.progress)
          const cut = e.progress.composition
          return (
            <li
              key={e.id}
              aria-current={e.id === currentId ? 'true' : undefined}
              className={cn(
                'grid grid-cols-[40px_minmax(0,1.3fr)_minmax(0,1fr)_140px_auto] items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 first:border-t-0',
                '@max-3xl:grid-cols-[32px_minmax(0,1fr)_auto]',
                e.id === currentId && 'bg-accent/[0.06]',
              )}
            >
              <span className="font-mono text-muted-foreground">
                {String(e.number).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <div className="truncate font-display text-[15px] leading-snug font-bold">
                  {e.title}
                </div>
                <div className="text-sm text-muted-foreground">
                  {range
                    ? t('common.sourceChapters', { from: range.from, to: range.to })
                    : t('common.noSourceRange')}
                </div>
              </div>
              <div className="flex flex-col gap-2 @max-3xl:order-last @max-3xl:col-span-3 @max-3xl:col-start-1">
                <Pill tone={episodeStatusTone(e.status)} hollow={planned} className="self-start">
                  {t(`episodeStatus.${e.status}`)}
                </Pill>
                {segs.length > 0 && (
                  <SegmentedProgress
                    segments={segs}
                    aria-label={t('overview.episodes.shotProgress', {
                      videos: e.progress.videos.done,
                      images: e.progress.images.done,
                      total: e.progress.split.shots,
                    })}
                  />
                )}
              </div>
              <div className="text-sm text-muted-foreground @max-3xl:hidden">
                {cut.done ? (
                  <>
                    {t('overview.episodes.cut')}{' '}
                    <Pill tone={cut.stale ? 'warn' : 'success'} className="ml-1">
                      {cut.stale
                        ? t('overview.episodes.cutStale')
                        : t('overview.episodes.cutCurrent')}
                    </Pill>
                  </>
                ) : e.progress.split.shots > 0 ? (
                  t('overview.episodes.noCut')
                ) : (
                  '—'
                )}
              </div>
              <div className="flex justify-end">
                {planned ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={breakingDown?.(e.id)}
                    onClick={() => onBreakdown(e.id)}
                  >
                    {t('overview.actions.breakdown')}
                  </Button>
                ) : e.status === 'exported' ? (
                  <Link
                    to={`/projects/${projectId}/episodes/${e.id}/export`}
                    onClick={() => onSelect(e.id)}
                  >
                    <Button size="sm" variant="ghost" tabIndex={-1}>
                      {t('overview.episodes.view')}
                    </Button>
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    variant={e.id === currentId ? 'secondary' : 'ghost'}
                    onClick={() => {
                      onSelect(e.id)
                      void navigate(`/projects/${projectId}/episodes/${e.id}/storyboard`)
                    }}
                  >
                    {t('overview.episodes.continue')}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </Block>
  )
}
