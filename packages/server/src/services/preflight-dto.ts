import { convertTotals } from '@dramai/core'
import type { BatchAdmission, CostDisplaySettings, CostTotals, TargetVerdict } from '@dramai/core'
import type { PreflightResult, Verdict } from '@dramai/api'

/** 费用合计 → 响应形状：原始币种分开列出；用户设置了折算才附带折算后的合计。永远只是估算。 */
export function toCostSummary(
  totals: CostTotals,
  settings?: CostDisplaySettings,
): PreflightResult['totals'] {
  const conv = convertTotals(totals, settings)
  return {
    byCurrency: totals.byCurrency,
    unpriced: totals.unpriced,
    ...(conv.converted ? { converted: conv.converted } : {}),
    remaining: conv.remaining,
    isEstimate: true,
  }
}

/** 准入结论 → 响应形状（不带解析后的输入：那里有路径和长文本）。 */
export function toVerdict(v: TargetVerdict): Verdict {
  return {
    targetId: v.targetId,
    status: v.status,
    reasons: v.reasons,
    warnings: v.warnings,
    unverified: v.unverified,
    ...(v.blockedBy ? { blockedBy: v.blockedBy } : {}),
    ...(v.estimate ? { estimate: v.estimate } : {}),
  }
}

export function toPreflight(
  admission: BatchAdmission,
  totals: CostTotals,
  settings?: CostDisplaySettings,
): PreflightResult {
  return {
    ok: admission.ok,
    results: admission.results.map(toVerdict),
    totals: toCostSummary(totals, settings),
  }
}
