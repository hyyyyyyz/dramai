import { SCHEMA_VERSIONS } from '../domain/common.ts'
import type { FileRef, MediaFacts } from '../domain/common.ts'
import { currentVersion } from '../domain/media.ts'
import { blockingGaps, resolveInputs, targetId } from '../generation/inputs.ts'
import type { ResolvedInputs } from '../generation/inputs.ts'
import type { ProjectProjection } from '../generation/projection.ts'
import { digestOf } from '../util/canonical.ts'
import type {
  ArtifactExpectation,
  ArtifactKey,
  ArtifactRecord,
  ArtifactReport,
  ArtifactStatus,
  StaleChange,
  StaleReason,
} from './types.ts'
import { DomainError, notFoundError } from '../errors.ts'

/**
 * 产物时效（A18）。
 *
 * - 清单不存状态：状态 = 比对"当前投影出的期望依据"与清单条目。
 * - 依据只放会改变成品**内容**的输入。视觉产物不把服务商、凭证、模型、分辨率、seed、音轨开关放进依据：
 *   这些是"下一次怎么生成"的意图，改配置不该把已有画面集体判旧、逼出一轮重复付费。
 *   旁白音频相反：音色、语速、服务商进依据，因为它们决定用户听到的是谁在念。
 * - 上游变了只把下游标 stale，**不自动重生**；stale 的产物仍可下载和使用。
 */

export interface AudioSettings {
  provider: string
  model?: string
  voice: string
  speed?: number
  /** 只在设置了才出现（没设置时依据和以前逐字节相同）。 */
  instructions?: string
  language?: string
}

export interface ExpectationContext {
  /** 旁白音频的依据包含音色等设置。 */
  audio?: AudioSettings
}

