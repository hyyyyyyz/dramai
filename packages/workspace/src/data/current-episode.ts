import { useCallback, useSyncExternalStore } from 'react'
import { useEpisodes } from './queries'

/**
 * “当前集”：侧栏的集切换器和概览的“下一步”都围着它转。记在 localStorage（按项目），
 * 没记过或那一集已不存在时，取第一个还没导出的集，再不行取第一集。
 */
const key = (projectId: string) => `dramai.episode.${projectId}`
const listeners = new Set<() => void>()

function read(projectId: string): string | undefined {
  try {
    return localStorage.getItem(key(projectId)) ?? undefined
  } catch {
    return undefined
  }
}

export function pickCurrentEpisode<T extends { id: string; status: string }>(
  episodes: readonly T[],
  saved: string | undefined,
): T | undefined {
  return (
    episodes.find((e) => e.id === saved) ??
    episodes.find((e) => e.status !== 'exported') ??
    episodes[0]
  )
}

export function useCurrentEpisode(projectId: string) {
  const query = useEpisodes(projectId)
  const saved = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => read(projectId),
  )
  const episodes = query.data?.items
  const current = episodes ? pickCurrentEpisode(episodes, saved) : undefined
  const select = useCallback(
    (episodeId: string) => {
      try {
        localStorage.setItem(key(projectId), episodeId)
      } catch {
        /* 存储不可用：本次不记 */
      }
      for (const fn of listeners) fn()
    },
    [projectId],
  )
  return { current, episodes, select, isPending: query.isPending }
}
