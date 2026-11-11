import type { FileRef, JobId, MediaFacts, VersionId } from './common.ts'

/**
 * 生成物版本历史（A7）。
 *
 * 重新生成永远追加版本，不覆盖旧文件；`currentVersionId` 是当前指针，可回滚。
 * 历史版本文件不可变（路径含版本号）。这里的函数都是纯函数，返回新对象。
 */

export type MediaKind = 'image' | 'video' | 'audio'

/** 版本来源。`image_edit` 的 `prompt` 记的是编辑指令。 */
export type VersionSource = 'generated' | 'uploaded' | 'image_edit'

export interface ProviderSnapshot {
  /** 提交时用的服务商配置 id；用于重启后按原配置恢复轮询。 */
  providerConfigId?: string
  protocol: string
  baseUrl: string
  model: string
}

export interface MediaVersion {
  id: VersionId
  kind: MediaKind
  file: FileRef
  source: VersionSource
  createdAt: number
  /** 产生这个版本的任务（上传的没有）。 */
  jobId?: JobId
  prompt?: string
  provider?: ProviderSnapshot
  facts?: MediaFacts
  /** 记录生成时是否带原声（视频）。时间线预览据此决定静音与否。 */
  withNativeAudio?: boolean
  /** 生成依据摘要（A18）：登记产物时的 basis digest。 */
  basisDigest?: string
}

export interface MediaSlot {
  currentVersionId: VersionId | null
  /** 追加式，按创建先后排列。 */
  versions: MediaVersion[]
}

export function emptySlot(): MediaSlot {
  return { currentVersionId: null, versions: [] }
}

export function currentVersion(slot: MediaSlot): MediaVersion | undefined {
  if (slot.currentVersionId === null) return undefined
  return slot.versions.find((v) => v.id === slot.currentVersionId)
}

/** 追加一个版本。默认设为当前；旧版本原样保留。版本 id 重复是程序错误。 */
export function appendVersion(
  slot: MediaSlot,
  version: MediaVersion,
  options: { makeCurrent?: boolean } = {},
): MediaSlot {
  if (slot.versions.some((v) => v.id === version.id)) {
    throw new Error(`version id already exists: ${version.id}`)
  }
  return {
    currentVersionId: options.makeCurrent === false ? slot.currentVersionId : version.id,
    versions: [...slot.versions, version],
  }
}

/** 回滚/切换当前版本。版本必须存在。 */
export function setCurrentVersion(slot: MediaSlot, versionId: VersionId): MediaSlot {
  if (!slot.versions.some((v) => v.id === versionId)) {
    throw new Error(`unknown version: ${versionId}`)
  }
  return { ...slot, currentVersionId: versionId }
}

/** 版本文件的存放路径。路径含版本号，因此旧版本永不被覆盖。 */
export function versionFilePath(parts: {
  dir: 'images' | 'videos' | 'audio'
  ownerKey: string
  versionId: VersionId
  ext: string
}): string {
  const ext = parts.ext.replace(/^\./, '')
  return `${parts.dir}/${parts.ownerKey}/${parts.versionId}.${ext}`
}