/** 对项目里的每件"应当有产物"的对象，给出期望的依据。 */
export function buildExpectations(
  projection: ProjectProjection,
  context: ExpectationContext = {},
): Map<ArtifactKey, ArtifactExpectation> {
  const out = new Map<ArtifactKey, ArtifactExpectation>()
  // 旁白音色是项目级设置；调用方显式传入的 `context.audio` 优先（例如要带上模型名）。
  const nv = projection.project.narrationVoice
  const audioSettings: AudioSettings | undefined =
    context.audio ??
    (nv
      ? {
          provider: nv.providerConfigId,
          voice: nv.voice,
          speed: nv.speed,
          ...(nv.instructions ? { instructions: nv.instructions } : {}),
          ...(nv.language ? { language: nv.language } : {}),
        }
      : undefined)

  for (const asset of projection.assets.values()) {
    const sheetKey = `asset_sheet:${asset.id}`
    const sheetVersion = currentVersion(asset.sheet)
    const uploadedSheet = sheetVersion?.source === 'uploaded'
    out.set(sheetKey, {
      key: sheetKey,
      kind: 'asset_sheet',
      basis: {
        kind: asset.kind,
        name: asset.name,
        appearance: asset.appearance,
        styling: asset.styling,
        description: asset.description,
        style: styleBasis(projection),
        originals: asset.originals.map((o) => o.sha256),
      },
      upstream: [],
      requiredUpstream: [],
      uploaded: uploadedSheet,
    })
    for (const variant of asset.variants) {
      const key = `variant_sheet:${asset.id}/${variant.name}`
      const inputs = resolveInputs(projection, {
        kind: 'asset_sheet',
        assetId: asset.id,
        variantName: variant.name,
      })
      const costume = variant.costumeAssetId
        ? projection.assets.get(variant.costumeAssetId)
        : undefined
      const costumeKey =
        costume && costume.kind === 'costume' ? `asset_sheet:${costume.id}` : undefined
      out.set(key, {
        key,
        kind: 'variant_sheet',
        basis: {
          description: variant.description,
          // 实际送进编辑的指令（含并入的服装描述）才是改变成品内容的输入。
          instruction: inputs.prompt,
          style: styleBasis(projection),
        },
        // 由编辑生成的衍生依赖本体资产图（必需）与关联服装的资产图（可选）；作者上传的成品不随它们失效。
        upstream: variant.origin === 'edit' ? [sheetKey, ...(costumeKey ? [costumeKey] : [])] : [],
        requiredUpstream: variant.origin === 'edit' ? [sheetKey] : [],
        uploaded: variant.origin === 'upload',
        blockedBy: variant.origin === 'edit' ? structuralGaps(inputs) : undefined,
      })
    }
  }

  for (const shot of projection.shots.values()) {
    const imageInputs = resolveInputs(projection, { kind: 'shot_image', shotId: shot.id })
    const refKeys = imageInputs.references
      .filter((r) => r.assetId)
      .map((r) =>
        r.variantName ? `variant_sheet:${r.assetId}/${r.variantName}` : `asset_sheet:${r.assetId}`,
      )
    const imageKey = `shot_image:${shot.id}`
    out.set(imageKey, {
      key: imageKey,
      kind: 'shot_image',
      basis: {
        prompt: imageInputs.prompt,
        aspect: imageInputs.aspectRatio,
        style: styleBasis(projection),
        // 引用集合（含顺序）本身也是依据的一部分。
        refs: imageInputs.references.map((r) => ({
          assetId: r.assetId,
          variant: r.variantName,
          role: r.role,
        })),
      },
      upstream: refKeys,
      requiredUpstream: refKeys,
      blockedBy: structuralGaps(imageInputs),
      // 作者上传的分镜图：按图本身登记，不随描述 / 画风 / 设定图变化失效（和设定图一致）。
      uploaded: currentVersion(shot.image)?.source === 'uploaded',
    })

    const videoInputs = resolveInputs(projection, { kind: 'shot_video', shotId: shot.id })
    const videoKey = `shot_video:${shot.id}`
    out.set(videoKey, {
      key: videoKey,
      kind: 'shot_video',
      basis: {
        prompt: videoInputs.prompt,
        durationSec: videoInputs.durationSec,
        aspect: videoInputs.aspectRatio,
        movement: shot.movement,
      },
      upstream: [imageKey],
      requiredUpstream: [imageKey],
      blockedBy: structuralGaps(videoInputs),
    })

    if (shot.narration?.trim()) {
      const audioKey = `shot_audio:${shot.id}`
      out.set(audioKey, {
        key: audioKey,
        kind: 'shot_audio',
        basis: {
          text: shot.narration.trim(),
          // 旁白音频：音色/语速/服务商决定用户听到的是谁在念，进依据。
          audio: audioSettings,
        },
        upstream: [],
        requiredUpstream: [],
      })
    }
  }
  // 成片与字幕：依据是时间线最新修订的内容（A8：渲染开始时取快照；之后时间线又变了，产物如实判为过期）。
  for (const [episodeId, doc] of projection.timelines) {
    const head = doc.revisions[doc.revisions.length - 1]
    if (!head) continue
    const content = digestOf(head.content)
    const videoKeys = head.content.clips.map((c) => `shot_video:${c.shotId}`)
    const audioKeys = head.content.clips
      .filter((c) => c.carriesNarration && projection.shots.get(c.shotId)?.narration?.trim())
      .map((c) => `shot_audio:${c.shotId}`)
    const cutKey = `cut:${episodeId}`
    out.set(cutKey, {
      key: cutKey,
      kind: 'cut',
      basis: { content, aspect: projection.project.aspectRatio },
      upstream: [...videoKeys, ...audioKeys],
      requiredUpstream: videoKeys,
    })
    const subKey = `subtitles:${episodeId}`
    out.set(subKey, {
      key: subKey,
      kind: 'subtitles',
      basis: {
        content,
        texts: head.content.clips.map((c) => {
          const s = projection.shots.get(c.shotId)
          return { narration: s?.narration?.trim(), dialogue: s?.dialogue.map((d) => d.text) }
        }),
      },
      upstream: audioKeys,
      requiredUpstream: [],
    })
  }
  return out
}

export interface ArtifactDigest {
  basisDigest: string
  upstream: Record<ArtifactKey, string>
  upstreamVersions: Record<ArtifactKey, string>
  basisFields: Record<string, string>
}

/**
 * 计算（也是登记时使用）的依据摘要。`upstreamRecords` 取开始渲染那一刻的清单。
 * 缺失的非必需上游被略去。必需上游缺失时返回 undefined。
 */
export function computeDigest(
  expectation: ArtifactExpectation,
  upstreamRecords: ReadonlyMap<ArtifactKey, ArtifactRecord>,
): ArtifactDigest | undefined {
  const upstream: Record<ArtifactKey, string> = {}
  const upstreamVersions: Record<ArtifactKey, string> = {}
  for (const key of expectation.upstream) {
    const rec = upstreamRecords.get(key)
    if (!rec) {
      if (expectation.requiredUpstream.includes(key)) return undefined
      continue
    }
    upstream[key] = rec.contentHash
    if (rec.versionId) upstreamVersions[key] = rec.versionId
  }
  const basisDigest = digestOf({ basis: expectation.basis, upstream })
  return { basisDigest, upstream, upstreamVersions, basisFields: fieldDigests(expectation.basis) }
}

