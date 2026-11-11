import { useJobs } from '@/data/queries'

/** 正在排队或运行的文本步骤，键是 `<operation>:<episodeId>`：概览里的按钮据此显示“进行中”，避免重复点。 */
export function useActiveOps(projectId: string): Set<string> {
  const jobs = useJobs()
  const out = new Set<string>()
  for (const j of jobs.data?.items ?? []) {
    if (j.projectId === projectId && (j.status === 'queued' || j.status === 'running'))
      out.add(`${j.operation}:${j.episodeId ?? ''}`)
  }
  return out
}
