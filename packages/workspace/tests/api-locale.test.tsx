import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiLocaleOf } from '@/data/api-locale'
import { ApiProvider } from '@/data/api-context'
import { useProviders } from '@/data/queries'
import { setLocale } from '@/i18n'
import { useLocale } from './render'

describe('the language sent to the server', () => {
  it('maps the interface language to what the server understands', () => {
    expect(apiLocaleOf('zh-CN')).toBe('zh')
    expect(apiLocaleOf('zh-TW')).toBe('zh-Hant')
    expect(apiLocaleOf('en')).toBe('en')
    expect(apiLocaleOf('en-US')).toBe('en')
  })
})

describe('switching the interface language refetches what the server translates', () => {
  const seen: string[] = []
  beforeEach(async () => {
    seen.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const locale =
          (init?.headers as Record<string, string> | undefined)?.['X-Dramai-Locale'] ?? ''
        seen.push(locale)
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Locale-Echo': locale },
        })
      }),
    )
    await useLocale('zh-CN')
  })
  afterEach(() => vi.unstubAllGlobals())

  function Probe() {
    const q = useProviders()
    return <div data-testid="state">{q.isFetching ? 'fetching' : 'idle'}</div>
  }

  it('simplified → traditional → english: each switch asks again, in the new language', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <ApiProvider>
          <Probe />
        </ApiProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(seen).toEqual(['zh']))
    await act(async () => void (await setLocale('zh-TW')))
    await waitFor(() => expect(seen).toEqual(['zh', 'zh-Hant']))
    await act(async () => void (await setLocale('en')))
    await waitFor(() => expect(seen).toEqual(['zh', 'zh-Hant', 'en']))
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('idle'))
  })
})