/** 用同一份期望登记一件产物。 */
export function buildRecord(input: {
  projectId: string
  expectation: ArtifactExpectation
  upstreamRecords: ReadonlyMap<ArtifactKey, ArtifactRecord>
  file: FileRef
  versionId?: string
  origin?: 'generated' | 'uploaded'
  facts?: MediaFacts
  now: number
}): ArtifactRecord {
  if (input.expectation.blockedBy && input.expectation.blockedBy.length > 0) {
    throw new DomainError(
      'ARTIFACT_INPUTS_BLOCKED',
      `cannot register ${input.expectation.key}: inputs are blocked (${input.expectation.blockedBy.join(', ')})`,
      { details: { key: input.expectation.key, blockedBy: input.expectation.blockedBy } },
    )
  }
  const digest = computeDigest(input.expectation, input.upstreamRecords)
  if (!digest) {
    throw new DomainError(
      'ARTIFACT_UPSTREAM_MISSING',
      `cannot register ${input.expectation.key}: required upstream is missing`,
      { details: { key: input.expectation.key } },
    )
  }
  return {
    schemaVersion: SCHEMA_VERSIONS.artifact,
    projectId: input.projectId,
    key: input.expectation.key,
    kind: input.expectation.kind,
    file: input.file,
    versionId: input.versionId,
    basisDigest: digest.basisDigest,
    contentHash: input.file.sha256,
    upstream: digest.upstream,
    upstreamVersions: digest.upstreamVersions,
    basisFields: digest.basisFields,
    origin: input.origin ?? 'generated',
    facts: input.facts,
    createdAt: input.now,
  }
}

/** 顶层字段各自的摘要；基础值（非对象）整体算作字段 `_`。 */
function fieldDigests(basis: unknown): Record<string, string> {
  if (basis && typeof basis === 'object' && !Array.isArray(basis)) {
    return Object.fromEntries(
      Object.entries(basis as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, digestOf(v)]),
    )
  }
  return { _: digestOf(basis) }
}

interface Evaluation {
  status: ArtifactStatus
  reason?: StaleReason
  changes: StaleChange[]
}

/** 与准入同源的"结构性"缺口：引用没登记、没资产图、没起始帧——此时无法评估也无法生成。 */
const STRUCTURAL = new Set([
  'ASSET_NOT_REGISTERED',
  'ASSET_SHEET_MISSING',
  'VARIANT_NOT_FOUND',
  'VARIANT_COSTUME_INVALID',
  'BASE_SHEET_MISSING',
  'START_FRAME_MISSING',
])

function structuralGaps(inputs: ResolvedInputs): string[] | undefined {
  const codes = blockingGaps(inputs)
    .map((g) => g.code)
    .filter((c) => STRUCTURAL.has(c))
  return codes.length > 0 ? codes : undefined
}

/** 画风依据：关键词；参考图画风再加上图片内容的哈希（换了参考图，已有的图就该判为过期）。 */
function styleBasis(projection: ProjectProjection): string {
  const style = projection.project.style
  return style.referenceFile
    ? `${style.imageKeywords}|ref:${style.referenceFile.sha256}`
    : style.imageKeywords
}

function evaluateOne(
  expectation: ArtifactExpectation,
  record: ArtifactRecord | undefined,
  records: ReadonlyMap<ArtifactKey, ArtifactRecord>,
  labelOf: (key: ArtifactKey) => string | undefined,
): Evaluation {
  if (expectation.uploaded) {
    return record
      ? { status: 'current', changes: [] }
      : { status: 'missing', reason: 'no_record', changes: [] }
  }
  if (expectation.blockedBy && expectation.blockedBy.length > 0) {
    return { status: 'blocked', reason: 'upstream_missing', changes: [] }
  }
  const digest = computeDigest(expectation, records)
  if (!digest) return { status: 'blocked', reason: 'upstream_missing', changes: [] }
  if (!record) return { status: 'missing', reason: 'no_record', changes: [] }
  if (record.basisDigest === digest.basisDigest) return { status: 'current', changes: [] }

  const changes: StaleChange[] = []
  for (const field of new Set([
    ...Object.keys(record.basisFields),
    ...Object.keys(digest.basisFields),
  ])) {
    if (record.basisFields[field] !== digest.basisFields[field])
      changes.push({ kind: 'input', field })
  }
  for (const key of new Set([...Object.keys(record.upstream), ...Object.keys(digest.upstream)])) {
    const was = record.upstream[key]
    const now = digest.upstream[key]
    if (was === now) continue
    changes.push({
      kind: 'upstream',
      key,
      label: labelOf(key),
      from:
        was === undefined ? null : { versionId: record.upstreamVersions[key], contentHash: was },
      to: now === undefined ? null : { versionId: digest.upstreamVersions[key], contentHash: now },
    })
  }
  const upstreamChanged = changes.some((c) => c.kind === 'upstream')
  return {
    status: 'stale',
    reason:
      upstreamChanged && !changes.some((c) => c.kind === 'input')
        ? 'upstream_changed'
        : 'basis_changed',
    changes,
  }
}

