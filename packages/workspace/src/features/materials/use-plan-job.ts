import { useEffect, useRef } from 'react'
import type { JobListItem } from '@dramai/api'
import { useJobs } from '@/data/queries'

/** 这个项目最近一次“分集规划”任务（任务面板里同一条）。 */
export function usePlanJob(projectId: string): JobListItem | undefined {
  const jobs = useJobs()
  const plans = (jobs.data?.items ?? []).filter(
    (j) => j.projectId === projectId && j.operation === 'episodes_plan',
  )
  return plans.sort((a, b) => b.createdAt - a.createdAt)[0]
}

/** 任务从进行中变成结束时回调一次（用来提示“已规划 N 集”）。 */
export function useOnJobFinished(job: JobListItem | undefined, cb: (job: JobListItem) => void) {
  const last = useRef<{ id?: string; status?: string }>({})
  useEffect(() => {
    if (!job) return
    const prev = last.current
    const wasActive = prev.id === job.id && (prev.status === 'running' || prev.status === 'queued')
    if (wasActive && (job.status === 'succeeded' || job.status === 'failed')) cb(job)
    last.current = { id: job.id, status: job.status }
  }, [job, cb])
}
