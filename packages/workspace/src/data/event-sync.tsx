import { useEffect, useMemo, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApi } from './use-api'
import { StoreContext } from './contexts'
import { EventStore, startEventSync } from './events'

/** 整个应用只有一条 SSE：这里建立连接，并把瞬时状态（连接状态、流式文本）放进 Context。 */
export function EventSyncProvider({
  store,
  children,
}: {
  store?: EventStore
  children: ReactNode
}) {
  const client = useApi()
  const queryClient = useQueryClient()
  const value = useMemo(() => store ?? new EventStore(), [store])
  useEffect(() => {
    const sync = startEventSync(client, { queryClient, store: value })
    return () => sync.close()
  }, [client, queryClient, value])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
