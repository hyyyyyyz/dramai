import {
  evaluateArtifacts,
  episodeProgress,
  loadProjection,
  orderedShotIds,
  currentVersion,
} from '@dramai/core'
import type { ArtifactReport, EpisodeProgress, Project, ProjectProjection } from '@dramai/core'
import type { ArtifactReport as ArtifactReportDto, ProjectListItem } from '@dramai/api'
import type { ServerContext } from '../context.ts'

/** 项目的只读视图：投影 + 产物评估 + 各集进度。评估失败（数据异常）时降级为不带过期信息的进度。 */
export interface ProjectView {
  projection: ProjectProjection
  reports: Map<string, ArtifactReport> | undefined
  progressOf(episodeId: string): EpisodeProgress
  /** 按播出顺序（先账本，后账本之外的）列出的集。 */
  episodesInOrder(): ProjectProjection['episodes'] extends Map<string, infer E> ? E[] : never
}

export async function loadProjectView(ctx: ServerContext, projectId: string): Promise<ProjectView> {
  const projection = await loadProjection(ctx.store, projectId)
  let reports: Map<string, ArtifactReport> | undefined
  try {
    reports = evaluateArtifacts(projection)
  } catch (err) {
    console.error('[views] evaluateArtifacts failed', projectId, err)
  }
  return {
    projection,
    reports,
    progressOf: (id) => episodeProgress(projection, id, reports),
    episodesInOrder: () => {
      const listed = projection.project.episodeOrder
        .map((id) => projection.episodes.get(id))
        .filter((e) => e !== undefined)
      const seen = new Set(listed.map((e) => e.id))
      const rest = [...projection.episodes.values()]
        .filter((e) => !seen.has(e.id))
        .sort((a, b) => a.number - b.number)
      return [...listed, ...rest]
    },
  }
}

export async function toProjectListItem(
  ctx: ServerContext,
  project: Project,
): Promise<ProjectListItem> {
  const view = await loadProjectView(ctx, project.id)
  const { projection } = view
  const shotIds = orderedShotIds(project, projection.episodes, projection.scenes)
  const shots = shotIds.map((id) => projection.shots.get(id)).filter((s) => s !== undefined)
  const thumbnails: ProjectListItem['thumbnails'] = []
  for (const shot of shots) {
    if (thumbnails.length >= 6) break
    const v = currentVersion(shot.image)
    if (v) thumbnails.push({ shotId: shot.id, versionId: v.id, path: v.file.path })
  }
  return {
    ...project,
    episodes: view.episodesInOrder().map((e) => ({
      id: e.id,
      number: e.number,
      title: e.title,
      status: e.status,
      progress: view.progressOf(e.id),
    })),
    shotCounts: {
      total: shots.length,
      withImage: shots.filter((s) => currentVersion(s.image)).length,
      withVideo: shots.filter((s) => currentVersion(s.video)).length,
      failed: shots.filter(
        (s) => s.failedStage !== undefined || Object.values(s.stages).includes('failed'),
      ).length,
    },
    thumbnails,
  }
}

export function toArtifactReports(
  view: ProjectView,
  filter?: (key: string) => boolean,
): ArtifactReportDto[] {
  const out: ArtifactReportDto[] = []
  for (const [key, r] of view.reports ?? []) {
    if (filter && !filter(key)) continue
    out.push({
      key: r.key,
      kind: r.kind,
      status: r.status,
      reason: r.reason,
      changes: r.changes,
      staleUpstream: r.staleUpstream,
      file: view.projection.artifacts.get(key)?.file,
    })
  }
  return out
}
