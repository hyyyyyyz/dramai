import { db } from '@/core/storage/db'
import type { Asset, Character, Generation, Material, Project, Storyboard } from '@/types/domain'

const FORMAT_TAG = 'dramai-backup'
const FORMAT_VERSION = 1

interface SerializedAsset extends Omit<Asset, 'blob'> {
  blobBase64: string
}

interface BackupPayload {
  format: typeof FORMAT_TAG
  version: number
  exportedAt: number
  /** 应用版本，便于将来排查不兼容的导出文件。 */
  appVersion: string
  projects: Project[]
  characters: Character[]
  materials: Material[]
  storyboards: Storyboard[]
  assets: SerializedAsset[]
  generations: Generation[]
}

interface ExportOptions {
  /** 仅导出指定 projectId（含其全部派生数据）。 */
  projectId?: string
  /** 应用版本（写进 backup 文件头）。 */
  appVersion?: string
}

/**
 * 把 IndexedDB 里的整个项目库（或指定项目）打包成单个 JSON Blob。
 * Blob 字段（图/视频）用 base64 编码进 JSON。
 */
export async function exportBackup(options: ExportOptions = {}): Promise<Blob> {
  const wantProject = options.projectId

  const filterByProject = <T extends { projectId: string }>(rows: T[]): T[] =>
    wantProject ? rows.filter((r) => r.projectId === wantProject) : rows

  const projects = wantProject
    ? await db.projects.where('id').equals(wantProject).toArray()
    : await db.projects.toArray()
  const characters = filterByProject(await db.characters.toArray())
  const materials = filterByProject(await db.materials.toArray())
  const storyboards = filterByProject(await db.storyboards.toArray())
  const assets = filterByProject(await db.assets.toArray())
  const generations = filterByProject(await db.generations.toArray())

  const serializedAssets: SerializedAsset[] = []
  for (const a of assets) {
    // 显式去掉 blob 字段，只保留可序列化的标量 + base64
    const { blob, ...rest } = a
    void blob
    serializedAssets.push({
      ...rest,
      blobBase64: await blobToBase64(a.blob),
    })
  }

  const payload: BackupPayload = {
    format: FORMAT_TAG,
    version: FORMAT_VERSION,
    exportedAt: Date.now(),
    appVersion: options.appVersion ?? 'unknown',
    projects,
    characters,
    materials,
    storyboards,
    assets: serializedAssets,
    generations,
  }

  const json = JSON.stringify(payload, null, 0)
  return new Blob([json], { type: 'application/json' })
}

export interface ImportSummary {
  projects: number
  characters: number
  materials: number
  storyboards: number
  assets: number
  generations: number
}

export interface ImportOptions {
  /** "merge" = 与现有数据并存；"replace" = 先清空再导入。 */
  mode: 'merge' | 'replace'
}

/**
 * 从 JSON 文件恢复数据。
 *
 * - "replace" 模式：清空现有所有表，再批量写入。
 * - "merge"   模式：用 put（id 冲突时覆盖单条）。
 */
export async function importBackup(file: File, options: ImportOptions): Promise<ImportSummary> {
  const text = await file.text()
  const payload = JSON.parse(text) as Partial<BackupPayload>
  if (payload.format !== FORMAT_TAG) {
    throw new Error('文件不是 dramai 备份（缺少 format=dramai-backup）')
  }
  if (typeof payload.version !== 'number' || payload.version > FORMAT_VERSION) {
    throw new Error(
      `备份版本 ${payload.version} 高于当前应用支持的最高版本 ${FORMAT_VERSION}，请升级 dramai 后再导入`,
    )
  }

  const reconstructedAssets: Asset[] = []
  for (const sa of payload.assets ?? []) {
    if (!sa.blobBase64) continue
    reconstructedAssets.push({
      ...(sa as Omit<SerializedAsset, 'blobBase64'>),
      blob: await base64ToBlob(sa.blobBase64, sa.mimeType),
    })
  }

  await db.transaction(
    'rw',
    [db.projects, db.characters, db.materials, db.storyboards, db.assets, db.generations],
    async () => {
      if (options.mode === 'replace') {
        await Promise.all([
          db.projects.clear(),
          db.characters.clear(),
          db.materials.clear(),
          db.storyboards.clear(),
          db.assets.clear(),
          db.generations.clear(),
        ])
      }
      if (payload.projects) await db.projects.bulkPut(payload.projects)
      if (payload.characters) await db.characters.bulkPut(payload.characters)
      if (payload.materials) await db.materials.bulkPut(payload.materials)
      if (payload.storyboards) await db.storyboards.bulkPut(payload.storyboards)
      if (reconstructedAssets.length > 0) await db.assets.bulkPut(reconstructedAssets)
      if (payload.generations) await db.generations.bulkPut(payload.generations)
    },
  )

  return {
    projects: payload.projects?.length ?? 0,
    characters: payload.characters?.length ?? 0,
    materials: payload.materials?.length ?? 0,
    storyboards: payload.storyboards?.length ?? 0,
    assets: reconstructedAssets.length,
    generations: payload.generations?.length ?? 0,
  }
}

export function makeBackupFilename(projectTitle?: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const slug = projectTitle
    ? projectTitle.replace(/[^\w一-龥]+/g, '-').replace(/^-+|-+$/g, '')
    : 'all'
  return `dramai-${slug || 'all'}-${date}.json`
}

/** 触发浏览器下载。 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 给浏览器一点时间真正发起下载，再 revoke
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...(chunk as unknown as number[]))
  }
  return btoa(binary)
}

async function base64ToBlob(b64: string, mimeType: string): Promise<Blob> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' })
}
