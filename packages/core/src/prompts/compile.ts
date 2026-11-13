import type { ResolvedReference } from '../generation/inputs.ts'
import type { PromptDialect } from '../providers/types.ts'

/**
 * PromptSpec：语义槽与引擎注入层分离（A17）。
 *
 * LLM（或作者）只填"创作语义槽"；画风前缀、参考图绑定、负面处理、防字地板这些由确定性的编译器按
 * **模型画像里的写法**（PromptDialect）注入，LLM 不重复写。语义内容与"某个模型想怎么被写"是两层。
 */

export interface ImagePromptSpec {
  /** 主体与身份锚点。 */
  subject?: string
  /** 快门时刻的可见动作。 */
  action?: string
  expression?: string
  /** 空间关系与构图。 */
  spatial?: string
  shotSize?: string
  angle?: string
  lens?: string
  lighting?: string
  extra?: string
  /** 完整英文版；方言要求英文且给了它时直接用作主体正文。 */
  fullEn?: string
  /** 镜级负面约束（用正向可排除的短语，如 "no people in frame"）。 */
  negative?: string[]
}

export interface VideoPromptSpec {
  /** 开场承接状态（与上一镜 endState 咬合）。 */
  openingState?: string
  /** 主体动作变化。 */
  action?: string
  secondary?: string
  /** **单一**主运镜。 */
  cameraMove?: string
  endState?: string
  lightingChange?: string
  soundIntent?: string
  extra?: string
  fullEn?: string
}

export interface CompileContext {
  dialect: PromptDialect
  /** 项目风格关键词（风格快照）。 */
  styleKeywords?: string
  /** 带序号的参考图；绑定句由编译器在末尾拼接，基础提示词里不写"图1/图2"。 */
  references?: ResolvedReference[]
  /** 防字地板等恒追加的句子，已按方言选好。 */
  extraFloor?: string[]
  /**
   * 视频：镜头图被降为第 1 张参考图（首帧与参考图互斥的模型）。编译器加一句"图1是开场画面"；
   * 这时 `references` 里的编号从 2 起。
   */
  frameAsReference?: boolean
}

export type CompileWarningCode =
  | 'EMPTY_SPEC'
  | 'PROMPT_TOO_LONG'
  | 'NEGATIVE_DROPPED'
  | 'IGNORED_FIELD'

export interface CompiledPrompt {
  text: string
  /** 仅当方言用独立字段交付负面项时有值。 */
  negative?: string
  warnings: Array<{ code: CompileWarningCode; message: string }>
}

const DEFAULT_BINDING =
  'Image {n} is the reference for {name}; keep identity, hair and outfit consistent.'

function bindingSentences(ctx: CompileContext): string[] {
  const template = ctx.dialect.referenceBinding ?? DEFAULT_BINDING
  return (ctx.references ?? [])
    .filter((r) => r.role !== 'start_frame')
    .map((r) =>
      template.replace('{n}', String(r.index)).replace('{name}', r.assetName ?? 'the style'),
    )
}

const FRAME_BINDING = {
  zh: '图1是开场画面，视频从这一帧开始。',
  en: 'Image 1 is the opening frame; the video starts from it.',
} as const

function frameSentences(ctx: CompileContext): string[] {
  return ctx.frameAsReference ? [FRAME_BINDING[ctx.dialect.lang]] : []
}

function pushLimit(out: CompiledPrompt, text: string, dialect: PromptDialect): void {
  if (dialect.recommendedMaxChars && text.length > dialect.recommendedMaxChars) {
    out.warnings.push({
      code: 'PROMPT_TOO_LONG',
      message: `prompt is ${text.length} chars, recommended max is ${dialect.recommendedMaxChars}`,
    })
  }
}

