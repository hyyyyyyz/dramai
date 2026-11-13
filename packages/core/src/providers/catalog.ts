import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { aspectParts } from '../domain/common.ts'
import type { AspectRatio } from '../domain/common.ts'
import type {
  GenerationMode,
  ModelCapability,
  Support,
  ModelProfile,
  PriceEntry,
  ProtocolId,
  ProviderConfig,
} from './types.ts'
import { parseJsonText } from '../util/text.ts'

/**
 * 模型画像（能力 + 价目 + 提示词写法 + 已知脾气）放在数据文件里，运行时加载，
 * 可按目录分层覆盖（后加载的按 id 覆盖先加载的）。
 */

export const MODEL_DATA_SCHEMA_VERSION = 1

const aspect = z.enum(['9:16', '16:9', '1:1'])
const mode = z.enum(['t2i', 'i2i', 't2v', 'i2v', 'first_last', 'omni_ref', 'tts'])
const protocol = z.enum([
  'openai-chat',
  'openai-images',
  'gemini-image',
  'aliyun-video',
  'volcengine-video',
  'kling-video',
  'generic-video',
  'openai-tts',
  'openai-responses',
  'anthropic-messages',
  'gemini-chat',
  'volcengine-images',
  'dashscope-image',
  'siliconflow-images',
  'kling-image',
])

const support = z.enum(['supported', 'unsupported', 'unverified'])
const claim = <T extends z.ZodType>(value: T) =>
  z.object({ support, value: value.optional(), note: z.string().optional() })

const capabilitySchema = z.object({
  media: z.enum(['image', 'video', 'audio']),
  verifiedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  modes: z.partialRecord(mode, support),
  refImages: claim(z.number().int().min(0)),
  refVideos: claim(z.number().int().min(0)),
  refAudios: claim(z.number().int().min(0)),
  refAudioMaxTotalSec: z.number().positive().optional(),
  firstFrame: support,
  lastFrame: support,
  nativeAudio: support,
  durations: claim(
    z.object({
      values: z.array(z.number().positive()).optional(),
      min: z.number().positive().optional(),
      max: z.number().positive().optional(),
    }),
  ),
  resolutions: claim(z.array(z.string())),
  aspectRatios: claim(z.array(aspect)),
  aspectFromSource: z.boolean().optional(),
  maxPromptChars: z.number().int().positive().optional(),
  sizeStep: z.number().int().positive().optional(),
  maxLongSide: z.number().int().positive().optional(),
  maxPixels: z.number().int().positive().optional(),
})

const priceSchema = z.object({
  currency: z.string(),
  unit: z.enum(['per_image', 'per_second', 'per_call', 'per_1k_chars']),
  amount: z.number().min(0),
  dimensions: z.record(z.string(), z.string()).optional(),
  range: z.tuple([z.number(), z.number()]).optional(),
  note: z.string().optional(),
})

const profileSchema = z.object({
  id: z.string().min(1),
  protocol,
  apiModel: z.string().min(1),
  displayName: z.string(),
  capability: capabilitySchema,
  pricing: z.array(priceSchema),
  prompt: z.object({
    lang: z.enum(['zh', 'en']),
    recommendedMaxChars: z.number().int().positive().optional(),
    referenceBinding: z.string().optional(),
    suffixFloor: z.array(z.string()).optional(),
    negative: z.enum(['field', 'none', 'inline']),
    ignores: z.array(z.string()).optional(),
  }),
  quirks: z.array(z.string()),
  provenance: z.string(),
})

const fileSchema = z.object({
  schemaVersion: z.literal(MODEL_DATA_SCHEMA_VERSION),
  models: z.array(profileSchema),
})

/**
 * 没有画像的模型（用户自填的型号）使用的默认能力。
 * 只把“这个服务商配置本来要做的事”（主模式）当作支持——用户配了它就是为了这个；
 * 其余一律 `unverified`。**不会**偷偷套用别的模型的能力。
 */
