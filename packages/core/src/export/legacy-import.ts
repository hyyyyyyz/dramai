import { buildRecord, buildExpectations } from '../artifacts/staleness.ts'
import {
  createAsset,
  createEpisode,
  createProject,
  createScene,
  createShot,
} from '../domain/factories.ts'
import { appendVersion, emptySlot, versionFilePath } from '../domain/media.ts'
import type { MediaSlot, MediaVersion } from '../domain/media.ts'
import type { Asset } from '../domain/asset.ts'
import {
  CAMERA_MOVEMENTS,
  type CameraMovement,
  type Shot,
  type ShotAssetRef,
} from '../domain/shot.ts'
import type { FileRef } from '../domain/common.ts'
import type { Material } from '../domain/material.ts'
import { SCHEMA_VERSIONS } from '../domain/common.ts'
import { loadProjection } from '../generation/projection.ts'
import { countChars, detectChapters, normalizeText } from '../parsers/chapters.ts'
import { readImageSize } from '../parsers/image-size.ts'
import { expandStyle } from '../prompts/styles.ts'
import type { PipelineDeps } from '../pipeline/deps.ts'
import { refreshEpisodeStatus } from '../pipeline/compose.ts'
import { safeFileName } from '../util/fs.ts'
import { parseJsonText } from '../util/text.ts'

/**
 * 导入 v0.4 的 JSON 备份（`format: "dramai-backup"`，版本 1）。
 *
 * 旧版的数据是一个项目一串扁平的镜头（最多 12 个）。导入时落进新的层级：
 *   项目 → 第 1 集「第一集」→ 第 1 场「导入的镜头」→ 按 sequence 排序的镜头。
 *
 * 映射要点（也是和旧版语义不同的地方）：
 * - 画幅：旧版没有画幅概念，合成写死 1280×720，所以导入为 `16:9`。
 * - 旁白交付：旧版没有配音，旁白是留给用户去剪映里配的，所以导入为 `post`（后期配音）。
 * - 风格：旧版是一段自由文本，命中预设名就借用预设的关键词，否则保留为自定义文本。
 * - 角色：→ 角色资产。旧版“锁定参考图”的角色，参考图作为**用户上传的设定图**（uploaded，不随描述变化失效）；
 *   没锁定的参考图只是原图（不能顶替设定图）。
 * - 镜头图 / 视频：→ 版本历史的第 1 个版本；文件可用的正式产物一律补录为 current（A18），
 *   只有“依据确实算不出”的（例如引用了没有设定图的角色的镜头图）不登记。
 * - 丢弃：`generations`（从未写入过）、`pendingVideoTask`（上游任务早已过期）；数量记在摘要里。
 * 导入永远是新建，不会改动已有项目；同一个旧项目重复导入默认会被跳过。
 */

export const LEGACY_FORMAT = 'dramai-backup'
export const LEGACY_MAX_VERSION = 1

export class LegacyImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LegacyImportError'
  }
}

interface LegacyProject {
  id: string
  title: string
  summary?: string
  style?: string
  createdAt: number
  updatedAt?: number
}
interface LegacyCharacter {
  id: string
  projectId: string
  name: string
  description?: string
  role?: string
  referenceAssetId?: string
  locked?: boolean
  createdAt?: number
}
interface LegacyMaterial {
  id: string
  projectId: string
  kind: 'doc' | 'txt' | 'md' | 'image'
  name: string
  text?: string
  assetId?: string
  createdAt?: number
}
interface LegacyStoryboard {
  id: string
  projectId: string
  sequence: number
  sceneText: string
  narration?: string
  imagePrompt?: string
  characterIds?: string[]
  durationSec?: number
  imageAssetId?: string
  videoAssetId?: string
  cameraParams?: { movement?: string; speed?: string }
  pendingVideoTask?: unknown
  status?: string
}
interface LegacyAsset {
  id: string
  projectId: string
  kind: string
  mimeType: string
  width?: number
  height?: number
  createdAt?: number
  blobBase64?: string
}
export interface LegacyBackup {
  format: string
  version: number
  exportedAt?: number
  appVersion?: string
  projects: LegacyProject[]
  characters: LegacyCharacter[]
  materials: LegacyMaterial[]
  storyboards: LegacyStoryboard[]
  assets: LegacyAsset[]
  generations: unknown[]
}

