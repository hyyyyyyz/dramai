import type { Episode, Material } from '@dramai/api'

/** 一集对应的原文章节范围（从 1 起，含两端）。章节按行号对上：集记的是行范围，章节有各自的起止行。 */
export function sourceChapterRange(
  episode: Pick<Episode, 'sourceRange'>,
  materials: readonly Pick<Material, 'id' | 'chapters'>[],
): { from: number; to: number } | undefined {
  const r = episode.sourceRange
  if (!r?.materialId || r.startLine === undefined || r.endLine === undefined) return undefined
  const m = materials.find((x) => x.id === r.materialId)
  if (!m) return undefined
  const hit = m.chapters.filter((c) => c.endLine >= r.startLine! && c.startLine <= r.endLine!)
  if (hit.length === 0) return undefined
  return { from: hit[0]!.index + 1, to: hit[hit.length - 1]!.index + 1 }
}

export type EpisodeStatusTone = 'neutral' | 'info' | 'accent' | 'success'
export function episodeStatusTone(status: Episode['status']): EpisodeStatusTone {
  switch (status) {
    case 'planned':
      return 'neutral'
    case 'storyboarding':
      return 'info'
    case 'producing':
      return 'accent'
    case 'composed':
    case 'exported':
      return 'success'
  }
}
