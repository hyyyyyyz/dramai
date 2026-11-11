import { useContext, useSyncExternalStore } from 'react'
import { StoreContext } from './contexts'
import type { EventSnapshot } from './events'

/** 事件相关的瞬时状态：连接状态、文本任务的流式输出、worker 报错。 */
export function useEventSnapshot(): EventSnapshot {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useEventSnapshot 必须在 <EventSyncProvider> 内使用')
  return useSyncExternalStore(s.subscribe, s.getSnapshot)
}
