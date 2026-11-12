import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { Episode, EpisodeProgress } from '@dramai/api'
import { Button, cn, iconProps } from '@dramai/ui/v2'
import { Block } from '@/features/common/PageHead'
import { computeNextSteps, type Step } from './next-steps'

export interface NextStepsProps {
  projectId: string
  episode: Pick<Episode, 'id' | 'number' | 'title'>
  progress: EpisodeProgress
  episodesInProgress: number
  episodeCount: number
  onBreakdown: () => void
  onExtract: () => void
  busy?: 'breakdown' | 'extract'
}

/** 当前集的六步清单：已完成 / 现在 / 未开始，每项写着数量和缺什么，“现在”这一项带直达按钮。 */
export function NextSteps({
  projectId,
  episode,
  progress,
  episodesInProgress,
  episodeCount,
  onBreakdown,
  onExtract,
  busy,
}: NextStepsProps) {
  const { t } = useTranslation()
  const steps = computeNextSteps(progress)
  const base = `/projects/${projectId}`
  const epBase = `${base}/episodes/${episode.id}`

  const detail = (s: Step): string => {
    switch (s.key) {
      case 'split':
        return s.state === 'done'
          ? t('overview.steps.split.done', { scenes: s.n.scenes, shots: s.n.shots })
          : t('overview.steps.split.todo')
      case 'candidates':
        if (s.variant === 'pending')
          return t('overview.steps.candidates.pending', { count: s.n.pending })
        if (s.variant === 'notExtracted') return t('overview.steps.candidates.notExtracted')
        if (s.variant === 'empty') return t('overview.steps.candidates.empty')
        return t('overview.steps.candidates.done', { count: s.n.total })
      case 'sheets':
        return s.n.total === 0
          ? t('overview.steps.sheets.none')
          : t('overview.steps.sheets.count', { done: s.n.done, total: s.n.total }) +
              (s.n.stale ? ` · ${t('overview.stale', { count: s.n.stale })}` : '')
      case 'images':
        return s.n.total === 0
          ? t('overview.steps.images.none')
          : t('overview.steps.images.count', { done: s.n.done, total: s.n.total }) +
              (s.n.stale ? ` · ${t('overview.stale', { count: s.n.stale })}` : '')
      case 'videos':
        return s.n.total === 0
          ? t('overview.steps.videos.none')
          : t('overview.steps.videos.count', { done: s.n.done, total: s.n.total }) +
              (s.n.stale ? ` · ${t('overview.stale', { count: s.n.stale })}` : '')
      case 'compose':
        return s.state === 'done'
          ? t('overview.steps.compose.done') + (s.n.stale ? ` · ${t('overview.cutStale')}` : '')
          : t('overview.steps.compose.todo')
    }
  }

  const action = (s: Step) => {
    if (s.state !== 'now') return null
    switch (s.key) {
      case 'split':
        return (
          <Button size="sm" variant="primary" loading={busy === 'breakdown'} onClick={onBreakdown}>
            {t('overview.actions.breakdown')}
          </Button>
        )
      case 'candidates':
        return s.variant === 'notExtracted' ? (
          <Button size="sm" variant="primary" loading={busy === 'extract'} onClick={onExtract}>
            {t('overview.actions.extract')}
          </Button>
        ) : (
          <Link to={`${base}/candidates`}>
            <Button size="sm" variant="primary" tabIndex={-1}>
              {t('overview.actions.goCandidates')}
            </Button>
          </Link>
        )
      case 'sheets':
        return (
          <Link to={`${base}/assets`}>
            <Button size="sm" variant="secondary" tabIndex={-1}>
              {t('overview.actions.goAssets')}
            </Button>
          </Link>
        )
      case 'images':
      case 'videos':
        return (
          <Link to={`${epBase}/storyboard`}>
            <Button size="sm" variant="secondary" tabIndex={-1}>
              {t('overview.actions.goStoryboard')}
            </Button>
          </Link>
        )
      case 'compose':
        return (
          <Link to={`${epBase}/compose`}>
            <Button size="sm" variant="secondary" tabIndex={-1}>
              {t('overview.actions.goCompose')}
            </Button>
          </Link>
        )
    }
  }

  return (
    <Block
      aria-label={t('overview.nextStepsLabel')}
      title={t('overview.nextSteps', { n: episode.number, title: episode.title })}
      aside={t('overview.inProgress', { active: episodesInProgress, total: episodeCount })}
    >
      <ol>
        {steps.map((s, i) => (
          <li
            key={s.key}
            data-state={s.state}
            className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border px-4 py-3 first:border-t-0"
          >
            <span
              aria-hidden
              className={cn(
                'grid size-6 place-items-center rounded-full border border-border-strong font-mono text-xs text-subtle',
                s.state === 'done' && 'border-transparent bg-success-soft text-success',
                s.state === 'now' && 'border-accent text-accent-text',
              )}
            >
              {s.state === 'done' ? <Check {...iconProps} size={14} /> : i + 1}
            </span>
            <div
              className={cn(
                'min-w-0 leading-normal',
                s.state === 'todo' && 'text-muted-foreground',
              )}
            >
              <div>
                {t(`overview.steps.${s.key}.title`)}
                <span className="sr-only"> — {t(`overview.stepState.${s.state}`)}</span>
              </div>
              <small className="block text-xs text-muted-foreground">{detail(s)}</small>
            </div>
            <div>{action(s)}</div>
          </li>
        ))}
      </ol>
    </Block>
  )
}
