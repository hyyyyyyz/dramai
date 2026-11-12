import { createContext, useContext } from 'react'
import type { JobListItem } from '@dramai/api'

/** 任务的四个操作，任务面板和分镜页的镜头卡共用同一套（同一个确认弹窗、同一份进行中状态）。 */
export interface JobOps {
  cancel: (job: JobListItem) => void
  /** 恢复原任务：续上已有的上游任务，不重新提交。 */
  resume: (job: JobListItem) => void
  /** 重新生成；可能再次计费时先弹出明确的确认。 */
  regenerate: (job: JobListItem) => void
  acknowledge: (job: JobListItem) => void
  /** 忽略（或取消忽略）运行中付费任务的结果：照常跑完、照常计费，但不自动成为当前版本。 */
  ignoreResult: (job: JobListItem, ignore: boolean) => void
  /** 正在提交操作的任务（防重复点击）。 */
  busyId: string | undefined
  /** 最近一次操作被服务端拒绝的错误（按错误码显示）。 */
  error: unknown
  clearError: () => void
}

export const JobOpsContext = createContext<JobOps | null>(null)

export function useJobOps(): JobOps {
  const ctx = useContext(JobOpsContext)
  if (!ctx) throw new Error('useJobOps 必须在 <JobOpsProvider> 内使用')
  return ctx
}