export function defaultCapability(protocolId: ProtocolId): ModelCapability {
  const unknown = { support: 'unverified' as const }
  const base = {
    refImages: unknown,
    refVideos: unknown,
    refAudios: unknown,
    firstFrame: 'unverified' as const,
    lastFrame: 'unverified' as const,
    nativeAudio: 'unverified' as const,
    durations: unknown,
    resolutions: unknown,
    aspectRatios: unknown,
  }
  switch (protocolId) {
    case 'openai-images':
    case 'gemini-image':
    case 'volcengine-images':
    case 'dashscope-image':
    case 'siliconflow-images':
    case 'kling-image':
      return { ...base, media: 'image', modes: { t2i: 'supported' } }
    case 'openai-tts':
      return { ...base, media: 'audio', modes: { tts: 'supported' } }
    case 'openai-chat':
    case 'openai-responses':
    case 'anthropic-messages':
    case 'gemini-chat':
      return { ...base, media: 'audio', modes: {} }
    default:
      return {
        ...base,
        media: 'video',
        modes: { i2v: 'supported' },
        firstFrame: 'supported',
        aspectFromSource: true,
      }
  }
}

export interface ModelLookup {
  /** 画像是否存在于数据文件。false = 用户自填型号，能力是保守默认。 */
  declared: boolean
  profile?: ModelProfile
  capability: ModelCapability
}

export class ModelRegistry {
  private readonly profiles = new Map<string, ModelProfile>()

  add(profile: ModelProfile): this {
    this.profiles.set(`${profile.protocol}:${profile.apiModel}`, profile)
    return this
  }

  all(): ModelProfile[] {
    return [...this.profiles.values()]
  }

  /**
   * 查某个服务商配置对应的模型能力。`capabilityOverrides` 覆盖画像（自定义模型时用）。
   * 找不到画像时返回保守默认，`declared: false`——**不会**偷偷套用别的模型的能力。
   */
  lookup(config: Pick<ProviderConfig, 'protocol' | 'model' | 'capabilityOverrides'>): ModelLookup {
    const profile = this.profiles.get(`${config.protocol}:${config.model}`)
    const base = profile?.capability ?? defaultCapability(config.protocol)
    const capability = config.capabilityOverrides
      ? { ...base, ...config.capabilityOverrides }
      : base
    return {
      declared: profile !== undefined || config.capabilityOverrides !== undefined,
      profile,
      capability,
    }
  }
}

export function loadModelRegistryFromDir(dir: string, into = new ModelRegistry()): ModelRegistry {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory() || !name.endsWith('.json')) continue
    const parsed = fileSchema.safeParse(parseJsonText(readFileSync(full, 'utf8')))
    if (!parsed.success) {
      throw new Error(`invalid model data ${full}: ${z.prettifyError(parsed.error)}`)
    }
    for (const p of parsed.data.models) into.add(p as ModelProfile)
  }
  return into
}

// === 价目与成本估算 ===

export type CostEstimate =
  | { priced: true; currency: string; amount: number; range?: [number, number]; approx: boolean }
  | { priced: false; reason: string }

export interface CostQuery {
  count?: number
  seconds?: number
  /** 处理的字符数（按千字计价的文本 / 配音服务）。 */
  chars?: number
  resolution?: string
}

/** 按价目表估算费用。查不到单价 = 未定价，不猜。费用只是估算，不替代官方账单。 */
export function estimateCost(profile: ModelProfile | undefined, query: CostQuery): CostEstimate {
  if (!profile) return { priced: false, reason: '该型号没有画像，未定价' }
  if (profile.pricing.length === 0) return { priced: false, reason: '该型号未定价' }
  const entry = pickPrice(profile.pricing, query)
  if (!entry)
    return { priced: false, reason: `没有匹配分辨率 ${query.resolution ?? '(未指定)'} 的价目` }
  let quantity: number
  switch (entry.unit) {
    case 'per_image':
    case 'per_call':
      quantity = query.count ?? 1
      break
    case 'per_second':
      if (query.seconds === undefined) return { priced: false, reason: '按秒计价但没有给时长' }
      quantity = query.seconds * (query.count ?? 1)
      break
    case 'per_1k_chars':
      if (query.chars === undefined) return { priced: false, reason: '按千字计价但没有给字数' }
      quantity = (query.chars / 1000) * (query.count ?? 1)
      break
    default:
      return { priced: false, reason: `暂不支持按 ${entry.unit} 估算` }
  }
  return {
    priced: true,
    currency: entry.currency,
    amount: round6(entry.amount * quantity),
    range: entry.range
      ? [round6(entry.range[0] * quantity), round6(entry.range[1] * quantity)]
      : undefined,
    approx: entry.range !== undefined,
  }
}

