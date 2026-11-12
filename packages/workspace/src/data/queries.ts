import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query'
import type { CallInput, CallOutput, GenerateItem, RouteName } from '@dramai/api'
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

export function useEpisode(episodeId: string) {
  const api = useApi()
  return useQuery({
    queryKey: qk.episode(episodeId),
    queryFn: () => api.call('episodes.get', { params: { episodeId } }),
  })
}

/** 项目里所有集的详情（候选、资产详情里要把镜头 id 翻成“第几集 · 镜头几号”）。 */
export function useEpisodeDetails(episodeIds: string[]) {
  const api = useApi()
  return useQueries({
    queries: episodeIds.map((episodeId) => ({
      queryKey: qk.episode(episodeId),
      queryFn: () => api.call('episodes.get', { params: { episodeId } }),
    })),
  })
}

/** 一集的产物清单：每个镜头图 / 视频的状态（最新 / 已过期 / 缺失 / 被拦下）和过期原因。 */
export function useEpisodeArtifacts(episodeId: string) {
  const api = useApi()
  return useQuery({
    queryKey: qk.episodeArtifacts(episodeId),
    queryFn: () => api.call('episodes.artifacts', { params: { episodeId } }),
  })
}

/** 项目级产物清单：资产设定图 / 衍生形态设定图是否最新、是否过期。 */
export function useProjectArtifacts(projectId: string) {
  const api = useApi()
  return useQuery({
    queryKey: [...qk.artifacts, 'project', projectId],
    queryFn: () => api.call('projects.artifacts', { params: { projectId } }),
  })
}

export function useAsset(assetId: string) {
  const api = useApi()
  return useQuery({
    queryKey: qk.asset(assetId),
    queryFn: () => api.call('assets.get', { params: { assetId } }),
  })
}

/**
 * 只读预检：不创建任务，不花钱。镜头卡据此在点“生成”之前就显示“不能生成”和原因，
 * 批量确认弹窗据此显示哪些能跑、哪些被拦、预估费用。请求里最多 500 项。
 */
export function usePreflight(
  projectId: string,
  items: GenerateItem[],
  options: { confirmUnverified?: boolean; enabled?: boolean } = {},
) {
  const api = useApi()
  return useQuery({
    queryKey: [...qk.preflight, projectId, items, options.confirmUnverified ?? false],
    queryFn: () =>
      api.call('generate.preflight', {
        params: { projectId },
        body: { items, ...(options.confirmUnverified ? { confirmUnverified: true } : {}) },
      }),
    enabled: (options.enabled ?? true) && items.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
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
