import { useMemo } from 'react'
import { useQueries, keepPreviousData } from '@tanstack/react-query'
import type { Verdict } from '@dramai/api'
import { useApi } from '@/data/use-api'
import { qk } from '@/data/keys'
import { PREFLIGHT_MAX, preflightItems } from './shot-model'

/**
 * 一集所有镜头的只读预检（不创建任务、不花钱）：每个镜头的出图和出视频各问一次。
 * 每项的“被拦下”是它自己的问题；“被整批拦下”只是同批里别人的问题，不算它的。
 * 超过 500 项就分块请求。
 */
export function useEpisodeVerdicts(projectId: string, shotIds: readonly string[]) {
  const api = useApi()
  const items = useMemo(() => preflightItems(shotIds), [shotIds])
  const chunks = useMemo(() => {
    const out: (typeof items)[] = []
    for (let i = 0; i < items.length; i += PREFLIGHT_MAX)
      out.push(items.slice(i, i + PREFLIGHT_MAX))
    return out
  }, [items])
  const results = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: [...qk.preflight, projectId, 'episode', chunk],
      queryFn: () =>
        api.call('generate.preflight', { params: { projectId }, body: { items: chunk } }),
      placeholderData: keepPreviousData,
      staleTime: 5_000,
    })),
  })
  const stamp = results.map((r) => r.dataUpdatedAt).join(',')
  const verdicts = useMemo(() => {
    const map = new Map<string, Verdict>()
    for (const r of results) for (const v of r.data?.results ?? []) map.set(v.targetId, v)
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp])
  return {
    verdicts,
    isPending: results.length > 0 && results.every((r) => r.isPending),
    error: results.find((r) => r.error)?.error,
  }
}
