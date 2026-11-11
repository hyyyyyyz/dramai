import type { ArtifactRecord } from '../artifacts/types.ts'
import type {
  Asset,
  EntityCandidate,
  Episode,
  Project,
  Scene,
  Shot,
  ShotAssetRef,
  ShotId,
} from '../domain/index.ts'
import type { Store } from '../ports/index.ts'

/**
 * 项目投影：把一个项目的当前状态一次性读成内存里的只读视图。
 * 准入检查、执行器、提示词预览、时效判定都在同一份投影上计算。
 */
export interface ProjectProjection {
  project: Project
  episodes: Map<string, Episode>
  scenes: Map<string, Scene>
  shots: Map<ShotId, Shot>
  /** 只含未删除的资产。引用到不在这里的 id = 未登记/已删除。 */
  assets: Map<string, Asset>
  refs: Map<ShotId, ShotAssetRef[]>
  artifacts: Map<string, ArtifactRecord>
  candidates: Map<string, EntityCandidate>
}

export async function loadProjection(store: Store, projectId: string): Promise<ProjectProjection> {
  const project = await store.projects.get(projectId)
  if (!project) throw new Error(`project not found: ${projectId}`)
  const [episodes, scenes, shots, assets, refs, artifacts, candidates] = await Promise.all([
    store.episodes.listByProject(projectId),
    store.scenes.listByProject(projectId),
    store.shots.listByProject(projectId),
    store.assets.listByProject(projectId),
    store.shotRefs.listByProject(projectId),
    store.artifacts.listByProject(projectId),
    store.candidates.listByProject(projectId),
  ])
  const refMap = new Map<ShotId, ShotAssetRef[]>()
  for (const r of refs) {
    const list = refMap.get(r.shotId) ?? []
    list.push(r)
    refMap.set(r.shotId, list)
  }
  return {
    project,
    episodes: new Map(episodes.map((e) => [e.id, e])),
    scenes: new Map(scenes.map((s) => [s.id, s])),
    shots: new Map(shots.map((s) => [s.id, s])),
    assets: new Map(assets.map((a) => [a.id, a])),
    refs: refMap,
    artifacts: new Map(artifacts.map((a) => [a.key, a])),
    candidates: new Map(candidates.map((c) => [c.id, c])),
  }
}
