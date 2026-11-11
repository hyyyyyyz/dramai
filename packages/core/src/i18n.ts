/**
 * 内置数据（风格预设、服务商预设、演示提示语……）的语言。
 * 原则：**用户自己填写的内容原样返回，只有内置数据需要翻译**。内置数据在数据文件 / 预设里同时带中英文；
 * 中文是源语言（也是缺省），没有对应翻译时回退到中文。
 */
export const LOCALES = ['zh', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'zh'

/** `zh-CN` / `en-US` / `en` → 支持的语言；认不出返回 undefined。 */
export function normalizeLocale(input: string | undefined | null): Locale | undefined {
  const tag = input?.trim().toLowerCase()
  if (!tag) return undefined
  if (tag === 'zh' || tag.startsWith('zh-') || tag.startsWith('zh_')) return 'zh'
  if (tag === 'en' || tag.startsWith('en-') || tag.startsWith('en_')) return 'en'
  return undefined
}

/** 解析 `Accept-Language`，按权重取第一个支持的语言。 */
export function localeFromAcceptLanguage(header: string | undefined | null): Locale | undefined {
  if (!header) return undefined
  const ranked = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';')
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.split('=')[1] ?? 1)
      return { tag: tag ?? '', q: Number.isFinite(q) ? q : 0, i }
    })
    .sort((a, b) => b.q - a.q || a.i - b.i)
  for (const { tag } of ranked) {
    const l = normalizeLocale(tag)
    if (l) return l
  }
  return undefined
}

/** 一段内置文案：中文是源，其他语言可选。 */
export type Localized = { zh: string } & Partial<Record<Exclude<Locale, 'zh'>, string>>

export function pick(text: Localized, locale: Locale): string {
  return text[locale] ?? text.zh
}
