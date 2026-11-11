import type {
  Asset,
  AssetVariant,
  AspectRatio,
  FileRef,
  MediaVersion,
  Shot,
} from '../domain/index.ts'
import { currentVersion, effectiveAspect } from '../domain/index.ts'
import { extractMentions } from '../prompts/mentions.ts'
import type { StyleSnapshot } from '../domain/project.ts'
import type { ProjectProjection } from './projection.ts'

/**
 * "这次生成将会用到的输入"——**唯一**的计算入口（A2）。
 *
 * 准入检查、执行器、提示词预览、时效判定都调用 `resolveInputs`，
 * 这样不会出现"准入说没问题、执行器却静默丢图、时效又因同一缺口得出相反结论"。
 *
 * 纯函数，不读文件系统；"文件读不读得到"由准入/执行器另行检查（见 admission）。
 */

export type GenerationTarget =
  | { kind: 'asset_sheet'; assetId: string; variantName?: string }
  | { kind: 'shot_image'; shotId: string }
  | { kind: 'shot_video'; shotId: string }
  | { kind: 'shot_audio'; shotId: string }

export function targetId(target: GenerationTarget): string {
  switch (target.kind) {
    case 'asset_sheet':
      return target.variantName
        ? `asset_sheet:${target.assetId}/${target.variantName}`
        : `asset_sheet:${target.assetId}`
    default:
      return `${target.kind}:${target.shotId}`
  }
}

/** 产物清单里的键：变体设定图是 `variant_sheet:`，其余与 `targetId` 相同。 */
export function artifactKeyOf(target: GenerationTarget): string {
  return target.kind === 'asset_sheet' && target.variantName
    ? `variant_sheet:${target.assetId}/${target.variantName}`
    : targetId(target)
}

export type GapCode =
  | 'TARGET_NOT_FOUND'
  | 'ASSET_NOT_REGISTERED'
  | 'ASSET_SHEET_MISSING'
  | 'VARIANT_NOT_FOUND'
  | 'VARIANT_COSTUME_INVALID'
  | 'BASE_SHEET_MISSING'
  | 'START_FRAME_MISSING'
  | 'NARRATION_EMPTY'
  | 'PROMPT_EMPTY'
  | 'FILE_UNREADABLE'
  | 'ORIGINAL_UNREADABLE'
  | 'REFS_TRIMMED'
  | 'OPTIONAL_INPUT_OMITTED'

export interface Gap {
  code: GapCode
  /** block：作者声明的输入有缺口，花钱前必须拦下；omit：系统推导的可选输入，略去；warn：照常进行但要告知。 */
  severity: 'block' | 'omit' | 'warn'
  message: string
  assetId?: string
  path?: string
}

export type ReferenceRole = 'start_frame' | 'character' | 'prop' | 'location' | 'costume' | 'style'

export interface ResolvedReference {
  role: ReferenceRole
  assetId?: string
  assetName?: string
  variantName?: string
  /** 参考槽位里的顺序，从 1 起（即提示词里"图N"的 N，读时派生，不落盘）。 */
  index: number
  file: FileRef
  versionId?: string
}

export interface ResolvedInputs {
  target: GenerationTarget
  key: string
  aspectRatio: AspectRatio
  style: StyleSnapshot
  /** 库内形式的提示词文本（含 `@{id}` 占位符）。 */
  prompt: string
  durationSec?: number
  narration?: string
  references: ResolvedReference[]
  /** 视频：起始帧（= 镜头当前图）。 */
  startFrame?: ResolvedReference
  /** 因槽位超限被舍弃的参考。 */
  trimmed: ResolvedReference[]
  gaps: Gap[]
}

export interface ResolveOptions {
  /** 目标模型的参考图上限；缺省 = 不限制。 */
  maxRefImages?: number
}

// 超限时的取舍优先级：说话/主要动作的人物 > 道具 > 地点 > 其余人物/服装 > 风格图。
const TRIM_PRIORITY: Record<ReferenceRole, number> = {
  start_frame: 0,
  character: 2,
  prop: 3,
  location: 4,
  costume: 5,
  style: 6,
}

export function resolveInputs(
  projection: ProjectProjection,
  target: GenerationTarget,
  options: ResolveOptions = {},
): ResolvedInputs {
  const base = {
    target,
    key: targetId(target),
    aspectRatio: projection.project.aspectRatio,
    style: projection.project.style,
    prompt: '',
    references: [] as ResolvedReference[],
    trimmed: [] as ResolvedReference[],
    gaps: [] as Gap[],
  }

  switch (target.kind) {
    case 'asset_sheet':
      return resolveAssetSheet(projection, target, base)
    case 'shot_image':
      return resolveShotImage(projection, target.shotId, base, options)
    case 'shot_video':
      return resolveShotVideo(projection, target.shotId, base)
    case 'shot_audio':
      return resolveShotAudio(projection, target.shotId, base)
  }
}

