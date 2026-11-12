import type { AppSettings } from '@dramai/api'

/**
 * 费用折算的草稿：目标币种 + 每个来源币种“1 单位折合多少目标币种”。
 * 没填汇率的币种保持原样显示，不猜（服务端也是这样）。
 */
export interface ConversionDraft {
  enabled: boolean
  target: string
  rows: { currency: string; rate: string }[]
}

type Conversion = NonNullable<AppSettings['cost']['conversion']>

export const emptyDraft: ConversionDraft = { enabled: false, target: 'CNY', rows: [] }

export function draftOf(conv: Conversion | undefined): ConversionDraft {
  if (!conv) return emptyDraft
  return {
    enabled: true,
    target: conv.targetCurrency,
    rows: Object.entries(conv.rates).map(([currency, rate]) => ({ currency, rate: String(rate) })),
  }
}

const CODE = /^[A-Za-z][A-Za-z0-9_]{1,11}$/

export type DraftProblem = 'target' | 'currency' | 'rate' | 'duplicate'

/** 返回第一个问题和它在第几行（目标币种没有行号）；没问题返回 undefined。 */
export function draftProblem(d: ConversionDraft): { kind: DraftProblem; row?: number } | undefined {
  if (!d.enabled) return undefined
  if (!CODE.test(d.target.trim())) return { kind: 'target' }
  const seen = new Set<string>()
  for (const [i, r] of d.rows.entries()) {
    const c = r.currency.trim().toUpperCase()
    if (!CODE.test(c)) return { kind: 'currency', row: i }
    if (seen.has(c) || c === d.target.trim().toUpperCase()) return { kind: 'duplicate', row: i }
    seen.add(c)
    const n = Number(r.rate)
    if (r.rate.trim() === '' || !Number.isFinite(n) || n <= 0) return { kind: 'rate', row: i }
  }
  return undefined
}

export function conversionOf(d: ConversionDraft): Conversion | undefined {
  if (!d.enabled || draftProblem(d)) return undefined
  return {
    targetCurrency: d.target.trim().toUpperCase(),
    rates: Object.fromEntries(d.rows.map((r) => [r.currency.trim().toUpperCase(), Number(r.rate)])),
  }
}

export const sameConversion = (a: Conversion | undefined, b: Conversion | undefined): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
