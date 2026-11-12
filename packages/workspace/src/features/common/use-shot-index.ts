import { useMemo } from 'react'
import { useEpisodeDetails, useEpisodes } from '@/data/queries'
import { groupScenes } from '@/features/storyboard/shot-model'

export interface ShotInfo {
  shotId: string
  episodeId: string
  episodeNumber: number
  episodeTitle: string
  /** 在这一集里是第几个镜头（播出顺序，从 1 起）。 */
  index: number
}

/**
 * 项目里所有镜头的“第几集 · 第几个镜头”，以及每个资产被哪些镜头引用。
 * 候选、资产库、资产详情都要把镜头 id 翻成人看得懂的位置；数据来自各集的详情。
 */
export function useShotIndex(projectId: string) {
  const episodes = useEpisodes(projectId)
  const items = useMemo(() => episodes.data?.items ?? [], [episodes.data])
  const details = useEpisodeDetails(items.map((e) => e.id))
  const stamp = details.map((d) => d.dataUpdatedAt).join(',')
  return useMemo(() => {
    const shots = new Map<string, ShotInfo>()
    const usedBy = new Map<string, string[]>()
    for (const d of details) {
      if (!d.data) continue
      const ep = d.data.episode
      for (const g of groupScenes(d.data))
        for (const { shot, index } of g.shots)
          shots.set(shot.id, {
            shotId: shot.id,
            episodeId: ep.id,
            episodeNumber: ep.number,
            episodeTitle: ep.title,
            index,
          })
      for (const r of d.data.refs)
        usedBy.set(r.assetId, [...(usedBy.get(r.assetId) ?? []), r.shotId])
    }
    return { shots, usedBy, isPending: episodes.isPending || details.some((d) => d.isPending) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, episodes.isPending])
}
