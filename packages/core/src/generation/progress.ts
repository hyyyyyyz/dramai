import type { ArtifactReport } from '../artifacts/types.ts'
import { candidateProgress } from '../domain/asset.ts'
import type { CandidateProgress } from '../domain/asset.ts'
import { currentVersion } from '../domain/media.ts'
import type { EpisodeStatus } from '../domain/project.ts'
import type { ProjectProjection } from './projection.ts'
import { notFoundError } from '../errors.ts'

/**
 * 集的进度汇总：**算出来的，不单独存**。
 * 概览页的集列表、“下一步”清单都从这里取数。
 */
export interface StepCount {
  total: number
  done: number
  /** 已有产物但被判为过期的数量（需要 `reports` 才有值）。 */
  stale?: number
}

export interface EpisodeProgress {
  episodeId: string
  /** 拆分：场与镜头的数量。 */
  split: { scenes: number; shots: number; shotsReady: number }
  /** 候选：本集镜头涉及的候选。 */
  candidates: CandidateProgress
  /** 设定图：本集镜头用到的资产里，已有设定图的数量。 */
  sheets: StepCount
  /** 分镜图：本集镜头里，已有当前图的数量。 */
  images: StepCount
  /** 视频：本集镜头里，已有当前视频的数量。 */
  videos: StepCount
  /** 合成：是否已有成片（清单里有 `cut:<episodeId>`）。 */
  composition: { done: boolean; stale?: boolean }
}

export function episodeProgress(
  projection: ProjectProjection,
  episodeId: string,
  reports?: ReadonlyMap<string, ArtifactReport>,
): EpisodeProgress {
  const episode = projection.episodes.get(episodeId)
  if (!episode) throw notFoundError('episode', episodeId)

  const scenes = episode.sceneOrder
    .map((id) => projection.scenes.get(id))
    .filter((s) => s !== undefined)
  const shotIds = scenes.flatMap((s) => s.shotOrder)
  const shots = shotIds.map((id) => projection.shots.get(id)).filter((s) => s !== undefined)
  const shotSet = new Set(shotIds)

  const assetIds = new Set<string>()
  for (const shot of shots) {
    for (const ref of projection.refs.get(shot.id) ?? []) assetIds.add(ref.assetId)
  }
  const usedAssets = [...assetIds]
    .map((id) => projection.assets.get(id))
    .filter((a) => a !== undefined)

  const staleCount = (keys: string[]) =>
    reports ? keys.filter((k) => reports.get(k)?.status === 'stale').length : undefined

  const imageKeys = shots.filter((s) => currentVersion(s.image)).map((s) => `shot_image:${s.id}`)
  const videoKeys = shots.filter((s) => currentVersion(s.video)).map((s) => `shot_video:${s.id}`)
  const sheetKeys = usedAssets
    .filter((a) => currentVersion(a.sheet))
    .map((a) => `asset_sheet:${a.id}`)

  const cutKey = `cut:${episodeId}`
  return {
    episodeId,
    split: {
      scenes: scenes.length,
      shots: shots.length,
      shotsReady: shots.filter((s) => s.ready).length,
    },
    candidates: candidateProgress(
      [...projection.candidates.values()].filter((c) =>
        c.shotIds.some((id: string) => shotSet.has(id)),
      ),
    ),
    sheets: { total: usedAssets.length, done: sheetKeys.length, stale: staleCount(sheetKeys) },
    images: { total: shots.length, done: imageKeys.length, stale: staleCount(imageKeys) },
    videos: { total: shots.length, done: videoKeys.length, stale: staleCount(videoKeys) },
    composition: {
      done: projection.artifacts.has(cutKey),
      stale: reports?.has(cutKey) ? reports.get(cutKey)!.status === 'stale' : undefined,
    },
  }
}

/** 按现状应处的状态。`exported` 无法从数据推出，由调用方（导出动作）告知。 */
export function deriveEpisodeStatus(
  progress: EpisodeProgress,
  options: { exported?: boolean } = {},
): EpisodeStatus {
  if (progress.split.shots === 0) return 'planned'
  if (options.exported && progress.composition.done) return 'exported'
  if (progress.composition.done) return 'composed'
  if (progress.split.shotsReady < progress.split.shots) return 'storyboarding'
  return 'producing'
}
