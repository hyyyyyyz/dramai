import { describe, expect, it } from 'vitest'
import zh from '@/i18n/locales/zh-CN'
import en from '@/i18n/locales/en'
import { formatChars, formatDuration, formatMoney, formatUpdated } from '@/i18n/format'
import { createInstance } from 'i18next'

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

describe('locale-aware formatting', () => {
  const t = async (lng: 'zh-CN' | 'en') => {
    const i = createInstance()
    await i.init({
      lng,
      resources: { 'zh-CN': { translation: zh }, en: { translation: en } },
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