export function parseLegacyBackup(text: string): LegacyBackup {
  let json: Partial<LegacyBackup>
  try {
    json = parseJsonText(text) as Partial<LegacyBackup>
  } catch {
    throw new LegacyImportError('文件不是合法的 JSON')
  }
  if (json.format !== LEGACY_FORMAT)
    throw new LegacyImportError('文件不是 dramai 备份（缺少 format=dramai-backup）')
  if (typeof json.version !== 'number' || json.version > LEGACY_MAX_VERSION) {
    throw new LegacyImportError(`备份版本 ${json.version} 高于支持的最高版本 ${LEGACY_MAX_VERSION}`)
  }
  return {
    format: json.format,
    version: json.version,
    exportedAt: json.exportedAt,
    appVersion: json.appVersion,
    projects: json.projects ?? [],
    characters: json.characters ?? [],
    materials: json.materials ?? [],
    storyboards: json.storyboards ?? [],
    assets: json.assets ?? [],
    generations: json.generations ?? [],
  }
}

export interface LegacyImportSummary {
  projects: Array<{
    legacyId: string
    projectId: string
    name: string
    episodes: number
    shots: number
    assets: number
    materials: number
    images: number
    videos: number
    artifactsRegistered: number
    /** 没能登记为 current 的镜头图 / 视频数（依据算不出）。 */
    artifactsSkipped: number
  }>
  skipped: Array<{ legacyId: string; reason: 'ALREADY_IMPORTED' }>
  droppedGenerations: number
  droppedPendingVideoTasks: number
}

const decodeB64 = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}
const extOf = (mime: string, fb: string) => EXT[mime.split(';')[0].trim().toLowerCase()] ?? fb

