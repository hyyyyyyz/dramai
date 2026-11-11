import type { FileRef, MediaFacts, ProjectId } from '../domain/common.ts'

/**
 * 产物清单（A18）。每件正式产物登记一条记录：身份键、落盘文件、生成依据摘要、文件自身的内容事实。
 * **不存状态**——状态在读取时由"当前项目投影出的期望依据"与清单条目比对得出。
 */
export type ArtifactKind =
  | 'asset_sheet'
  | 'variant_sheet'
  | 'shot_image'
  | 'shot_video'
  | 'shot_audio'
  | 'subtitles'
  | 'cut'

/** `${kind}:${ownerId}`，变体为 `variant_sheet:${assetId}/${variantName}`。 */
export type ArtifactKey = string

export interface ArtifactRecord {
  schemaVersion: number
  projectId: ProjectId
  key: ArtifactKey
  kind: ArtifactKind
  file: FileRef
  /** 版本 id（若产物对应某个媒体版本）。 */
  versionId?: string
  /** 规范化 JSON（键排序）的 sha256：直接消费的内容 + 直接上游产物的内容哈希。 */
  basisDigest: string
  /** 文件自身内容的哈希（= file.sha256）。下游把它当作"上游产物的身份"。 */
  contentHash: string
  /** 生成时所依据的直接上游产物的 contentHash（键 → 哈希）。用来区分"自身变了"还是"上游变了"。 */
  upstream: Record<ArtifactKey, string>
  /** 同上，各上游当时对应的版本 id（若有）。用来说明“从哪个版本到哪个版本”。 */
  upstreamVersions: Record<ArtifactKey, string>
  /** 依据里每个顶层字段各自的摘要。用来说明“是哪个输入变了”。 */
  basisFields: Record<string, string>
  /** 作者上传的成品：按图本身登记，不随描述/画风变化失效。 */
  origin: 'generated' | 'uploaded'
  facts?: MediaFacts
  createdAt: number
}

/** current：依据一致；stale：依据变了；missing：期望存在但没有记录；blocked：缺必需的上游，无法评估。 */
export type ArtifactStatus = 'current' | 'stale' | 'missing' | 'blocked'

export type StaleReason =
  | 'basis_changed'
  | 'upstream_changed'
  | 'no_record'
  | 'upstream_missing'
  | 'not_applicable'

/** 过期的具体原因之一。 */
export type StaleChange =
  | {
      /** 产物自己直接消费的某个输入变了（如 prompt、画幅、风格）。 */
      kind: 'input'
      field: string
    }
  | {
      /** 某个直接上游产物变了、新增或移除。 */
      kind: 'upstream'
      key: ArtifactKey
      /** 上游产物的人话名称（资产名 / 镜头标题 / 变体名），查不到则缺省。 */
      label?: string
      /** 生成时依据的上游状态；null = 当时没有依赖它（新增了依赖）。 */
      from: { versionId?: string; contentHash: string } | null
      /** 现在的上游状态；null = 现在不再依赖它（或它已没有记录）。 */
      to: { versionId?: string; contentHash: string } | null
    }

export interface ArtifactReport {
  key: ArtifactKey
  kind: ArtifactKind
  status: ArtifactStatus
  reason?: StaleReason
  /** status = stale 时：具体是哪些输入 / 哪个上游从什么变成了什么。其余状态为空。 */
  changes: StaleChange[]
  /** 直接上游产物里自身不是 current 的那些——"将受影响"的提示，不改变本产物的状态。 */
  staleUpstream: ArtifactKey[]
}

export interface ArtifactExpectation {
  key: ArtifactKey
  kind: ArtifactKind
  /** 期望的依据（会被规范化后取哈希）。 */
  basis: unknown
  /** 直接上游产物键。其 contentHash 会并入依据。 */
  upstream: ArtifactKey[]
  /** 上游里哪些是必需的（缺失 → blocked）。其余缺失只是略去。 */
  requiredUpstream: ArtifactKey[]
  /** 作者上传的成品：忽略 basis 和上游，只看图本身。 */
  uploaded?: boolean
  /** 输入有阻断性缺口（与准入检查同一份 `resolveInputs` 的结论）→ 状态为 blocked。 */
  blockedBy?: string[]
}