type Base = Pick<
  ResolvedInputs,
  'target' | 'key' | 'aspectRatio' | 'style' | 'prompt' | 'references' | 'trimmed' | 'gaps'
>

function notFound(base: Base, what: string): ResolvedInputs {
  base.gaps.push({ code: 'TARGET_NOT_FOUND', severity: 'block', message: `${what} not found` })
  return base
}

function sheetRef(
  role: ReferenceRole,
  asset: Asset,
  variant: AssetVariant | undefined,
  index: number,
): ResolvedReference | undefined {
  const slot = variant ? variant.sheet : asset.sheet
  const version = currentVersion(slot)
  if (!version) return undefined
  return {
    role,
    assetId: asset.id,
    assetName: asset.name,
    variantName: variant?.name,
    index,
    file: version.file,
    versionId: version.id,
  }
}

function resolveAssetSheet(
  p: ProjectProjection,
  target: Extract<GenerationTarget, { kind: 'asset_sheet' }>,
  base: Base,
): ResolvedInputs {
  const asset = p.assets.get(target.assetId)
  if (!asset) return notFound(base, `asset ${target.assetId}`)

  const parts = [asset.appearance, asset.styling, asset.description].filter(Boolean)
  base.prompt = parts.join('\n')

  if (target.variantName) {
    const variant = asset.variants.find((v) => v.name === target.variantName)
    if (!variant) {
      base.gaps.push({
        code: 'VARIANT_NOT_FOUND',
        severity: 'block',
        message: `variant "${target.variantName}" not found on "${asset.name}"`,
        assetId: asset.id,
      })
      return base
    }
    // 衍生资产图 = 对本体资产图做一次图片编辑：以当前图为参考、用户的增量指令为提示词。
    // 若关联了服装资产：把服装描述并入指令；服装有资产图时作为附加参考（没有则略去并提示）。
    base.prompt = variant.editInstruction ?? variant.description
    const baseRef = sheetRef('character', asset, undefined, 1)
    if (!baseRef) {
      base.gaps.push({
        code: 'BASE_SHEET_MISSING',
        severity: 'block',
        message: `"${asset.name}" has no sheet to derive variant "${variant.name}" from`,
        assetId: asset.id,
      })
    } else {
      base.references.push(baseRef)
    }
    if (variant.costumeAssetId) {
      const costume = p.assets.get(variant.costumeAssetId)
      if (!costume || costume.kind !== 'costume') {
        base.gaps.push({
          code: 'VARIANT_COSTUME_INVALID',
          severity: 'block',
          message: `variant "${variant.name}" links to ${variant.costumeAssetId}, which is not a registered costume asset`,
          assetId: asset.id,
        })
      } else {
        const costumeText = [costume.appearance, costume.styling, costume.description]
          .filter(Boolean)
          .join('，')
        if (costumeText) base.prompt = `${base.prompt}\n服装：${costume.name}（${costumeText}）`
        const costumeRef = sheetRef('costume', costume, undefined, base.references.length + 1)
        if (costumeRef) base.references.push(costumeRef)
        else {
          base.gaps.push({
            code: 'OPTIONAL_INPUT_OMITTED',
            severity: 'omit',
            message: `costume "${costume.name}" has no sheet; only its description is used`,
            assetId: costume.id,
          })
        }
      }
    }
    return base
  }

  // 本体资产图：用户原图只作为生成资产图的输入。
  asset.originals.forEach((file, i) => {
    base.references.push({
      role: asset.kind === 'location' ? 'location' : asset.kind === 'prop' ? 'prop' : 'character',
      assetId: asset.id,
      assetName: asset.name,
      index: i + 1,
      file,
    })
  })
  return base
}

