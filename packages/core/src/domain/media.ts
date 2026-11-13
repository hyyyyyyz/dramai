import type { FileRef, JobId, MediaFacts, VersionId } from './common.ts'
import { DomainError, notFoundError } from '../errors.ts'

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

/**
 * 视频版本生成时用了哪些参考图（只有开启参考图的视频版本才有）。
 *
 * 这是**记录**，不参与"是否过期"的判断：视频的依据摘要看不到任务参数，所以用参考图生成的视频，之后换了角色设定图
 * 不会被标成过期。把这份记录留在版本自己身上，是为了以后补上过期判断时有据可依
 * （比较这里记下的设定图版本 / 哈希和现在的当前设定图）。
 */
export interface UsedReferences {
  /**
   * 镜头图怎么处理的：`as_reference` 降为第 1 张参考图（放弃严格首帧）；`with_references` 首帧和参考图同发。
   */
  frame: 'as_reference' | 'with_references'
  /** 按发出的顺序；`frame` 为 `as_reference` 时第一项是镜头图（role `start_frame`）。 */
  references: Array<{
    role: 'start_frame' | 'character' | 'prop' | 'location' | 'costume' | 'style'
    assetId?: string
    assetName?: string
    variantName?: string
    /** 用的是哪个版本的设定图 / 镜头图。 */
    versionId?: string
    /** 文件的 sha256。 */
    sha256?: string
  }>
  /** 因超出模型上限被舍弃的参考图张数。 */
  trimmed: number
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
  /** 视频：开启参考图生成时，用了哪些参考图（见 `UsedReferences`）。 */
  usedReferences?: UsedReferences
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
    throw new DomainError('VERSION_EXISTS', `version id already exists: ${version.id}`)
  }
  return {
    currentVersionId: options.makeCurrent === false ? slot.currentVersionId : version.id,
    versions: [...slot.versions, version],
  }
}

/** 回滚/切换当前版本。版本必须存在。 */
export function setCurrentVersion(slot: MediaSlot, versionId: VersionId): MediaSlot {
  if (!slot.versions.some((v) => v.id === versionId)) {
    throw notFoundError('media_version', versionId, `unknown version: ${versionId}`)
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
