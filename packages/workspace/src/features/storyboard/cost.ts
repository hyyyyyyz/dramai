import type { PreflightResult } from '@dramai/api'

export type Totals = PreflightResult['totals']

/** 预估费用：币种分开统计；用户设置了折算才有合计。永远只是估算，不是账单。查不到单价的写“未定价”，不猜。 */
export function costHeadline(
  totals: Totals,
  money: (amount: number, currency: string) => string,
): string | undefined {
  if (totals.converted) {
    const c = totals.converted
    return amountText(c, c.currency, money)
  }
  const parts = Object.entries(
    Object.keys(totals.remaining).length === 0 ? totals.byCurrency : totals.remaining,
  ).map(([cur, v]) => amountText(v, cur, money))
  return parts.length > 0 ? parts.join(' + ') : undefined
}

/** "≈ ¥0.40 – ¥0.80" for a range (speech priced by characters, where a Chinese character may count as 2), else one amount. */
function amountText(
  v: { amount: number; range?: [number, number]; approx: boolean },
  currency: string,
  money: (amount: number, currency: string) => string,
): string {
  const approx = v.approx ? '≈ ' : ''
  return v.range
    ? `${approx}${money(v.range[0], currency)} – ${money(v.range[1], currency)}`
    : `${approx}${money(v.amount, currency)}`
}

/** Does any total in the estimate come as a range? */
export function hasRange(totals: Totals): boolean {
  return (
    Boolean(totals.converted?.range) ||
    Object.values(totals.byCurrency).some((v) => v.range) ||
    Object.values(totals.remaining).some((v) => v.range)
  )
}
