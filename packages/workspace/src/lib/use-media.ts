import { useSyncExternalStore } from 'react'

/** 响应式断点：≤1180 任务面板变抽屉，≤800 侧栏变底部标签栏（DESIGN 4.4）。 */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', fn)
      return () => mq.removeEventListener('change', fn)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