/**
 * 评估整个项目的产物状态。`staleUpstream` 列出直接上游里自身不是 current 的产物，
 * 用来提示"重生上游会让这件产物过期"，不改变本产物当前的状态。
 */
export function evaluateArtifacts(
  projection: ProjectProjection,
  context: ExpectationContext = {},
): Map<ArtifactKey, ArtifactReport> {
  const expectations = buildExpectations(projection, context)
  const records = projection.artifacts
  const evals = new Map<ArtifactKey, Evaluation>()
  const labelOf = (key: ArtifactKey) => artifactLabel(projection, key)
  for (const [key, exp] of expectations) {
    evals.set(key, evaluateOne(exp, records.get(key), records, labelOf))
  }
  const out = new Map<ArtifactKey, ArtifactReport>()
  for (const [key, exp] of expectations) {
    const ev = evals.get(key)!
    const staleUpstream = exp.upstream.filter((u) => {
      const s = evals.get(u)?.status
      return s !== undefined && s !== 'current'
    })
    out.set(key, {
      key,
      kind: exp.kind,
      status: ev.status,
      reason: ev.reason,
      changes: ev.changes,
      staleUpstream,
      ...(ev.status === 'current' && records.get(key)?.keptAt !== undefined
        ? { keptAt: records.get(key)!.keptAt }
        : {}),
    })
  }
  return out
}

/**
 * “保持现状”：用户看过过期提示，决定这件产物不用重新生成。把记录按**当前**的依据与上游重新对齐
 * （文件、版本不变），于是它显示为当前、不再提示；之后它的依据或上游再次变化，会照常重新过期。
 * 只对过期的产物有意义；下游不受影响（产物文件没变，下游看的是文件内容的哈希）。
 */
export function keepAsIs(
  projection: ProjectProjection,
  key: ArtifactKey,
  now: number,
): ArtifactRecord {
  const rec = projection.artifacts.get(key)
  const report = evaluateArtifacts(projection).get(key)
  const exp = buildExpectations(projection).get(key)
  if (!exp || !report) throw notFoundError('artifact', key)
  if (!rec || report.status !== 'stale') {
    throw new DomainError(
      'ARTIFACT_NOT_STALE',
      `artifact ${key} is ${report.status}, only a stale artifact can be kept as is`,
      { details: { key, status: report.status } },
    )
  }
  const fresh = buildRecord({
    projectId: rec.projectId,
    expectation: exp,
    upstreamRecords: projection.artifacts,
    file: rec.file,
    versionId: rec.versionId,
    origin: rec.origin,
    facts: rec.facts,
    now: rec.createdAt,
  })
  return { ...fresh, keptAt: now, keptFromDigest: rec.basisDigest }
}

/** 产物键 → 人话名称：资产名 / 变体名 / 镜头标题（没有标题时用“镜头 N”）。 */
export function artifactLabel(projection: ProjectProjection, key: ArtifactKey): string | undefined {
  const idx = key.indexOf(':')
  const kind = key.slice(0, idx)
  const owner = key.slice(idx + 1)
  if (kind === 'asset_sheet') return projection.assets.get(owner)?.name
  if (kind === 'variant_sheet') {
    const [assetId, variant] = owner.split('/')
    const asset = projection.assets.get(assetId)
    return asset ? `${asset.name}/${variant}` : undefined
  }
  if (kind === 'cut' || kind === 'subtitles') {
    const ep = projection.episodes.get(owner)
    return ep ? `第 ${ep.number} 集 ${ep.title}` : undefined
  }
  const shot = projection.shots.get(owner)
  if (shot) return shot.title || `镜头 ${shot.number}`
  return undefined
}

/** 某件产物的所有（传递）下游——用于"重生它会让哪些东西过期"。 */
export function downstreamOf(
  expectations: ReadonlyMap<ArtifactKey, ArtifactExpectation>,
  key: ArtifactKey,
): ArtifactKey[] {
  const out = new Set<ArtifactKey>()
  const visit = (k: ArtifactKey) => {
    for (const [other, exp] of expectations) {
      if (exp.upstream.includes(k) && !out.has(other)) {
        out.add(other)
        visit(other)
      }
    }
  }
  visit(key)
  return [...out]
}

export type { ResolvedInputs }
export { targetId }
