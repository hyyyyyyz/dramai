import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobListItem } from '@dramai/api'
import { Button, Modal } from '@dramai/ui/v2'
import { isApiCode } from '@/data/errors'
import { JobOpsContext, type JobOps } from './job-ops-context'
import { jobActions } from './job-model'
import { useJobActions } from './use-job-actions'

/**
 * 任务操作的唯一入口。语义（见 job-model.ts）：
 * - 可能再次计费的“重新生成”先弹出明确确认，确认后才带 `confirmRecharge: true` 发出；
 * - 服务端若认为需要确认（CONFIRM_RECHARGE_REQUIRED，按错误码判断），同样弹出确认；
 * - “恢复原任务”永远是另一个独立的操作。
 */
export function JobOpsProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const actions = useJobActions()
  const [confirm, setConfirm] = useState<JobListItem | undefined>()
  const [error, setError] = useState<unknown>()

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
    setError(undefined)
    try {
      await p
    } catch (err) {
      setError(err)
    }
  }

  const retry = async (job: JobListItem, confirmed: boolean) => {
    setError(undefined)
    try {
      await actions.retry.mutateAsync({
        params: { jobId: job.id },
        body: confirmed ? { confirmRecharge: true } : {},
      })
      setConfirm(undefined)
    } catch (err) {
      if (!confirmed && isApiCode(err, 'CONFIRM_RECHARGE_REQUIRED')) setConfirm(job)
      else {
        setConfirm(undefined)
        setError(err)
      }
    }
  }

  const ops: JobOps = useMemo(
    () => ({
      cancel: (j) => void run(actions.cancel.mutateAsync({ params: { jobId: j.id } })),
      resume: (j) => void run(actions.resume.mutateAsync({ params: { jobId: j.id } })),
      acknowledge: (j) => void run(actions.acknowledge.mutateAsync({ params: { jobId: j.id } })),
      regenerate: (j) => {
        if (jobActions(j).regenerate === 'recharge') setConfirm(j)
        else void retry(j, false)
      },
      busyId,
      error,
      clearError: () => setError(undefined),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyId, error, actions.cancel, actions.resume, actions.acknowledge, actions.retry],
  )

  return (
    <JobOpsContext.Provider value={ops}>
      {children}
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
              onClick={() => confirm && void retry(confirm, true)}
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
    </JobOpsContext.Provider>
  )
}