function pickPrice(entries: PriceEntry[], query: CostQuery): PriceEntry | undefined {
  const exact = entries.find(
    (e) => e.dimensions?.resolution && e.dimensions.resolution === query.resolution,
  )
  if (exact) return exact
  const wildcard = entries.find((e) => !e.dimensions || Object.keys(e.dimensions).length === 0)
  if (wildcard) return wildcard
  // 价目只按分辨率分档，而调用没指定分辨率：不猜。
  return undefined
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

// === 多币种汇总与（可选的）折算 ===

export interface CurrencyTotal {
  amount: number
  range?: [number, number]
  approx: boolean
}

export interface CostTotals {
  /** 按服务商的原始币种分开统计，不同币种不相加。 */
  byCurrency: Record<string, CurrencyTotal>
  /** 查不到单价的条数（不计入金额）。 */
  unpriced: number
}

export function totalCosts(estimates: readonly CostEstimate[]): CostTotals {
  const out: CostTotals = { byCurrency: {}, unpriced: 0 }
  for (const e of estimates) {
    if (!e.priced) {
      out.unpriced++
      continue
    }
    const cur = out.byCurrency[e.currency] ?? { amount: 0, approx: false }
    cur.amount = round6(cur.amount + e.amount)
    if (e.range || cur.range) {
      const lo = (cur.range?.[0] ?? cur.amount - e.amount) + (e.range?.[0] ?? e.amount)
      const hi = (cur.range?.[1] ?? cur.amount - e.amount) + (e.range?.[1] ?? e.amount)
      cur.range = [round6(lo), round6(hi)]
    }
    cur.approx = cur.approx || e.approx
    out.byCurrency[e.currency] = cur
  }
  return out
}

/**
 * 费用显示设置（用户可改，**默认不折算**）。
 * `rates[币种]` = 1 单位该币种折合多少 `targetCurrency`。没有设置汇率的币种保持原样，不猜。
 */
export interface CostDisplaySettings {
  conversion?: { targetCurrency: string; rates: Record<string, number> }
}

export interface ConvertedTotals {
  /** 已折算的合计（仅当设置了折算且至少有一个币种有汇率）。 */
  converted?: { currency: string; amount: number; range?: [number, number]; approx: boolean }
  /** 没有折算的币种（原样保留，分开统计）。 */
  remaining: Record<string, CurrencyTotal>
  unpriced: number
  /** 折算只是估算，不是账单。 */
  isEstimate: true
}

export function convertTotals(totals: CostTotals, settings?: CostDisplaySettings): ConvertedTotals {
  const conv = settings?.conversion
  if (!conv)
    return { remaining: { ...totals.byCurrency }, unpriced: totals.unpriced, isEstimate: true }
  let amount = 0
  let lo = 0
  let hi = 0
  let any = false
  let hasRange = false
  const remaining: Record<string, CurrencyTotal> = {}
  for (const [currency, t] of Object.entries(totals.byCurrency)) {
    const rate = currency === conv.targetCurrency ? 1 : conv.rates[currency]
    if (!(rate > 0)) {
      remaining[currency] = t
      continue
    }
    any = true
    amount += t.amount * rate
    lo += (t.range?.[0] ?? t.amount) * rate
    hi += (t.range?.[1] ?? t.amount) * rate
    hasRange = hasRange || t.range !== undefined
  }
  return {
    converted: any
      ? {
          currency: conv.targetCurrency,
          amount: round6(amount),
          range: hasRange ? [round6(lo), round6(hi)] : undefined,
          approx: true, // 折算只是估算
          // （各币种自身是否为区间估算已并入 range）
        }
      : undefined,
    remaining,
    unpriced: totals.unpriced,
    isEstimate: true,
  }
}

// === 能力检查：缺失 = 带原因的错误，不静默回退；未验证 = 单独一档，需要确认 ===

export type CapabilityIssueCode =
  | 'MODE_UNSUPPORTED'
  | 'REFERENCE_NOT_SUPPORTED'
  | 'ASPECT_UNSUPPORTED'
  | 'DURATION_UNSUPPORTED'
  | 'RESOLUTION_UNSUPPORTED'
  | 'FIRST_FRAME_UNSUPPORTED'
  | 'LAST_FRAME_UNSUPPORTED'

export interface CapabilityIssue {
  code: CapabilityIssueCode
  /** unsupported：已知不可用，必须阻断。unverified：没验证过，需要用户确认。 */
  level: 'unsupported' | 'unverified'
  /** 能力项键，如 `mode:i2i`、`refImages`、`aspectRatio`，用于 `ProviderConfig.acceptedUnverified`。 */
  key: string
  message: string
}

export interface CapabilityNeeds {
  mode?: GenerationMode
  referenceImages?: number
  aspectRatio?: AspectRatio
  durationSec?: number
  resolution?: string
  firstFrame?: boolean
  lastFrame?: boolean
}

/** 参考图张数上限：不支持 = 0；未声明 = undefined（不限制/不知道）。 */
export function maxRefImagesOf(cap: ModelCapability): number | undefined {
  if (cap.refImages.support === 'unsupported') return 0
  return cap.refImages.value
}

export function checkCapability(
  lookup: ModelLookup,
  model: string,
  needs: CapabilityNeeds,
): CapabilityIssue[] {
  const cap = lookup.capability
  const issues: CapabilityIssue[] = []
  const tag = lookup.declared ? model : `${model}（没有能力画像）`
  const add = (
    code: CapabilityIssueCode,
    state: Support,
    key: string,
    unsupportedMsg: string,
    unverifiedMsg: string,
  ) => {
    if (state === 'supported') return
    issues.push({
      code,
      level: state,
      key,
      message: `${tag} ${state === 'unsupported' ? unsupportedMsg : unverifiedMsg}`,
    })
  }

  if (needs.mode) {
    add(
      'MODE_UNSUPPORTED',
      cap.modes[needs.mode] ?? 'unverified',
      `mode:${needs.mode}`,
      `不支持 ${needs.mode} 模式`,
      `的 ${needs.mode} 模式没有验证过`,
    )
  }
  if ((needs.referenceImages ?? 0) > 0) {
    add(
      'REFERENCE_NOT_SUPPORTED',
      cap.refImages.support,
      'refImages',
      '不接受参考图；继续会退化为纯文生图，角色一致性无法保证',
      '接受参考图的能力没有验证过；参考图可能被忽略，角色一致性无法保证',
    )
  }
  if (needs.firstFrame) {
    add(
      'FIRST_FRAME_UNSUPPORTED',
      cap.firstFrame,
      'firstFrame',
      '不支持首帧',
      '的首帧能力没有验证过',
    )
  }
  if (needs.lastFrame) {
    add('LAST_FRAME_UNSUPPORTED', cap.lastFrame, 'lastFrame', '不支持尾帧', '的尾帧能力没有验证过')
  }
  if (needs.aspectRatio && !cap.aspectFromSource) {
    const claimed = cap.aspectRatios
    const state: Support =
      claimed.support === 'supported' && claimed.value && !claimed.value.includes(needs.aspectRatio)
        ? 'unsupported'
        : claimed.support
    add(
      'ASPECT_UNSUPPORTED',
      state,
      'aspectRatio',
      `不支持画幅 ${needs.aspectRatio}`,
      `对画幅 ${needs.aspectRatio} 的支持没有验证过`,
    )
  }
  if (needs.resolution && needs.resolution !== 'none') {
    const claimed = cap.resolutions
    const state: Support =
      claimed.support === 'supported' && claimed.value && !claimed.value.includes(needs.resolution)
        ? 'unsupported'
        : claimed.support
    add(
      'RESOLUTION_UNSUPPORTED',
      state,
      'resolution',
      `不支持分辨率 ${needs.resolution}`,
      `对分辨率 ${needs.resolution} 的支持没有验证过`,
    )
  }
  if (needs.durationSec !== undefined && cap.durations.support === 'unverified') {
    add(
      'DURATION_UNSUPPORTED',
      'unverified',
      'duration',
      '',
      '的时长档没有验证过，无法确认会按多少秒生成',
    )
  }
  return issues
}

/** 画幅比例的整数宽高比，给尺寸规则用。 */
export function ratioParts(r: AspectRatio): { w: number; h: number } {
  return aspectParts(r)
}