function dropIgnored(
  fields: Record<string, string | undefined>,
  ignores: string[] | undefined,
  out: CompiledPrompt,
): Record<string, string | undefined> {
  if (!ignores || ignores.length === 0) return fields
  const kept = { ...fields }
  for (const name of ignores) {
    if (kept[name]) {
      out.warnings.push({ code: 'IGNORED_FIELD', message: `this model ignores "${name}"; dropped` })
      kept[name] = undefined
    }
  }
  return kept
}

const clean = (parts: Array<string | undefined>): string[] =>
  parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p))

export function compileImagePrompt(spec: ImagePromptSpec, ctx: CompileContext): CompiledPrompt {
  const out: CompiledPrompt = { text: '', warnings: [] }
  const core = [spec.subject, spec.action, spec.expression, spec.spatial, spec.fullEn]
  if (clean(core).length === 0) {
    out.warnings.push({ code: 'EMPTY_SPEC', message: 'at least one core slot must be filled' })
    return out
  }
  const f = dropIgnored(
    {
      shotSize: spec.shotSize,
      angle: spec.angle,
      lens: spec.lens,
      lighting: spec.lighting,
      subject: spec.subject,
      action: spec.action,
      expression: spec.expression,
      spatial: spec.spatial,
      extra: spec.extra,
    },
    ctx.dialect.ignores,
    out,
  )
  const body =
    ctx.dialect.lang === 'en' && spec.fullEn
      ? [spec.fullEn]
      : [f.subject, f.action, f.expression, f.spatial]
  const sentences = clean([
    ctx.styleKeywords,
    [f.shotSize, f.angle, f.lens].filter(Boolean).join(', '),
    ...body,
    f.lighting,
    f.extra,
    ...bindingSentences(ctx),
  ])
  const negatives = clean(spec.negative ?? [])
  if (negatives.length > 0) {
    if (ctx.dialect.negative === 'field') out.negative = negatives.join(', ')
    else if (ctx.dialect.negative === 'inline') sentences.push(`Exclude: ${negatives.join(', ')}`)
    else
      out.warnings.push({
        code: 'NEGATIVE_DROPPED',
        message: 'this model has no negative-prompt channel; negative constraints were dropped',
      })
  }
  // 地板句恒为最后。
  sentences.push(...clean([...(ctx.dialect.suffixFloor ?? []), ...(ctx.extraFloor ?? [])]))
  out.text = sentences.join('. ').replace(/\.\s*\./g, '.')
  pushLimit(out, out.text, ctx.dialect)
  return out
}

export function compileVideoPrompt(spec: VideoPromptSpec, ctx: CompileContext): CompiledPrompt {
  const out: CompiledPrompt = { text: '', warnings: [] }
  if (clean([spec.action, spec.openingState, spec.endState, spec.fullEn]).length === 0) {
    out.warnings.push({ code: 'EMPTY_SPEC', message: 'at least one core slot must be filled' })
    return out
  }
  const f = dropIgnored(
    {
      cameraMove: spec.cameraMove,
      openingState: spec.openingState,
      action: spec.action,
      secondary: spec.secondary,
      endState: spec.endState,
      lightingChange: spec.lightingChange,
      soundIntent: spec.soundIntent,
      extra: spec.extra,
    },
    ctx.dialect.ignores,
    out,
  )
  const useFull = ctx.dialect.lang === 'en' && spec.fullEn
  // 运镜提到正文首位（前位 token 权重高）。
  const sentences = clean(
    useFull
      ? [f.cameraMove, spec.fullEn]
      : [
          f.cameraMove,
          f.openingState,
          f.action,
          f.secondary,
          f.endState,
          f.lightingChange,
          f.soundIntent,
          f.extra,
        ],
  )
  // 参考图的绑定句（没有参考图时什么都不加，输出和以前逐字相同）
  sentences.push(...frameSentences(ctx), ...bindingSentences(ctx))
  sentences.push(...clean([...(ctx.dialect.suffixFloor ?? []), ...(ctx.extraFloor ?? [])]))
  out.text = sentences.join('. ').replace(/\.\s*\./g, '.')
  pushLimit(out, out.text, ctx.dialect)
  return out
}