export async function importLegacyBackup(
  deps: PipelineDeps,
  input: string | LegacyBackup,
  options: { projectIds?: string[]; allowDuplicate?: boolean } = {},
): Promise<LegacyImportSummary> {
  const backup = typeof input === 'string' ? parseLegacyBackup(input) : input
  const summary: LegacyImportSummary = {
    projects: [],
    skipped: [],
    droppedGenerations: backup.generations.length,
    droppedPendingVideoTasks: backup.storyboards.filter((s) => s.pendingVideoTask).length,
  }
  const existing = await deps.store.projects.list({ includeDeleted: true })
  const wanted = backup.projects.filter(
    (p) => !options.projectIds || options.projectIds.includes(p.id),
  )
  const assetsById = new Map(backup.assets.map((a) => [a.id, a]))

  for (const lp of wanted) {
    if (
      !options.allowDuplicate &&
      existing.some((p) => p.importedFrom?.legacyProjectId === lp.id)
    ) {
      summary.skipped.push({ legacyId: lp.id, reason: 'ALREADY_IMPORTED' })
      continue
    }
    const now = deps.clock.now()
    const style = lp.style?.trim()
      ? expandStyle(deps.catalog.styles, { source: 'custom', description: lp.style }, now)
      : expandStyle(deps.catalog.styles, { source: 'none' }, now)
    let project = {
      ...createProject({
        id: deps.ids.next('proj'),
        name: lp.title || '导入的项目',
        summary: lp.summary,
        aspectRatio: '16:9',
        narrationDelivery: 'post',
        style,
        now: lp.createdAt ?? now,
      }),
      importedFrom: {
        format: LEGACY_FORMAT as 'dramai-backup',
        version: backup.version,
        legacyProjectId: lp.id,
      },
    }
    const pid = project.id
    const counters = { ...project.counters }
    const nextNum = (k: keyof typeof counters) => ++counters[k]

    // --- 素材 ---
    const materials: Material[] = []
    for (const lm of backup.materials.filter((m) => m.projectId === lp.id)) {
      const mid = deps.ids.next('mat')
      let file: FileRef | undefined
      let size: Material['size']
      const blob = lm.assetId ? assetsById.get(lm.assetId) : undefined
      if (blob?.blobBase64) {
        const bytes = decodeB64(blob.blobBase64)
        const path = `materials/${mid}/${safeFileName(lm.name)}`
        const info = await deps.files.put(pid, path, bytes)
        file = { path, mime: blob.mimeType, bytes: info.bytes, sha256: info.sha256 }
        const dims = readImageSize(bytes)
        if (dims) size = { width: dims.width, height: dims.height }
      }
      const text = lm.kind === 'image' ? '' : normalizeText(lm.text ?? '')
      materials.push({
        schemaVersion: SCHEMA_VERSIONS.material,
        id: mid,
        projectId: pid,
        number: nextNum('material'),
        kind: lm.kind,
        name: lm.name,
        text,
        charCount: countChars(text),
        chapters: detectChapters(text),
        file,
        size,
        createdAt: lm.createdAt ?? now,
      })
    }

    // --- 角色 → 资产 ---
    const assets: Asset[] = []
    const assetOfCharacter = new Map<string, Asset>()
    const usedNames = new Set<string>()
    const characters = backup.characters
      .filter((c) => c.projectId === lp.id)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    for (const c of characters) {
      let name = c.name.trim().replace(/\//g, '／') || '未命名角色'
      let n = 2
      while (usedNames.has(name)) name = `${c.name.trim()} (${n++})`
      usedNames.add(name)
      let asset: Asset = {
        ...createAsset({
          id: deps.ids.next('asset'),
          projectId: pid,
          number: nextNum('asset'),
          kind: 'character',
          name,
          now: c.createdAt ?? now,
        }),
        appearance: c.description?.trim() || undefined,
      }
      const ref = c.referenceAssetId ? assetsById.get(c.referenceAssetId) : undefined
      if (ref?.blobBase64) {
        const bytes = decodeB64(ref.blobBase64)
        const verId = deps.ids.next('ver')
        const path = versionFilePath({
          dir: 'images',
          ownerKey: asset.id,
          versionId: verId,
          ext: extOf(ref.mimeType, 'png'),
        })
        const info = await deps.files.put(pid, path, bytes)
        const file: FileRef = { path, mime: ref.mimeType, bytes: info.bytes, sha256: info.sha256 }
        const dims = readImageSize(bytes)
        if (c.locked) {
          asset = {
            ...asset,
            sheet: appendVersion(emptySlot(), {
              id: verId,
              kind: 'image',
              file,
              source: 'uploaded',
              createdAt: now,
              facts: dims ? { width: dims.width, height: dims.height } : undefined,
            }),
          }
        } else {
          asset = { ...asset, originals: [file] }
        }
      }
      assets.push(asset)
      assetOfCharacter.set(c.id, asset)
    }

    // --- 层级：第 1 集 / 第 1 场 / 镜头 ---
    const episode = createEpisode({
      id: deps.ids.next('ep'),
      projectId: pid,
      number: nextNum('episode'),
      title: '第一集',
      now,
    })
    const scene = createScene({
      id: deps.ids.next('scene'),
      projectId: pid,
      episodeId: episode.id,
      number: nextNum('scene'),
      now,
      title: '导入的镜头',
    })
    const legacyShots = backup.storyboards
      .filter((s) => s.projectId === lp.id)
      .sort((a, b) => a.sequence - b.sequence)
    const shots: Shot[] = []
    const refs: ShotAssetRef[] = []
    let images = 0
    let videos = 0
    for (const ls of legacyShots) {
      const base = createShot({
        id: deps.ids.next('shot'),
        projectId: pid,
        sceneId: scene.id,
        number: nextNum('shot'),
        now,
        title: `镜头 ${ls.sequence}`,
        scriptExcerpt: ls.sceneText,
        durationSec: ls.durationSec && ls.durationSec > 0 ? ls.durationSec : 5,
      })
      const mv = (CAMERA_MOVEMENTS as readonly string[]).includes(ls.cameraParams?.movement ?? '')
        ? (ls.cameraParams!.movement as CameraMovement)
        : 'static'
      let image: MediaSlot = emptySlot()
      let video: MediaSlot = emptySlot()
      const mk = async (
        assetId: string | undefined,
        kind: 'image' | 'video',
      ): Promise<MediaSlot | undefined> => {
        const a = assetId ? assetsById.get(assetId) : undefined
        if (!a?.blobBase64) return undefined
        const bytes = decodeB64(a.blobBase64)
        const verId = deps.ids.next('ver')
        const path = versionFilePath({
          dir: kind === 'image' ? 'images' : 'videos',
          ownerKey: base.id,
          versionId: verId,
          ext: extOf(a.mimeType, kind === 'image' ? 'png' : 'mp4'),
        })
        const info = await deps.files.put(pid, path, bytes)
        const dims = kind === 'image' ? readImageSize(bytes) : undefined
        const version: MediaVersion = {
          id: verId,
          kind,
          file: { path, mime: a.mimeType, bytes: info.bytes, sha256: info.sha256 },
          source: 'generated',
          createdAt: a.createdAt ?? now,
          prompt: kind === 'image' ? ls.imagePrompt : undefined,
          facts: dims
            ? { width: dims.width, height: dims.height }
            : a.width && a.height
              ? { width: a.width, height: a.height }
              : undefined,
        }
        return appendVersion(emptySlot(), version)
      }
      image = (await mk(ls.imageAssetId, 'image')) ?? image
      video = (await mk(ls.videoAssetId, 'video')) ?? video
      if (image.currentVersionId) images++
      if (video.currentVersionId) videos++
      const failed = ls.status === 'failed'
      shots.push({
        ...base,
        movement: mv,
        narration: ls.narration?.trim() || undefined,
        prompts: { keyFrame: ls.imagePrompt, firstFrame: ls.imagePrompt },
        ready: true,
        image,
        video,
        stages: {
          image: image.currentVersionId ? 'succeeded' : failed ? 'failed' : 'pending',
          video: video.currentVersionId ? 'succeeded' : 'pending',
          audio: 'pending',
        },
        failedStage:
          failed && !video.currentVersionId
            ? image.currentVersionId
              ? 'video'
              : 'image'
            : undefined,
      })
      for (const cid of ls.characterIds ?? []) {
        const a = assetOfCharacter.get(cid)
        if (a && !refs.some((r) => r.shotId === base.id && r.assetId === a.id))
          refs.push({ shotId: base.id, assetId: a.id })
      }
    }
    scene.shotOrder = shots.map((s) => s.id)
    episode.sceneOrder = [scene.id]
    project = { ...project, episodeOrder: [episode.id], counters, updatedAt: lp.updatedAt ?? now }

    await deps.store.transaction(async (tx) => {
      await tx.projects.put(project)
      for (const m of materials) await tx.materials.put(m)
      for (const a of assets) await tx.assets.put(a)
      await tx.episodes.put(episode)
      await tx.scenes.put(scene)
      for (const s of shots) {
        await tx.shots.put(s)
        await tx.shotRefs.replaceForShot(
          s.id,
          refs.filter((r) => r.shotId === s.id),
        )
      }
    })

    // --- 产物清单补录：文件可用的一律 current；依据算不出的不登记 ---
    let registered = 0
    let skipped = 0
    const register = async (key: string) => {
      const projection = await loadProjection(deps.store, pid)
      const exp = buildExpectations(projection).get(key)
      if (!exp) return false
      const [kind, owner] = key.split(':') as [string, string]
      const file =
        kind === 'asset_sheet'
          ? currentFile(projection.assets.get(owner)?.sheet)
          : kind === 'shot_image'
            ? currentFile(projection.shots.get(owner)?.image)
            : currentFile(projection.shots.get(owner)?.video)
      if (!file) return false
      try {
        await deps.store.artifacts.put(
          buildRecord({
            projectId: pid,
            expectation: exp,
            upstreamRecords: projection.artifacts,
            file: file.file,
            versionId: file.versionId,
            origin: kind === 'asset_sheet' ? 'uploaded' : 'generated',
            now: deps.clock.now(),
          }),
        )
        return true
      } catch {
        return false
      }
    }
    for (const a of assets)
      if (a.sheet.currentVersionId && (await register(`asset_sheet:${a.id}`))) registered++
    for (const s of shots) {
      if (s.image.currentVersionId) {
        if (await register(`shot_image:${s.id}`)) registered++
        else skipped++
      }
    }
    for (const s of shots) {
      if (s.video.currentVersionId) {
        if (await register(`shot_video:${s.id}`)) registered++
        else skipped++
      }
    }
    await refreshEpisodeStatus(deps, episode)
    summary.projects.push({
      legacyId: lp.id,
      projectId: pid,
      name: project.name,
      episodes: 1,
      shots: shots.length,
      assets: assets.length,
      materials: materials.length,
      images,
      videos,
      artifactsRegistered: registered,
      artifactsSkipped: skipped,
    })
    deps.events?.emit({ type: 'project.changed', projectId: pid })
  }
  return summary
}

function currentFile(
  slot: MediaSlot | undefined,
): { file: FileRef; versionId: string } | undefined {
  const v = slot?.versions.find((x) => x.id === slot.currentVersionId)
  return v ? { file: v.file, versionId: v.id } : undefined
}
