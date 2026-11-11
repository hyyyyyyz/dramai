import { useMemo, type ReactNode } from 'react'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import type { DramaiClient } from '@dramai/api'
import { useTranslation } from 'react-i18next'
import { RouterProvider } from 'react-router/dom'
import { ToastProvider } from '@dramai/ui/v2'
import { ApiProvider } from '@/data/api-context'
import { EventSyncProvider } from '@/data/event-sync'
import { blockingKind } from '@/data/errors'
import { useSystem } from '@/data/queries'
import { BlockingScreen } from '@/features/common/BlockingScreen'
import { createQueryClient } from './query-client'
import { createAppRouter } from './router'

/** 先确认服务能用：连不上、需要令牌、Host 不允许时整屏提示，不让页面各自报一堆错。 */
function Gate({ children }: { children: ReactNode }) {
  const system = useSystem()
  const kind = system.isError ? blockingKind(system.error) : undefined
  if (kind) return <BlockingScreen kind={kind} onRetry={() => void system.refetch()} />
  return <>{children}</>
}

export function App({
  queryClient,
  client: api,
}: {
  queryClient?: QueryClient
  client?: DramaiClient
}) {
  const { t } = useTranslation()
  const client = useMemo(() => queryClient ?? createQueryClient(), [queryClient])
  const router = useMemo(() => createAppRouter(), [])
  return (
    <QueryClientProvider client={client}>
      <ApiProvider client={api}>
        <EventSyncProvider>
          <ToastProvider dismissLabel={t('common.close')} regionLabel={t('common.notifications')}>
            <Gate>
              <RouterProvider router={router} />
            </Gate>
          </ToastProvider>
        </EventSyncProvider>
      </ApiProvider>
    </QueryClientProvider>
  )
}
