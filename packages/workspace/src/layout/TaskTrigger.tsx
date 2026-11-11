import { useTranslation } from 'react-i18next'
import { ListChecks } from 'lucide-react'
import { Button, iconProps } from '@dramai/ui/v2'
import { useJobs } from '@/data/queries'
import { jobCounts } from '@/features/jobs/job-model'

/** 顶栏按钮：显示进行中数量和需处理数量；面板收起时也看得到需处理（红色）。 */
export function TaskTrigger({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useTranslation()
  const jobs = useJobs()
  const counts = jobCounts(jobs.data?.items ?? [])
  const active = counts.running + counts.queued
  return (
    <Button
      size="sm"
      variant="secondary"
      aria-label={t('jobs.title')}
      aria-expanded={open}
      onClick={onToggle}
      className="gap-2"
    >
      <ListChecks {...iconProps} aria-hidden />
      <span className="max-[800px]:hidden">{t('jobs.title')}</span>
      {active > 0 && (
        <span className="font-mono text-xs">{t('jobs.triggerRunning', { n: active })}</span>
      )}
      {counts.attention > 0 && (
        <span className="font-mono text-xs text-danger">
          {t('jobs.triggerAttention', { n: counts.attention })}
        </span>
      )}
    </Button>
  )
}
