import { SCHEMA_VERSIONS } from './common.ts'
import type { AspectRatio } from './common.ts'
import { emptySlot } from './media.ts'
import type { Episode, Project, ProjectCounters, StyleSnapshot } from './project.ts'
import type { Scene, Shot } from './shot.ts'
import type { Asset, AssetKind } from './asset.ts'
import type { NarrationDelivery } from './voice.ts'

/**
 * 领域对象的构造函数。id 与时间由调用方传入（来自 IdGenerator / Clock 端口），
 * 这里保持纯函数。
 */

export const NO_STYLE = (now: number): StyleSnapshot => ({
  source: 'none',
  label: '未指定',
  description: '',
  imageKeywords: '',
  expandedAt: now,
})

export function createProject(input: {
  id: string
  name: string
  aspectRatio: AspectRatio
  now: number
  style?: StyleSnapshot
  summary?: string
  narrationDelivery?: NarrationDelivery
}): Project {
  return {
    schemaVersion: SCHEMA_VERSIONS.project,
    id: input.id,
    name: input.name,
    summary: input.summary,
    aspectRatio: input.aspectRatio,
    style: input.style ?? NO_STYLE(input.now),
    narrationDelivery: input.narrationDelivery ?? 'tts',
    episodeOrder: [],
    counters: { episode: 0, scene: 0, shot: 0, asset: 0 },
    createdAt: input.now,
    updatedAt: input.now,
  }
}

/** 发一个项目内单调、永不复用的编号。返回新项目与编号。 */
export function allocateNumber(
  project: Project,
  kind: keyof ProjectCounters,
): { project: Project; number: number } {
  const number = project.counters[kind] + 1
  return { project: { ...project, counters: { ...project.counters, [kind]: number } }, number }
}

export function createEpisode(input: {
  id: string
  projectId: string
  number: number
  title: string
  now: number
}): Episode {
  return {
    schemaVersion: SCHEMA_VERSIONS.episode,
    id: input.id,
    projectId: input.projectId,
    number: input.number,
    title: input.title,
    status: 'planned',
    sceneOrder: [],
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function createScene(input: {
  id: string
  projectId: string
  episodeId: string
  number: number
  now: number
  title?: string
}): Scene {
  return {
    schemaVersion: SCHEMA_VERSIONS.scene,
    id: input.id,
    projectId: input.projectId,
    episodeId: input.episodeId,
    number: input.number,
    title: input.title,
    shotOrder: [],
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function createShot(input: {
  id: string
  projectId: string
  sceneId: string
  number: number
  now: number
  title?: string
  scriptExcerpt?: string
  durationSec?: number
}): Shot {
  return {
    schemaVersion: SCHEMA_VERSIONS.shot,
    id: input.id,
    projectId: input.projectId,
    sceneId: input.sceneId,
    number: input.number,
    title: input.title ?? '',
    scriptExcerpt: input.scriptExcerpt ?? '',
    movement: 'static',
    durationSec: input.durationSec ?? 5,
    moodTags: [],
    dialogue: [],
    actionBeats: [],
    prompts: {},
    ready: false,
    stages: { image: 'pending', video: 'pending', audio: 'pending' },
    image: emptySlot(),
    video: emptySlot(),
    narrationAudio: emptySlot(),
    createdAt: input.now,
    updatedAt: input.now,
  }
}

export function createAsset(input: {
  id: string
  projectId: string
  number: number
  kind: AssetKind
  name: string
  now: number
  description?: string
}): Asset {
  return {
    schemaVersion: SCHEMA_VERSIONS.asset,
    id: input.id,
    projectId: input.projectId,
    number: input.number,
    kind: input.kind,
    name: input.name,
    aliases: [],
    description: input.description,
    sheet: emptySlot(),
    originals: [],
    variants: [],
    createdAt: input.now,
    updatedAt: input.now,
  }
}

/**
 * 成片顺序：项目分集账本 → 各集场序 → 各场镜序。
 * 缺失的引用（已删除）直接跳过。id 与 number 都不参与排序。
 */
export function orderedShotIds(
  project: Pick<Project, 'episodeOrder'>,
  episodes: ReadonlyMap<string, Pick<Episode, 'sceneOrder'>>,
  scenes: ReadonlyMap<string, Pick<Scene, 'shotOrder'>>,
): string[] {
  const out: string[] = []
  for (const eid of project.episodeOrder) {
    const ep = episodes.get(eid)
    if (!ep) continue
    for (const sid of ep.sceneOrder) {
      const sc = scenes.get(sid)
      if (!sc) continue
      out.push(...sc.shotOrder)
    }
  }
  return out
}
