import type { JobListItem } from '@dramai/api'

/**
 * Which jobs just finished and are worth a system notification: a job that was queued or running in the previous
 * snapshot and is now succeeded, or failed and waiting for the user. Jobs first seen already finished (the page just
 * loaded) never notify.
 */
export interface JobTransitions {
  done: JobListItem[]
  attention: JobListItem[]
}

export function jobTransitions(
  previous: ReadonlyMap<string, JobListItem['status']>,
  jobs: readonly JobListItem[],
): JobTransitions {
  const out: JobTransitions = { done: [], attention: [] }
  for (const j of jobs) {
    const before = previous.get(j.id)
    if (before !== 'queued' && before !== 'running') continue
    if (j.status === 'succeeded' && !j.resultIgnored) out.done.push(j)
    else if (j.status === 'failed' && j.needsAttention) out.attention.push(j)
  }
  return out
}

export const NOTIFY_KEY = 'dramai.desktop.notify'

/** The user's switch for desktop notifications (default on); read at the moment of notifying. */
export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIFY_KEY) !== '0'
  } catch {
    return true
  }
}
