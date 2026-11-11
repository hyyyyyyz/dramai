import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { StyleSnapshot } from '../domain/project.ts'
import { DomainError } from '../errors.ts'
import type { Locale } from '../i18n.ts'

/**
 * 风格预设（数据文件 `styles.json`）。预设只是给用户省手敲：可以不用、手写、或留空让 LLM 从素材推断。
 * 创建项目时用 `expandStyle` 展开成快照写进项目；之后模板更新不回写旧项目。
 */

export const STYLE_SCHEMA_VERSION = 1

/** 内置文案的其他语言版本（中文是源语言，写在 label / description 上）。 */
export interface StylePresetI18n {
  en?: { label: string; description: string }
}

export interface StylePreset {
  id: string
  label: string
  description: string
  /** 英文画面关键词，作为视觉基底。 */
  imageKeywords: string
  i18n?: StylePresetI18n
}

export interface StylePresetGroup {
  id: string
  label: string
  presets: StylePreset[]
  i18n?: { en?: { label: string } }
}

const fileSchema = z.object({
  schemaVersion: z.literal(STYLE_SCHEMA_VERSION),
  groups: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      i18n: z.object({ en: z.object({ label: z.string() }).optional() }).optional(),
      presets: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          description: z.string(),
          imageKeywords: z.string().min(1),
          i18n: z
            .object({ en: z.object({ label: z.string(), description: z.string() }).optional() })
            .optional(),
        }),
      ),
    }),
  ),
})

export class StyleCatalog {
  readonly groups: StylePresetGroup[]
  readonly presets: StylePreset[]

  constructor(groups: StylePresetGroup[]) {
    this.groups = groups
    this.presets = groups.flatMap((g) => g.presets)
    const ids = new Set<string>()
    for (const p of this.presets) {
      if (ids.has(p.id)) throw new Error(`duplicate style preset id: ${p.id}`)
      ids.add(p.id)
    }
  }

  get(id: string): StylePreset | undefined {
    return this.presets.find((p) => p.id === id)
  }

  /** 用 label 或 id 在一段文本里粗略匹配一个预设（沿用 v0.4 的命中规则）。 */
  match(text?: string): StylePreset | undefined {
    const t = text?.trim()
    if (!t) return undefined
    const lower = t.toLowerCase()
    return this.presets.find((p) => t.includes(p.label) || lower.includes(p.id))
  }

  /** 把后加载的目录里的同 id 预设覆盖进来（保持分组）。 */
  merged(other: StyleCatalog): StyleCatalog {
    const groups = this.groups.map((g) => ({ ...g, presets: [...g.presets] }))
    for (const og of other.groups) {
      let target = groups.find((g) => g.id === og.id)
      if (!target) {
        target = { id: og.id, label: og.label, i18n: og.i18n, presets: [] }
        groups.push(target)
      }
      for (const p of og.presets) {
        const i = target.presets.findIndex((x) => x.id === p.id)
        if (i >= 0) target.presets[i] = p
        else target.presets.push(p)
      }
    }
    return new StyleCatalog(groups)
  }
}

export function loadStyleCatalog(file: string): StyleCatalog {
  const parsed = fileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!parsed.success)
    throw new Error(`invalid style data ${file}: ${z.prettifyError(parsed.error)}`)
  return new StyleCatalog(parsed.data.groups)
}

export type StyleChoice =
  | { source: 'none' }
  | { source: 'template'; templateId: string }
  | { source: 'custom'; description: string; imageKeywords?: string }
  | {
      source: 'reference_image'
      referenceFile: NonNullable<StyleSnapshot['referenceFile']>
      label?: string
    }

/**
 * 把用户的风格选择展开成快照。"模板 / 参考图 / 自定义 / 无"互斥：快照里只有被选中那一种的内容。
 */
export function expandStyle(
  catalog: StyleCatalog,
  choice: StyleChoice,
  now: number,
): StyleSnapshot {
  switch (choice.source) {
    case 'none':
      return {
        source: 'none',
        label: '未指定',
        description: '',
        imageKeywords: '',
        expandedAt: now,
      }
    case 'template': {
      const preset = catalog.get(choice.templateId)
      if (!preset)
        throw new DomainError(
          'UNKNOWN_STYLE_TEMPLATE',
          `unknown style template: ${choice.templateId}`,
          {
            details: { templateId: choice.templateId },
          },
        )
      return {
        source: 'template',
        templateId: preset.id,
        label: preset.label,
        description: preset.description,
        imageKeywords: preset.imageKeywords,
        expandedAt: now,
      }
    }
    case 'custom': {
      const preset = catalog.match(choice.description)
      return {
        source: 'custom',
        label: '自定义',
        description: choice.description.trim(),
        // 自定义文本里命中了某个预设的名字时，借用它的关键词，除非调用方明确给了关键词。
        imageKeywords: choice.imageKeywords ?? preset?.imageKeywords ?? '',
        expandedAt: now,
      }
    }
    case 'reference_image':
      return {
        source: 'reference_image',
        label: choice.label ?? '风格参考图',
        description: '',
        imageKeywords: '',
        referenceFile: choice.referenceFile,
        expandedAt: now,
      }
  }
}

// === 本地化 ===

export function localizeStylePreset(
  preset: StylePreset,
  locale: Locale,
): Pick<StylePreset, 'label' | 'description'> {
  const t = locale === 'en' ? preset.i18n?.en : undefined
  return { label: t?.label ?? preset.label, description: t?.description ?? preset.description }
}

export function localizeStyleGroup(group: StylePresetGroup, locale: Locale): string {
  return (locale === 'en' ? group.i18n?.en?.label : undefined) ?? group.label
}

/** 快照里内置的文案（“未指定”“自定义”“风格参考图”）。 */
const BUILT_IN_STYLE_LABELS: Record<string, { en: string }> = {
  未指定: { en: 'Unspecified' },
  自定义: { en: 'Custom' },
  风格参考图: { en: 'Style reference image' },
}

/**
 * 项目里存的风格快照带着创建时的中文名称。展示时：
 * - 模板风格且名称 / 描述没被用户改过 → 换成目录里对应语言的版本；
 * - 内置的“未指定 / 自定义 / 风格参考图” → 换成对应语言；
 * - 用户自己写的名称、描述原样返回。
 */
export function localizeStyleSnapshot(
  style: StyleSnapshot,
  catalog: StyleCatalog,
  locale: Locale,
): StyleSnapshot {
  if (locale === 'zh') return style
  const builtIn = BUILT_IN_STYLE_LABELS[style.label]
  if (style.source === 'template' && style.templateId) {
    const preset = catalog.get(style.templateId)
    if (preset) {
      const t = localizeStylePreset(preset, locale)
      return {
        ...style,
        label: style.label === preset.label ? t.label : style.label,
        description: style.description === preset.description ? t.description : style.description,
      }
    }
  }
  if (style.source !== 'template' && builtIn) return { ...style, label: builtIn.en }
  return style
}
