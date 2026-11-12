import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListChecks, PanelRightClose } from 'lucide-react'
import type { JobListItem } from '@dramai/api'
import {
  Button,
  IconButton,
  Notice,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  iconProps,
} from '@dramai/ui/v2'
import { useEventSnapshot } from '@/data/use-events'
import { useJobs, useProjects } from '@/data/queries'
import { useNow } from '@/lib/use-now'
import { useErrorText } from '@/features/common/use-error-text'
import { TaskItem } from './TaskItem'
import { jobContext } from './job-context'
import { groupJobs, jobCounts, type JobGroup } from './job-model'
import { useJobOps } from './job-ops-context'

type Filter = 'all' | 'running' | 'queued' | 'attention'

/** 常驻任务面板（桌面是右侧栏，窄屏放进抽屉）。跨项目：所有任务都在这里。 */
export function TaskPanel({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const { t } = useTranslation()
  const jobs = useJobs()
  const projects = useProjects()
  const snapshot = useEventSnapshot()
  const errorText = useErrorText()
  const ops = useJobOps()
  const [filter, setFilter] = useState<Filter>('all')

  const items = useMemo(() => jobs.data?.items ?? [], [jobs.data])
  const groups = useMemo(() => groupJobs(items), [items])
  const counts = useMemo(() => jobCounts(items), [items])
  const now = useNow(1000, counts.running > 0)
  const label = (n: number) => t('common.episodeN', { n })
  const render = (job: JobListItem) => (
    <TaskItem
      key={job.id}
      job={job}
      context={jobContext(job, projects.data?.items, label)}
      now={now}
      streamedChars={snapshot.streams[job.id]?.chars}
      busy={ops.busyId === job.id}
      onCancel={ops.cancel}
      onResume={ops.resume}
      onAcknowledge={ops.acknowledge}
      onRegenerate={ops.regenerate}
      onIgnoreResult={ops.ignoreResult}
    />
  )

  const order: JobGroup[] = ['attention', 'running', 'queued', 'recent']
  const visible = order.filter((g) => {
    if (filter === 'all') return true
    return g === filter
  })

  const empty = !jobs.isPending && items.length === 0

  return (
    <div
      className={embedded ? 'flex min-h-full flex-col' : 'flex min-h-0 flex-1 flex-col'}
      aria-label={t('jobs.title')}
    >
      <div
        className={`h-14 flex-none items-center gap-2 border-b border-border pr-3 pl-4 font-medium ${embedded ? 'hidden' : 'flex'}`}
      >
        <ListChecks {...iconProps} aria-hidden className="text-muted-foreground" />
        <span className="flex-1">{t('jobs.title')}</span>
        {onClose && (
          <IconButton label={t('jobs.collapse')} onClick={onClose}>
            <PanelRightClose {...iconProps} aria-hidden />
          </IconButton>
        )}
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)} className="flex-none px-3">
        <TabsList className="-mx-1 overflow-x-auto">
          <TabsTrigger value="all">{t('jobs.tabs.all')}</TabsTrigger>
          <TabsTrigger value="running" count={counts.running}>
            {t('jobs.tabs.running')}
          </TabsTrigger>
          <TabsTrigger value="queued" count={counts.queued}>
            {t('jobs.tabs.queued')}
          </TabsTrigger>
          <TabsTrigger
            value="attention"
            count={counts.attention}
            needsAttention={counts.attention > 0}
          >
            {t('jobs.tabs.attention')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className={embedded ? 'flex-1 p-3' : 'min-h-0 flex-1 overflow-y-auto p-3'}>
        {snapshot.workerError && (
          <Notice tone="danger" className="mb-3" title={t('jobs.workerError')}>
            {t('jobs.workerErrorBody')}
          </Notice>
        )}
        {ops.error !== undefined && (
          <Notice tone="danger" className="mb-3" role="alert">
            {errorText(ops.error)}
          </Notice>
        )}
        {jobs.isPending && (
          <div className="flex flex-col gap-2" aria-busy>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        )}
        {jobs.isError && (
          <Notice
            tone="danger"
            role="alert"
            actions={
              <Button size="sm" onClick={() => jobs.refetch()}>
                {t('common.retry')}
              </Button>
            }
          >
            {errorText(jobs.error)}
          </Notice>
        )}
        {empty && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">{t('jobs.empty')}</p>
        )}
        {visible.map((g) =>
          groups[g].length === 0 ? null : (
            <section key={g} className="[&+&]:mt-4" aria-label={t(`jobs.groups.${g}`)}>
              <h3 className="mx-1 mb-2 font-sans text-xs font-medium text-subtle">
                {t(`jobs.groups.${g}`)}
              </h3>
              <ul className="flex flex-col gap-2">{groups[g].map(render)}</ul>
            </section>
          ),
        )}
        {!empty && !jobs.isPending && visible.every((g) => groups[g].length === 0) && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            {t('jobs.emptyFilter')}
          </p>
        )}
      </div>

      <div className="flex-none border-t border-border px-4 py-3 text-xs text-subtle">
        {t('jobs.footer')}
      </div>
    </div>
  )
}
