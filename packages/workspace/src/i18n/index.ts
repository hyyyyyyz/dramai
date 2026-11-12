import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './locales/zh-CN'

/**
 * 国际化：所有用户可见的文字都走这里，zh-CN、zh-TW（繁體中文）与 en 三套同时完整。
 * zh-CN 是类型的来源（键的提示和检查）；en 是否补全由 tests/i18n.test.ts 逐键核对。
 * 英文的复数写成 `key_one` / `key_other`，中文没有复数，只写 `key`。
 */
export const LOCALES = ['zh-CN', 'zh-TW', 'en'] as const
export type Locale = (typeof LOCALES)[number]

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof zhCN }
  }
}

const KEY = 'dramai.locale'

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'zh-CN' || saved === 'zh-TW' || saved === 'en') return saved
  } catch {
    /* 存储不可用 */
  }
  const langs =
    typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : []
  for (const l of langs) {
    const lower = l?.toLowerCase() ?? ''
    // 繁体：zh-TW / zh-HK / zh-MO / zh-Hant；其余中文按简体
    if (/^zh-(tw|hk|mo|hant)/.test(lower)) return 'zh-TW'
    if (lower.startsWith('zh')) return 'zh-CN'
    if (l?.toLowerCase().startsWith('en')) return 'en'
  }
  return 'zh-CN'
}

/**
 * zh-CN 是回退语言，随主包；其余语言的文案按需下载（切换时才加载），首屏不背着用不到的两套。
 */
const loaders: Record<Exclude<Locale, 'zh-CN'>, () => Promise<{ default: object }>> = {
  'zh-TW': () => import('./locales/zh-TW'),
  en: () => import('./locales/en'),
}

async function ensureLoaded(locale: Locale) {
  if (locale === 'zh-CN' || i18n.hasResourceBundle(locale, 'translation')) return
  const mod = await loaders[locale]()
  i18n.addResourceBundle(locale, 'translation', mod.default, true, true)
}

export async function initI18n(locale: Locale = detectLocale()) {
  await i18n.use(initReactI18next).init({
    resources: { 'zh-CN': { translation: zhCN } },
    lng: locale,
    fallbackLng: 'zh-CN',
    // 键里有冒号（aspect.9:16），所以不能把 ':' 当命名空间分隔符
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  await ensureLoaded(locale)
  await i18n.changeLanguage(locale)
  document.documentElement.lang = locale
  return i18n
}

export async function setLocale(locale: Locale) {
  await ensureLoaded(locale)
  await i18n.changeLanguage(locale)
  document.documentElement.lang = locale
  try {
    localStorage.setItem(KEY, locale)
  } catch {
    /* 存储不可用 */
  }
}

export { i18n }
