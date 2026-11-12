import type { Asset, Candidate } from '@dramai/api'

export const KIND_ORDER = ['character', 'location', 'prop', 'costume'] as const

export interface CandidateGroup {
  kind: Candidate['kind']
  items: Candidate[]
}

/** 待处理的候选按类别分组（角色 / 地点 / 道具 / 服装），组内高置信度在前。 */
export function groupPending(items: readonly Candidate[]): CandidateGroup[] {
  const rank = { high: 0, medium: 1, low: 2 } as const
  return KIND_ORDER.map((kind) => ({
    kind,
    items: items
      .filter((c) => c.status === 'pending' && c.kind === kind)
      .sort(
        (a, b) => rank[a.confidenceBand] - rank[b.confidenceBand] || a.name.localeCompare(b.name),
      ),
  })).filter((g) => g.items.length > 0)
}

/** 关联建议：服务端给的疑似同一个的已有资产（必须同类别且还在）。 */
export function suggestionOf(c: Candidate, assets: ReadonlyMap<string, Asset>) {
  const s = c.suggestedMatch
  const asset = s ? assets.get(s.assetId) : undefined
  return s && asset && asset.kind === c.kind ? { asset, basis: s.basis, score: s.score } : undefined
}

/** 可以“关联到已有”的资产：同类别。 */
export const linkable = (c: Candidate, assets: readonly Asset[]) =>
  assets.filter((a) => a.kind === c.kind)

/** 首次出现：按播出顺序最靠前的镜头。 */
export function firstShot<T extends { episodeNumber: number; index: number }>(
  infos: readonly T[],
): T | undefined {
  return [...infos].sort((a, b) => a.episodeNumber - b.episodeNumber || a.index - b.index)[0]
}
