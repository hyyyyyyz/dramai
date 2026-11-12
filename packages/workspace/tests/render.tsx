import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { DramaiClient } from '@dramai/api'
import { ToastProvider } from '@dramai/ui/v2'
import { ApiProvider } from '@/data/api-context'
import { EventSyncProvider } from '@/data/event-sync'
import { JobOpsProvider } from '@/features/jobs/JobOpsProvider'
import { i18n, initI18n, setLocale, type Locale } from '@/i18n'

let ready: Promise<unknown> | undefined
export async function useLocale(locale: Locale = 'zh-CN') {
  ready ??= initI18n(locale)
  await ready
  await setLocale(locale)
  return i18n
}

export function renderApp(ui: ReactElement, opts: { client: DramaiClient; route?: string }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={opts.client}>
        <EventSyncProvider>
          <ToastProvider
            dismissLabel={i18n.t('common.close')}
            regionLabel={i18n.t('common.notifications')}
          >
            <JobOpsProvider>
              <MemoryRouter initialEntries={[opts.route ?? '/']}>{ui}</MemoryRouter>
            </JobOpsProvider>
          </ToastProvider>
        </EventSyncProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { ...view, queryClient }
}
