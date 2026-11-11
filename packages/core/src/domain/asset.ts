import type { AssetId, FileRef, ProjectId, ShotId } from './common.ts'
import type { MediaSlot } from './media.ts'

export const ASSET_KINDS = ['character', 'location', 'prop', 'costume'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

/**
 * 衍生形态（换装/变身）：**属于某个角色**，表示该角色的某个形象，共享角色的名字与声音。
 * 只有 `kind: 'character'` 的资产可以有衍生形态。
 *
 * 与服装资产的边界：`kind: 'costume'` 的资产是**可复用的衣物本身**（可以被多个角色穿）；
 * 衍生形态是“某个角色穿上它之后的样子”，通过 `costumeAssetId` **可选地**关联一件服装资产。
 * 关联后，生成衍生形态资产图时会把服装描述并入编辑指令，服装有资产图时作为附加参考。
 */
export interface AssetVariant {
  /** 同一资产内唯一；名字里不允许出现 "/"。 */
  name: string
  /** 可选：关联的服装资产（必须是同项目里 kind = costume 的资产）。 */
  costumeAssetId?: AssetId
  description: string
  /**
   * `edit`：对本体资产图做一次图片编辑得到，本体重生成后判 stale（不自动重生）。
   * `upload`：作者上传的成品，不随本体变化失效。
   */
  origin: 'edit' | 'upload'
  /** origin = edit 时的编辑指令（"变化描述"）。 */
  editInstruction?: string
  sheet: MediaSlot
}

export interface Asset {
  schemaVersion: number
  id: AssetId
  projectId: ProjectId
  number: number
  kind: AssetKind
  /** 用户可见身份；同 kind 内唯一，且不含 "/"。库内引用一律用 id。 */
  name: string
  aliases: string[]
  appearance?: string
  styling?: string
  description?: string
  /** 资产图（sheet）：带版本列表。后续所有生成以它为条件。逐角度版式下它是正面图。 */
  sheet: MediaSlot
  /** 设定图版式：`multi_view` 一张图含多视角；`per_angle` 逐角度单图（`sheet` 为正面，其余在 `sheetViews`）。 */
  sheetLayout?: 'multi_view' | 'per_angle'
  /** 逐角度版式的其余视角。 */
  sheetViews?: Partial<Record<'side' | 'back', MediaSlot>>
  /** 用户上传的原图——只作为生成资产图的输入，不能顶替资产图。 */
  originals: FileRef[]
  /** 角色音色参考音频（A9 预留，可空）。 */
  voiceRef?: FileRef
  variants: AssetVariant[]
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

/**
 * 候选的处理结果：
 * - `pending`：等待处理
 * - `accepted_new`：确认为新资产（`createdAssetId` 指向新建的资产）
 * - `linked`：关联到已有资产（`linkedAssetId`）
 * - `ignored`：忽略
 */
export type CandidateStatus = 'pending' | 'accepted_new' | 'linked' | 'ignored'

/** 为什么怀疑候选和某个已有资产是同一个。 */
export type MatchBasisType =
  | 'exact_name' // 名字完全一致（规范化后）
  | 'alias' // 候选的名字/别名与资产的名字/别名相同
  | 'name_contains' // 一方的名字包含另一方
  | 'llm' // 抽取阶段由大模型给出的判断

export interface MatchBasis {
  type: MatchBasisType
  /** 候选一侧用来比对的文字。 */
  candidateText?: string
  /** 已有资产一侧用来比对的文字。 */
  assetText?: string
  note?: string
}

export interface MatchSuggestion {
  assetId: AssetId
  /** 0..1，越大越像。 */
  score: number
  basis: MatchBasis[]
}

/** 抽取出但尚未确认的实体。 */
export interface EntityCandidate {
  schemaVersion: number
  id: string
  projectId: ProjectId
  kind: AssetKind
  name: string
  aliases: string[]
  /** 0..1 的数值。高/中/低三档用 `confidenceBand` 换算，阈值见 `CONFIDENCE_THRESHOLDS`。 */
  confidence?: number
  /** 外貌 / 外观描述（抽取阶段写的，确认为资产时带过去）。 */
  appearance?: string
  evidence?: string
  /** 出现在哪些镜头。 */
  shotIds: ShotId[]
  variants: Array<{ variantKey: string; description: string; affectedShotIds: ShotId[] }>
  status: CandidateStatus
  /** 疑似同一个的已有资产。处理前给界面用于“关联到 X”的主按钮。 */
  suggestedMatch?: MatchSuggestion
  /** status = linked 时指向被关联的已有资产。 */
  linkedAssetId?: AssetId
  /**
   * 关联是怎么来的：`auto` = 抽取时按“名字 / 别名完全一致”自动关联的；`manual` = 用户手动关联的。
   * 自动关联可能错（两个不同的人可能同名），所以要能和手动区分开，并且可以撤销（见 `undoCandidateLink`）。
   */
  linkSource?: 'auto' | 'manual'
  /** 关联时并入目标资产的别名（撤销时要还回去）。 */
  aliasesAdded?: string[]
  /** 关联时给目标资产创建的衍生形态名（撤销时一并移除——仅当它还没有设定图）。 */
  variantsCreated?: string[]
  /** status = accepted_new 时指向新建的资产。 */
  createdAssetId?: AssetId
  handledAt?: number
  /** 区分"提取过但为空"与"从未提取"。 */
  extractedAt: number
  createdAt: number
}

export type ConfidenceBand = 'high' | 'medium' | 'low'

/** 置信度分档的阈值：**只在这里配置**。 >= high 为高，>= medium 为中，其余为低。 */
export const CONFIDENCE_THRESHOLDS = { high: 0.8, medium: 0.5 } as const

/**
 * 数值置信度 → 三档。缺失（从未给出）按“低”处理：没有把握的东西要被人看一眼。
 * 超出 0..1 的值被夹取；NaN 视为缺失。
 */
export function confidenceBand(
  value: number | undefined,
  thresholds: { high: number; medium: number } = CONFIDENCE_THRESHOLDS,
): ConfidenceBand {
  if (value === undefined || Number.isNaN(value)) return 'low'
  const v = Math.min(1, Math.max(0, value))
  if (v >= thresholds.high) return 'high'
  if (v >= thresholds.medium) return 'medium'
  return 'low'
}

export type CandidateDecision =
  | { action: 'accept_new'; createdAssetId: AssetId }
  | { action: 'link'; assetId: AssetId }
  | { action: 'ignore' }

/** 处理一个候选，返回新对象。只有 pending 的候选可以处理。 */
export function decideCandidate(
  candidate: EntityCandidate,
  decision: CandidateDecision,
  now: number,
  options: { linkSource?: 'auto' | 'manual' } = {},
): EntityCandidate {
  if (candidate.status !== 'pending') {
    throw new Error(`candidate ${candidate.id} is already handled (${candidate.status})`)
  }
  const base = { ...candidate, handledAt: now }
  switch (decision.action) {
    case 'accept_new':
      return { ...base, status: 'accepted_new', createdAssetId: decision.createdAssetId }
    case 'link':
      return {
        ...base,
        status: 'linked',
        linkedAssetId: decision.assetId,
        linkSource: options.linkSource ?? 'manual',
      }
    case 'ignore':
      return { ...base, status: 'ignored' }
  }
}

export interface CandidateProgress {
  total: number
  pending: number
  accepted_new: number
  linked: number
  ignored: number
  handled: number
}

export function candidateProgress(
  candidates: readonly Pick<EntityCandidate, 'status'>[],
): CandidateProgress {
  const out: CandidateProgress = {
    total: candidates.length,
    pending: 0,
    accepted_new: 0,
    linked: 0,
    ignored: 0,
    handled: 0,
  }
  for (const c of candidates) out[c.status]++
  out.handled = out.total - out.pending
  return out
}

export const normalizeEntityName = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·.、,，_\-"'“”‘’《》()（）]/g, '')

/**
 * 规则式匹配：候选 vs 已有资产（同 kind），找“疑似同一个”。
 * 先看名字完全一致，再看别名互相命中，再看名字包含（两个字以上）。
 * 抽取阶段如果大模型已经给出判断，调用方可以直接写 `suggestedMatch`（basis.type = 'llm'）。
 */
export function suggestMatch(
  candidate: Pick<EntityCandidate, 'kind' | 'name' | 'aliases'>,
  assets: readonly Pick<Asset, 'id' | 'kind' | 'name' | 'aliases' | 'deletedAt'>[],
): MatchSuggestion | undefined {
  const cNames = [candidate.name, ...candidate.aliases]
    .map((t) => ({ raw: t, norm: normalizeEntityName(t) }))
    .filter((n) => n.norm)
  let best: MatchSuggestion | undefined
  for (const asset of assets) {
    if (asset.kind !== candidate.kind || asset.deletedAt) continue
    const aNames = [asset.name, ...asset.aliases]
      .map((t) => ({ raw: t, norm: normalizeEntityName(t) }))
      .filter((n) => n.norm)
    const basis: MatchBasis[] = []
    let score = 0
    const mainA = aNames[0]
    const mainC = cNames[0]
    if (mainA && mainC && mainA.norm === mainC.norm) {
      basis.push({ type: 'exact_name', candidateText: mainC.raw, assetText: mainA.raw })
      score = 1
    }
    for (const c of cNames) {
      for (const a of aNames) {
        if (c.norm === a.norm && !(c === mainC && a === mainA)) {
          basis.push({ type: 'alias', candidateText: c.raw, assetText: a.raw })
          score = Math.max(score, 0.9)
        }
      }
    }
    if (basis.length === 0) {
      for (const c of cNames) {
        for (const a of aNames) {
          const [short, long] = c.norm.length <= a.norm.length ? [c.norm, a.norm] : [a.norm, c.norm]
          if (short.length >= 2 && short !== long && long.includes(short)) {
            basis.push({ type: 'name_contains', candidateText: c.raw, assetText: a.raw })
            score = Math.max(score, 0.6 * (short.length / long.length) + 0.2)
          }
        }
      }
    }
    if (basis.length > 0 && (!best || score > best.score)) {
      best = { assetId: asset.id, score: Math.round(score * 100) / 100, basis }
    }
  }
  return best
}

/** 资产自身的结构性校验（保存时不拦，生成/导入前可调用）。 */
export interface AssetIssue {
  code:
    | 'NAME_INVALID'
    | 'VARIANTS_ON_NON_CHARACTER'
    | 'VARIANT_NAME_INVALID'
    | 'VARIANT_NAME_DUPLICATE'
    | 'COSTUME_NOT_FOUND'
    | 'COSTUME_NOT_COSTUME_KIND'
    | 'COSTUME_WITH_VARIANTS'
  message: string
  variantName?: string
}

export function validateAsset(
  asset: Pick<Asset, 'kind' | 'name' | 'variants'>,
  lookup: (id: AssetId) => Pick<Asset, 'kind'> | undefined,
): AssetIssue[] {
  const issues: AssetIssue[] = []
  const nameProblem = validateAssetName(asset.name)
  if (nameProblem) issues.push({ code: 'NAME_INVALID', message: nameProblem })
  if (asset.variants.length > 0 && asset.kind !== 'character') {
    issues.push({
      code: asset.kind === 'costume' ? 'COSTUME_WITH_VARIANTS' : 'VARIANTS_ON_NON_CHARACTER',
      message: '衍生形态只能属于角色；服装是可复用的衣物资产，不是某个角色的形象',
    })
  }
  const seen = new Set<string>()
  for (const v of asset.variants) {
    const problem = validateAssetName(v.name)
    if (problem)
      issues.push({
        code: 'VARIANT_NAME_INVALID',
        message: `衍生形态名：${problem}`,
        variantName: v.name,
      })
    if (seen.has(v.name)) {
      issues.push({
        code: 'VARIANT_NAME_DUPLICATE',
        message: `衍生形态重名：${v.name}`,
        variantName: v.name,
      })
    }
    seen.add(v.name)
    if (v.costumeAssetId) {
      const costume = lookup(v.costumeAssetId)
      if (!costume) {
        issues.push({
          code: 'COSTUME_NOT_FOUND',
          message: `关联的服装资产 ${v.costumeAssetId} 不存在`,
          variantName: v.name,
        })
      } else if (costume.kind !== 'costume') {
        issues.push({
          code: 'COSTUME_NOT_COSTUME_KIND',
          message: `关联的资产不是服装（${costume.kind}）`,
          variantName: v.name,
        })
      }
    }
  }
  return issues
}

export function assetHasSheet(asset: Pick<Asset, 'sheet'>): boolean {
  return asset.sheet.currentVersionId !== null
}

export function validateAssetName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'name is empty'
  if (trimmed.includes('/')) return 'name must not contain "/"'
  return null
}
