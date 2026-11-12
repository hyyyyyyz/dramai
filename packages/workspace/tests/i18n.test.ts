import { afterEach, describe, expect, it, vi } from 'vitest'
import zh from '@/i18n/locales/zh-CN'
import zhTW from '@/i18n/locales/zh-TW'
import en from '@/i18n/locales/en'
import { formatChars, formatDuration, formatMoney, formatUpdated } from '@/i18n/format'
import { createInstance } from 'i18next'
import { detectLocale } from '@/i18n'

type Dict = { [k: string]: string | Dict }
function flatten(d: Dict, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(d)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[key] = v
    else Object.assign(out, flatten(v, key))
  }
  return out
}
const PLURAL = /_(zero|one|two|few|many|other)$/
const base = (k: string) => k.replace(PLURAL, '')
const params = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort()

const zhFlat = flatten(zh as Dict)
const enFlat = flatten(en as Dict)
const twFlat = flatten(zhTW as Dict)

describe('both languages are complete', () => {
  it('en has every zh-CN key and nothing extra (plural suffixes aside)', () => {
    const zhKeys = new Set(Object.keys(zhFlat))
    const enBases = new Set(Object.keys(enFlat).map(base))
    expect([...zhKeys].filter((k) => !enBases.has(k))).toEqual([])
    expect([...enBases].filter((k) => !zhKeys.has(k))).toEqual([])
  })

  it('plural keys come in complete pairs', () => {
    const ones = Object.keys(enFlat).filter((k) => k.endsWith('_one'))
    for (const k of ones)
      expect(enFlat, `${k} has no _other`).toHaveProperty(k.replace(/_one$/, '_other'))
  })

  it('interpolation parameters match between languages', () => {
    for (const [k, v] of Object.entries(enFlat)) {
      const zhV = zhFlat[base(k)]
      expect(zhV, `zh-CN missing ${base(k)}`).toBeDefined()
      const zhP = new Set(params(zhV!))
      // count 只在英文复数里出现；其余参数两边必须一致
      const enP = [...new Set(params(v))].filter((p) => p !== 'count').sort()
      const zhNoCount = [...zhP].filter((p) => p !== 'count').sort()
      expect(enP, k).toEqual(zhNoCount)
    }
  })

  it('no entry is empty, and neither language leaks the other’s script into the UI strings', () => {
    for (const [k, v] of Object.entries(zhFlat)) expect(v.trim(), k).not.toBe('')
    for (const [k, v] of Object.entries(enFlat)) {
      expect(v.trim(), k).not.toBe('')
      // 英文界面不应有汉字（引号、符号除外）
      expect(/[一-鿿]/.test(v), `Chinese characters in en: ${k}`).toBe(false)
    }
  })
})

describe('Traditional Chinese follows the Simplified source exactly', () => {
  it('has the same keys and the same interpolation parameters', () => {
    expect(Object.keys(twFlat).sort()).toEqual(Object.keys(zhFlat).sort())
    for (const [k, v] of Object.entries(twFlat)) expect(params(v), k).toEqual(params(zhFlat[k]!))
  })

  it('is actually Traditional: the common Simplified-only forms are gone', () => {
    // 这些字在繁体里有不同的写法；出现就说明漏转了
    const simplifiedOnly = /[项视频务库传设图镜时这个们]/
    for (const [k, v] of Object.entries(twFlat)) {
      // 允许保留“简体中文”这类写着简体的文字
      const text = v.replace(/简体中文/g, '')
      expect(simplifiedOnly.test(text), `Simplified characters in zh-TW: ${k} = ${v}`).toBe(false)
    }
  })
})

describe('locale-aware formatting', () => {
  const t = async (lng: 'zh-CN' | 'zh-TW' | 'en') => {
    const i = createInstance()
    await i.init({
      lng,
      resources: {
        'zh-CN': { translation: zh },
        'zh-TW': { translation: zhTW },
        en: { translation: en },
      },
      nsSeparator: false,
      interpolation: { escapeValue: false },
    })
    return i.t.bind(i)
  }

  it('durations', async () => {
    const zhT = await t('zh-CN')
    const enT = await t('en')
    expect(formatDuration(zhT, 72_000)).toBe('1 分 12 秒')
    expect(formatDuration(enT, 72_000)).toBe('1 min 12 s')
    expect(formatDuration(zhT, 6_000)).toBe('6 秒')
    expect(formatDuration(enT, 3_900_000)).toBe('1 h 5 min')
  })

  it('character counts', async () => {
    const zhT = await t('zh-CN')
    const enT = await t('en')
    expect(formatChars('zh-CN', zhT, 36_000)).toBe('约 3.6 万字')
    expect(formatChars('zh-CN', zhT, 2_100)).toBe('约 2 千字')
    expect(formatChars('zh-CN', zhT, 580)).toBe('580 字')
    const twT = await t('zh-TW')
    expect(formatChars('zh-TW', twT, 36_000)).toBe('約 3.6 萬字')
    expect(formatChars('zh-TW', twT, 2_100)).toBe('約 2 千字')
    expect(formatChars('en', enT, 36_000)).toBe('~36K chars')
    expect(formatChars('en', enT, 580)).toBe('580 chars')
  })

  it('money: ISO currencies via Intl, provider points as "amount unit"', () => {
    expect(formatMoney('en', 12.5, 'USD')).toBe('$12.50')
    expect(formatMoney('zh-CN', 12.5, 'CNY')).toMatch(/¥12\.50/)
    expect(formatMoney('en', 0.035, 'PTC')).toBe('0.035 PTC')
  })

  it('"updated" says today / yesterday in the user’s language', () => {
    const now = new Date(2026, 10, 11, 15, 0).getTime()
    expect(formatUpdated('zh-CN', new Date(2026, 10, 11, 14, 32).getTime(), now)).toMatch(
      /^今天 .*14:32/,
    )
    expect(formatUpdated('zh-CN', new Date(2026, 10, 10, 21, 7).getTime(), now)).toMatch(
      /^昨天 .*21:07/,
    )
    expect(formatUpdated('en', new Date(2026, 10, 11, 14, 32).getTime(), now)).toMatch(/^today /)
    expect(formatUpdated('en', new Date(2026, 10, 10, 21, 7).getTime(), now)).toMatch(/^yesterday /)
    expect(formatUpdated('en', new Date(2026, 10, 3, 12, 0).getTime(), now)).toBe('November 3')
  })
})

describe('picking the starting language', () => {
  afterEach(() => vi.restoreAllMocks())
  const withBrowser = (langs: string[]) => {
    try {
      localStorage.removeItem('dramai.locale')
    } catch {
      /* 存储不可用 */
    }
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(langs)
  }
  it('Traditional Chinese browsers start in Traditional Chinese, other Chinese in Simplified, English in English', () => {
    withBrowser(['zh-TW', 'en'])
    expect(detectLocale()).toBe('zh-TW')
    withBrowser(['zh-HK'])
    expect(detectLocale()).toBe('zh-TW')
    withBrowser(['zh-Hant-TW'])
    expect(detectLocale()).toBe('zh-TW')
    withBrowser(['zh-CN'])
    expect(detectLocale()).toBe('zh-CN')
    withBrowser(['zh'])
    expect(detectLocale()).toBe('zh-CN')
    withBrowser(['en-US'])
    expect(detectLocale()).toBe('en')
  })
})
