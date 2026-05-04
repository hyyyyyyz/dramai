import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import zhCN from '@/i18n/locales/zh-CN.json'
import en from '@/i18n/locales/en.json'

export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const LOCALE_LABEL: Record<SupportedLocale, string> = {
  'zh-CN': '中文',
  en: 'English',
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      en: { translation: en },
    },
    fallbackLng: 'zh-CN',
    supportedLngs: SUPPORTED_LOCALES,
    interpolation: { escapeValue: false },
    detection: {
      // 优先用 localStorage 持久的 dramai-locale；否则按浏览器语言；无匹配 fallback 中文。
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'dramai-locale',
      caches: ['localStorage'],
    },
  })

export default i18n
