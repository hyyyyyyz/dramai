/**
 * Language of the built-in data (style presets, provider presets, the demo notice, ...).
 *
 * Rule: **text the user wrote is returned as written; only built-in data is translated.** Built-in data
 * carries Simplified Chinese (the source language, also the default), Traditional Chinese and English;
 * a missing translation falls back to Simplified Chinese.
 *
 * - `zh`      Simplified Chinese (zh-CN, zh-SG, zh-Hans, plain `zh`)
 * - `zh-Hant` Traditional Chinese (zh-TW, zh-HK, zh-MO, zh-Hant). Real Traditional usage, not a character
 *             conversion of the Simplified text (e.g. 影片 not 視頻, 專案 not 項目).
 * - `en`      English
 */
export const LOCALES = ['zh', 'zh-Hant', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'zh'

/** The locales that carry translations (everything except the source language). */
export type TranslatedLocale = Exclude<Locale, 'zh'>

/** `zh-CN` / `zh-TW` / `en-US` / `en` -> a supported locale; undefined when not recognised. */
export function normalizeLocale(input: string | undefined | null): Locale | undefined {
  const tag = input?.trim().toLowerCase().replace(/_/g, '-')
  if (!tag) return undefined
  if (tag === 'zh' || tag.startsWith('zh-')) {
    const parts = tag.split('-').slice(1)
    // An explicit script wins (zh-Hant-HK, zh-Hans-TW); otherwise the region decides.
    if (parts.includes('hant')) return 'zh-Hant'
    if (parts.includes('hans')) return 'zh'
    return parts.some((p) => p === 'tw' || p === 'hk' || p === 'mo') ? 'zh-Hant' : 'zh'
  }
  if (tag === 'en' || tag.startsWith('en-')) return 'en'
  return undefined
}

/** Parse `Accept-Language`; the first supported language by weight. */
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

/** A piece of built-in text: Simplified Chinese is the source, the other languages are optional. */
export type Localized = { zh: string } & Partial<Record<TranslatedLocale, string>>

export function pick(text: Localized, locale: Locale): string {
  return text[locale] ?? text.zh
}
