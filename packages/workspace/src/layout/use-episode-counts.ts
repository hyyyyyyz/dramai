import { useEpisodes } from '@/data/queries'

/** 当前集的镜头数（侧栏“分镜”旁边的数字）：来自集列表里的进度汇总，不需要再取镜头。 */
export function useProjectEpisodeCounts(
  projectId: string,
  episodeId: string | undefined,
): number | undefined {
  const episodes = useEpisodes(projectId)
  const ep = episodes.data?.items.find((e) => e.id === episodeId)
  return ep?.progress.split.shots
}
