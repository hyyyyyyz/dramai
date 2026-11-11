import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query'
import type { CallInput, CallOutput, RouteName } from '@dramai/api'
import { useApi } from './use-api'
import { qk } from './keys'

/** 读：每个接口一个 hook，键在 keys.ts。事件（events.ts）负责失效，这里不做轮询。 */

export function useSystem() {
  const api = useApi()
  return useQuery({ queryKey: qk.system, queryFn: () => api.call('system.get'), staleTime: 60_000 })
}

export function useSettings() {
  const api = useApi()
  return useQuery({ queryKey: qk.settings, queryFn: () => api.call('settings.get') })
}

export function useStyles() {
  const api = useApi()
  return useQuery({
    queryKey: qk.styles,
    queryFn: () => api.call('styles.list'),
    staleTime: Infinity,
  })
}

export function usePresets() {
  const api = useApi()
  return useQuery({
    queryKey: qk.presets,
    queryFn: () => api.call('presets.list'),
    staleTime: Infinity,
  })
}

export function useProviders() {
  const api = useApi()
  return useQuery({ queryKey: qk.providers, queryFn: () => api.call('providers.list') })
}

export function useProviderCapability(providerId: string, enabled = true) {
  const api = useApi()
  return useQuery({
    queryKey: qk.providerCapability(providerId),
    queryFn: () => api.call('providers.capability', { params: { providerId } }),
    enabled,
  })
}

export function useProjects() {
  const api = useApi()
  return useQuery({ queryKey: qk.projects, queryFn: () => api.call('projects.list') })
}

export function useProject(projectId: string) {
  const api = useApi()
  return useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.call('projects.get', { params: { projectId } }),
  })
}

export function useEpisodes(projectId: string) {
  const api = useApi()
  return useQuery({
    queryKey: qk.episodes(projectId),
    queryFn: () => api.call('episodes.list', { params: { projectId } }),
  })
}

export function useMaterials(projectId: string) {
  const api = useApi()
  return useQuery({
    queryKey: qk.materials(projectId),
    queryFn: () => api.call('materials.list', { params: { projectId } }),
  })
}

export function useAssets(projectId: string) {
  const api = useApi()
  return useQuery({
    queryKey: qk.assets(projectId),
    queryFn: () => api.call('assets.list', { params: { projectId } }),
  })
}

export function useCandidates(projectId: string) {
  const api = useApi()
  return useQuery({
    queryKey: qk.candidates(projectId),
    queryFn: () => api.call('candidates.list', { params: { projectId } }),
  })
}

/** 任务列表：最近 200 条，新的在前。事件直接改写这份缓存。 */
export function useJobs() {
  const api = useApi()
  return useQuery({
    queryKey: qk.jobs,
    queryFn: () => api.call('jobs.list', { query: { limit: 200 } }),
  })
}

/**
 * 写：对应一个接口的 mutation。成功后立即失效 `invalidate` 里的查询（事件稍后还会再通知一次，两者不冲突）。
 * 业务错误（ApiError）原样抛给调用处，由调用处按 code 处理（见 errors.ts）。
 */
export function useCall<N extends RouteName>(
  name: N,
  options: {
    invalidate?: (readonly unknown[])[]
  } & Omit<UseMutationOptions<CallOutput<N>, unknown, CallInput<N>>, 'mutationFn'> = {},
) {
  const api = useApi()
  const queryClient = useQueryClient()
  const { invalidate, onSuccess, ...rest } = options
  return useMutation<CallOutput<N>, unknown, CallInput<N>>({
    ...rest,
    mutationFn: (input) => api.call(name, ...([input] as never)),
    onSuccess: async (data, vars, ctx, meta) => {
      await Promise.all(
        (invalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      )
      return onSuccess?.(data, vars, ctx, meta)
    },
  })
}
