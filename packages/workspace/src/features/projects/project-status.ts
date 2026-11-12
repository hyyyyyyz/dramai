import type { ProjectListItem } from '@dramai/api'
import type { SegmentTone } from '@dramai/ui/v2'

export type ProjectStatus =
  | { kind: 'draft' }
  | { kind: 'allPlanned'; episodes: number }
  | { kind: 'exported' }
  | { kind: 'episode'; number: number; status: 'storyboarding' | 'producing' | 'composed' }

/** 项目卡的状态：从各集的状态里挑出“现在在做的那一集”。 */
export function projectStatus(p: Pick<ProjectListItem, 'episodes'>): ProjectStatus {
  const eps = p.episodes
  if (eps.length === 0) return { kind: 'draft' }
  if (eps.every((e) => e.status === 'exported')) return { kind: 'exported' }
  const active = eps.find((e) => e.status !== 'planned' && e.status !== 'exported')
  if (active)
    return {
      kind: 'episode',
      number: active.number,
      status: active.status as 'storyboarding' | 'producing' | 'composed',
    }
  return { kind: 'allPlanned', episodes: eps.length }
}

export type ProjectFilter = 'all' | 'active' | 'done'
export function matchesFilter(p: Pick<ProjectListItem, 'episodes'>, f: ProjectFilter): boolean {
  if (f === 'all') return true
  const s = projectStatus(p)
  if (f === 'done') return s.kind === 'exported'
  return s.kind === 'episode'
}

/** 每集一段的进度条。 */
export function episodeTone(status: ProjectListItem['episodes'][number]['status']): SegmentTone {
  switch (status) {
    case 'exported':
    case 'composed':
      return 'success'
    case 'producing':
      return 'accent'
    case 'storyboarding':
      return 'info'
    default:
      return 'none'
  }
}
