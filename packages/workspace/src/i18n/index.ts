import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './locales/zh-CN'
import en from './locales/en'

/**
 * 国际化：所有用户可见的文字都走这里，zh-CN 与 en 两套同时完整。
 * zh-CN 是类型的来源（键的提示和检查）；en 是否补全由 tests/i18n.test.ts 逐键核对。
 * 英文的复数写成 `key_one` / `key_other`，中文没有复数，只写 `key`。
 */
export const LOCALES = ['zh-CN', 'en'] as const
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
    if (saved === 'zh-CN' || saved === 'en') return saved
  } catch {
    /* 存储不可用 */
  }
  const langs =
    typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : []
  for (const l of langs) {
    if (l?.toLowerCase().startsWith('zh')) return 'zh-CN'
    if (l?.toLowerCase().startsWith('en')) return 'en'
  }
  return 'zh-CN'
}

export async function initI18n(locale: Locale = detectLocale()) {
  await i18n.use(initReactI18next).init({
    resources: { 'zh-CN': { translation: zhCN }, en: { translation: en } },
    lng: locale,
    fallbackLng: 'zh-CN',
    // 键里有冒号（aspect.9:16），所以不能把 ':' 当命名空间分隔符
    nsSeparator: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  document.documentElement.lang = locale
  return i18n
}

export async function setLocale(locale: Locale) {
  await i18n.changeLanguage(locale)
  document.documentElement.lang = locale
  try {
    localStorage.setItem(KEY, locale)
  } catch {
    /* 存储不可用 */
  }
}

export { i18n }
