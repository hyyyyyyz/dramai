import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  Clock,
  Image as ImageIcon,
  Mic,
  Play,
  Film,
  FileText,
  Ban,
  RotateCcw,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { JobListItem } from '@dramai/api'
import { Button, IconButton, Progress, iconProps, cn } from '@dramai/ui/v2'
import { useFormat } from '@/i18n/format'
import { failureKind, isKnownOperation, jobActions } from './job-model'

const LANE_ICON: Record<JobListItem['type'], LucideIcon> = {
  text: FileText,
  image: ImageIcon,
  video: Film,
  audio: Mic,
  render: Film,
}

export interface TaskItemProps {
  job: JobListItem
  /** 已解析好的上下文：项目名、第几集。 */
  context?: string
  now: number
  /** 文本任务流式输出已累计的字数。 */
  streamedChars?: number
  /** 正在提交某个操作（防重复点击）。 */
  busy?: boolean
  onCancel: (job: JobListItem) => void
  onResume: (job: JobListItem) => void
  onRegenerate: (job: JobListItem) => void
  onAcknowledge: (job: JobListItem) => void
}

/** 任务面板里的一个条目：状态、说明，以及这个状态下允许的操作（见 job-model.ts）。 */
export function TaskItem({
  job,
  context,
  now,
  streamedChars,
  busy,
  onCancel,
  onResume,
  onRegenerate,
  onAcknowledge,
}: TaskItemProps) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const actions = jobActions(job)
  const failed = job.status === 'failed'
  const unacknowledgedFail = failed && job.needsAttention
  const kind = failed ? failureKind(job) : undefined
  const title = isKnownOperation(job.operation)
    ? t(`jobs.op.${job.operation}`)
    : t('jobs.op.unknown', { operation: job.operation })

  const Icon =
    job.status === 'succeeded'
      ? Check
      : failed
        ? AlertTriangle
        : job.status === 'running'
          ? Play
          : job.status === 'cancelled'
            ? Ban
            : Clock

  const sub: string[] = []
  if (context) sub.push(context)
  if (job.providerLabel) sub.push(job.providerLabel)
  if (job.status === 'queued' && job.queuePosition)
    sub.push(t('jobs.queuePosition', { n: job.queuePosition }))
  if (job.status === 'running' && job.startedAt)
    sub.push(t('jobs.elapsed', { duration: fmt.duration(now - job.startedAt) }))
  if (failed && job.finishedAt) sub.push(fmt.ago(job.finishedAt, now))
  if (job.status === 'succeeded' && job.startedAt && job.finishedAt)
    sub.push(t('jobs.tookTime', { duration: fmt.duration(job.finishedAt - job.startedAt) }))
  if (job.status === 'cancelled') sub.push(t('jobs.cancelledLabel'))
  if (job.attempt > 1) sub.push(t('jobs.attempt', { n: job.attempt }))

  const LaneIcon = LANE_ICON[job.type]
  return (
    <li
      data-state={failed ? 'failed' : job.status}
      data-kind={kind}
      className={cn(
        'grid grid-cols-[24px_minmax(0,1fr)_auto] gap-3 rounded-md border bg-background p-3',
        unacknowledgedFail ? 'border-danger' : 'border-border',
      )}
    >
      <div
        aria-hidden
        className={cn(
          'grid size-6 place-items-center rounded-sm bg-surface-2 text-muted-foreground',
          job.status === 'running' && 'bg-accent-soft text-accent-text',
          failed && 'bg-danger-soft text-danger',
          job.status === 'succeeded' && 'bg-success-soft text-success',
        )}
      >
        <Icon {...iconProps} size={14} />
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2 font-medium">
          <span className="min-w-0 truncate">{title}</span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-xs bg-surface-2 px-1 text-xs font-normal text-subtle">
            <LaneIcon size={11} strokeWidth={1.5} aria-hidden />
            {t(`jobs.lane.${job.type}`)}
          </span>
        </div>
        {sub.length > 0 && (
          <div className="text-xs leading-normal text-muted-foreground">{sub.join(' · ')}</div>
        )}

        {job.status === 'running' && (
          <>
            <Progress
              className="mt-2"
              aria-label={title}
              indeterminate={job.progress === undefined}
              value={(job.progress ?? 0) * 100}
            />
            {job.type === 'text' && streamedChars ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {t('jobs.streamedChars', { count: streamedChars, n: fmt.number(streamedChars) })}
              </div>
            ) : null}
            <div className="mt-1 text-xs text-subtle">
              {job.paid ? t('jobs.runningNotCancellable') : t('jobs.runningLocal')}
            </div>
          </>
        )}

        {failed && kind && (
          <>
            <div className="mt-1 text-xs leading-normal text-danger">
              {t(`jobs.failure.${kind}`)}
            </div>
            {kind === 'submission_unknown' && (
              <div className="text-xs leading-normal text-subtle">
                {t('jobs.failureUnknownNote')}
              </div>
            )}
            {job.error?.code && (
              <div className="font-mono text-xs text-subtle" title={job.error.message}>
                {job.error.code}
              </div>
            )}
          </>
        )}

        {(actions.resume || actions.regenerate || actions.acknowledge) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {actions.resume && (
              <Button size="sm" variant="primary" disabled={busy} onClick={() => onResume(job)}>
                <RotateCcw {...iconProps} size={14} aria-hidden />
                {t('jobs.actions.resume')}
              </Button>
            )}
            {actions.regenerate && (
              <Button
                size="sm"
                variant={actions.resume ? 'secondary' : 'primary'}
                disabled={busy}
                onClick={() => onRegenerate(job)}
              >
                {actions.regenerate === 'recharge'
                  ? t('jobs.actions.regenerateRecharge')
                  : job.paid
                    ? t('jobs.actions.regenerate')
                    : t('jobs.actions.retryLocal')}
              </Button>
            )}
            {actions.acknowledge && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAcknowledge(job)}>
                {kind === 'submission_unknown'
                  ? t('jobs.actions.acknowledgeChecked')
                  : t('jobs.actions.acknowledge')}
              </Button>
            )}
          </div>
        )}
      </div>

      {actions.cancel ? (
        <IconButton
          label={t('jobs.actions.cancelQueued')}
          disabled={busy}
          onClick={() => onCancel(job)}
        >
          <X {...iconProps} aria-hidden />
        </IconButton>
      ) : (
        <span />
      )}
    </li>
  )
}
