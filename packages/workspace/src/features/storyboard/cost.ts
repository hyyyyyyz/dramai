import type { PreflightResult } from '@dramai/api'

export type Totals = PreflightResult['totals']

/** 预估费用：币种分开统计；用户设置了折算才有合计。永远只是估算，不是账单。查不到单价的写“未定价”，不猜。 */
export function costHeadline(
  totals: Totals,
  money: (amount: number, currency: string) => string,
): string | undefined {
  if (totals.converted) {
    const c = totals.converted
    return `${c.approx ? '≈ ' : ''}${money(c.amount, c.currency)}`
  }
  const parts = Object.entries(
    Object.keys(totals.remaining).length === 0 ? totals.byCurrency : totals.remaining,
  ).map(([cur, v]) => `${v.approx ? '≈ ' : ''}${money(v.amount, cur)}`)
  return parts.length > 0 ? parts.join(' + ') : undefined
}