function resolveShotImage(
  p: ProjectProjection,
  shotId: string,
  base: Base,
  options: ResolveOptions,
): ResolvedInputs {
  const shot = p.shots.get(shotId)
  if (!shot) return notFound(base, `shot ${shotId}`)
  base.aspectRatio = effectiveAspect(p.project, shot)
  base.prompt = shotImagePrompt(shot)
  if (!base.prompt.trim()) {
    base.gaps.push({ code: 'PROMPT_EMPTY', severity: 'block', message: 'shot has no image prompt' })
  }

  const speakers = new Set(shot.dialogue.map((d) => d.speakerAssetId).filter(Boolean) as string[])
  // 候选引用：提示词里的提及（按首次出现顺序）在前，引用表里其余的按表顺序在后。
  const wanted: Array<{ assetId: string; variantName?: string }> = []
  const seen = new Set<string>()
  const add = (assetId: string, variantName?: string) => {
    const k = `${assetId}/${variantName ?? ''}`
    if (seen.has(k)) return
    seen.add(k)
    wanted.push({ assetId, variantName })
  }
  for (const m of extractMentions(base.prompt)) add(m.assetId, m.variantName)
  for (const r of p.refs.get(shot.id) ?? []) add(r.assetId, r.variantName)

  const resolved: Array<ResolvedReference & { priority: number }> = []
  for (const w of wanted) {
    const asset = p.assets.get(w.assetId)
    if (!asset) {
      base.gaps.push({
        code: 'ASSET_NOT_REGISTERED',
        severity: 'block',
        message: `shot references asset ${w.assetId} which is not registered (or was deleted)`,
        assetId: w.assetId,
      })
      continue
    }
    const variant = w.variantName ? asset.variants.find((v) => v.name === w.variantName) : undefined
    if (w.variantName && !variant) {
      base.gaps.push({
        code: 'VARIANT_NOT_FOUND',
        severity: 'block',
        message: `variant "${w.variantName}" not found on "${asset.name}"`,
        assetId: asset.id,
      })
      continue
    }
    const role: ReferenceRole = asset.kind
    const ref = sheetRef(role, asset, variant, 0)
    if (!ref) {
      // 用户原图不能顶替资产图。
      base.gaps.push({
        code: 'ASSET_SHEET_MISSING',
        severity: 'block',
        message: `"${asset.name}${variant ? `/${variant.name}` : ''}" has no sheet image`,
        assetId: asset.id,
      })
      continue
    }
    const priority = speakers.has(asset.id) ? 1 : TRIM_PRIORITY[role]
    resolved.push({ ...ref, priority })
  }

  if (p.project.style.source === 'reference_image' && p.project.style.referenceFile) {
    resolved.push({
      role: 'style',
      index: 0,
      file: p.project.style.referenceFile,
      priority: TRIM_PRIORITY.style,
    })
  }

  let kept = resolved
  const limit = options.maxRefImages
  if (limit !== undefined && resolved.length > limit) {
    const rank = [...resolved].sort((a, b) => a.priority - b.priority)
    const keepSet = new Set(rank.slice(0, Math.max(0, limit)))
    kept = resolved.filter((r) => keepSet.has(r))
    base.trimmed = resolved.filter((r) => !keepSet.has(r)).map(stripPriority)
    if (base.trimmed.length > 0) {
      base.gaps.push({
        code: 'REFS_TRIMMED',
        severity: 'warn',
        message: `${base.trimmed.length} reference(s) dropped to fit the model limit of ${limit}`,
      })
    }
  }
  base.references = kept.map((r, i) => ({ ...stripPriority(r), index: i + 1 }))
  return base
}

function stripPriority(r: ResolvedReference & { priority?: number }): ResolvedReference {
  return {
    role: r.role,
    assetId: r.assetId,
    assetName: r.assetName,
    variantName: r.variantName,
    index: r.index,
    file: r.file,
    versionId: r.versionId,
  }
}

function resolveShotVideo(p: ProjectProjection, shotId: string, base: Base): ResolvedInputs {
  const shot = p.shots.get(shotId)
  if (!shot) return notFound(base, `shot ${shotId}`)
  base.aspectRatio = effectiveAspect(p.project, shot)
  base.prompt = shot.prompts.video ?? ''
  if (!base.prompt.trim()) {
    base.gaps.push({ code: 'PROMPT_EMPTY', severity: 'block', message: 'shot has no video prompt' })
  }
  const out: ResolvedInputs = { ...base, durationSec: shot.durationSec }
  const version: MediaVersion | undefined = currentVersion(shot.image)
  if (!version) {
    out.gaps.push({
      code: 'START_FRAME_MISSING',
      severity: 'block',
      message: 'shot has no image to use as the start frame',
    })
  } else {
    out.startFrame = { role: 'start_frame', index: 1, file: version.file, versionId: version.id }
  }
  return out
}

function resolveShotAudio(p: ProjectProjection, shotId: string, base: Base): ResolvedInputs {
  const shot = p.shots.get(shotId)
  if (!shot) return notFound(base, `shot ${shotId}`)
  const narration = shot.narration?.trim() ?? ''
  const out: ResolvedInputs = { ...base, narration, durationSec: shot.durationSec }
  if (!narration) {
    out.gaps.push({ code: 'NARRATION_EMPTY', severity: 'block', message: 'shot has no narration' })
  }
  return out
}

function shotImagePrompt(shot: Shot): string {
  return shot.prompts.keyFrame ?? shot.prompts.firstFrame ?? ''
}

/** 阻断性缺口（作者声明的输入有问题）。 */
export function blockingGaps(inputs: ResolvedInputs): Gap[] {
  return inputs.gaps.filter((g) => g.severity === 'block')
}
