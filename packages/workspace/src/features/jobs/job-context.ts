import type { JobListItem, ProjectListItem } from '@dramai/api'

export function jobContext(
  job: JobListItem,
  projects: readonly ProjectListItem[] | undefined,
  episodeLabel: (n: number) => string,
): string | undefined {
  const p = projects?.find((x) => x.id === job.projectId)
  if (!p) return undefined
  const ep = job.episodeId ? p.episodes.find((e) => e.id === job.episodeId) : undefined
  return ep ? `${p.name} · ${episodeLabel(ep.number)}` : p.name
}
