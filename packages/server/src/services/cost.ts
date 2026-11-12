import type { PreflightResult } from '@dramai/api'
import { convertTotals, totalCosts } from '@dramai/core'
import type { CostDisplaySettings, CostEstimate } from '@dramai/core'

/**
 * 把一组费用估算汇总成接口里的 `CostSummary`：
 * - 按服务商原始币种分开累加（不同币种不相加）；
 * - 没有单价的条目只计数（`unpriced`），金额里不猜；
 * - 用户设置了折算（`cost.conversion`）才给 `converted`，没有汇率的币种留在 `remaining`；
 * - 永远是估算（`isEstimate: true`），不是账单。
 */
type CostSummary = PreflightResult['totals']

export function summarizeCosts(
  estimates: readonly CostEstimate[],
  display?: CostDisplaySettings,
): CostSummary {
  const totals = totalCosts(estimates)
  const conv = convertTotals(totals, display)
  return {
    byCurrency: totals.byCurrency,
    unpriced: totals.unpriced,
    ...(conv.converted ? { converted: conv.converted } : {}),
    remaining: conv.remaining,
    isEstimate: true,
  }
}
