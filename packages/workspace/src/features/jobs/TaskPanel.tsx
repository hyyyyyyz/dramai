import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListChecks, PanelRightClose } from 'lucide-react'
import type { JobListItem } from '@dramai/api'
import {
  Button,
  IconButton,
  Modal,
  Notice,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  iconProps,
} from '@dramai/ui/v2'
import { useEventSnapshot } from '@/data/use-events'
import { isApiCode } from '@/data/errors'
import { useJobs, useProjects } from '@/data/queries'
import { useNow } from '@/lib/use-now'
import { useErrorText } from '@/features/common/use-error-text'
import { TaskItem } from './TaskItem'
import { jobContext } from './job-context'
import { groupJobs, jobActions, jobCounts, type JobGroup } from './job-model'
import { useJobActions } from './use-job-actions'

type Filter = 'all' | 'running' | 'queued' | 'attention'

/** 常驻任务面板（桌面是右侧栏，窄屏放进抽屉）。跨项目：所有任务都在这里。 */
export function TaskPanel({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const { t } = useTranslation()
  const jobs = useJobs()
  const projects = useProjects()
  const snapshot = useEventSnapshot()
  const errorText = useErrorText()
  const actions = useJobActions()
  const [filter, setFilter] = useState<Filter>('all')
  const [confirm, setConfirm] = useState<JobListItem | undefined>()
  const [actionError, setActionError] = useState<unknown>()

  const items = useMemo(() => jobs.data?.items ?? [], [jobs.data])
  const groups = useMemo(() => groupJobs(items), [items])
  const counts = useMemo(() => jobCounts(items), [items])
  const now = useNow(1000, counts.running > 0)
  const busyId = actions.cancel.isPending
    ? actions.cancel.variables?.params.jobId
    : actions.resume.isPending
      ? actions.resume.variables?.params.jobId
      : actions.retry.isPending
        ? actions.retry.variables?.params.jobId
        : actions.acknowledge.isPending
          ? actions.acknowledge.variables?.params.jobId
          : undefined

  const run = async (p: Promise<unknown>) => {
    setActionError(undefined)
    try {
      await p
    } catch (err) {
      setActionError(err)
    }
  }

  const regenerate = async (job: JobListItem, confirmed: boolean) => {
    setActionError(undefined)
    try {
      await actions.retry.mutateAsync({
        params: { jobId: job.id },
        body: confirmed ? { confirmRecharge: true } : {},
      })
      setConfirm(undefined)
    } catch (err) {
      // 服务端认为这次重新生成可能再次计费：按稳定的错误码弹出确认，而不是读文案
      if (!confirmed && isApiCode(err, 'CONFIRM_RECHARGE_REQUIRED')) setConfirm(job)
      else {
        setConfirm(undefined)
        setActionError(err)
      }
    }
  }

  const label = (n: number) => t('common.episodeN', { n })
  const render = (job: JobListItem) => (
    <TaskItem
      key={job.id}
      job={job}
      context={jobContext(job, projects.data?.items, label)}
      now={now}
      streamedChars={snapshot.streams[job.id]?.chars}
      busy={busyId === job.id}
      onCancel={(j) => run(actions.cancel.mutateAsync({ params: { jobId: j.id } }))}
      onResume={(j) => run(actions.resume.mutateAsync({ params: { jobId: j.id } }))}
      onAcknowledge={(j) => run(actions.acknowledge.mutateAsync({ params: { jobId: j.id } }))}
      onRegenerate={(j) => {
        // 可能再次计费：先让用户明确确认（服务端也会校验，见 regenerate 里的 CONFIRM_RECHARGE_REQUIRED）
        if (jobActions(j).regenerate === 'recharge') setConfirm(j)
        else void regenerate(j, false)
      }}
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
      className={
        embedded ? '-m-6 flex min-h-[calc(100%+3rem)] flex-col' : 'flex min-h-0 flex-1 flex-col'
      }
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
        {actionError !== undefined && (
          <Notice tone="danger" className="mb-3" role="alert">
            {errorText(actionError)}
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

      <Modal
        open={confirm !== undefined}
        onClose={() => setConfirm(undefined)}
        dismissOnBackdrop={false}
        size="sm"
        title={t('jobs.confirm.title')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger-solid"
              loading={actions.retry.isPending}
              onClick={() => confirm && regenerate(confirm, true)}
            >
              {t('jobs.confirm.action')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>
            {confirm?.error?.category === 'submission_unknown'
              ? t('jobs.confirm.bodyUnknown')
              : t('jobs.confirm.bodyUpstream')}
          </p>
          {confirm?.error?.recoverable && (
            <p className="text-muted-foreground">{t('jobs.confirm.preferResume')}</p>
          )}
        </div>
      </Modal>
    </div>
  )
}
