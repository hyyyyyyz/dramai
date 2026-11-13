/**
 * 发给服务端的语言：服务端认 `zh`（简体）、`zh-Hant`（繁体）、`en`。繁体界面如果也发 `zh`，目录里的厂商名、预设名、
 * 已知限制就都是简体，而且简繁之间切换时请求头不变、不会重新取数。
 */
export function apiLocaleOf(language: string): 'zh' | 'zh-Hant' | 'en' {
  if (language === 'zh-TW') return 'zh-Hant'
  return language.startsWith('zh') ? 'zh' : 'en'
}
