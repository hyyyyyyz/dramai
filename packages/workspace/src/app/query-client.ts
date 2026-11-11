import { QueryClient } from '@tanstack/react-query'
import { shouldRetry } from '@/data/errors'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 事件（SSE）负责让缓存失效；这里的 staleTime 只是断线时的兜底
        staleTime: 15_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
    },
  })
}
