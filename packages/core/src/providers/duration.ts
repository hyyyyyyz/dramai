import type { DurationRule } from './types.ts'

/**
 * 时长归一：把请求的秒数落到模型允许的档位上。
 * 离散档位取最近的，距离相同取较短的（省钱）；范围取夹取后的整数。
 * 没有规则 = 原样返回（四舍五入到整数秒）。
 */
export function snapDuration(requested: number, rule: DurationRule | number[] | undefined): number {
  const wanted = Number.isFinite(requested) && requested > 0 ? requested : 5
  if (!rule) return Math.round(wanted)
  const values = Array.isArray(rule) ? rule : rule.values
  if (values && values.length > 0) {
    let best = values[0]
    let bestDiff = Math.abs(wanted - best)
    for (const v of values) {
      const diff = Math.abs(wanted - v)
      if (diff < bestDiff || (diff === bestDiff && v < best)) {
        best = v
        bestDiff = diff
      }
    }
    return best
  }
  const min = !Array.isArray(rule) && rule.min !== undefined ? rule.min : 1
  const max = !Array.isArray(rule) && rule.max !== undefined ? rule.max : Number.POSITIVE_INFINITY
  return Math.min(max, Math.max(min, Math.round(wanted)))
}

export function isDurationAllowed(seconds: number, rule: DurationRule | undefined): boolean {
  if (!rule) return true
  if (rule.values) return rule.values.includes(seconds)
  if (rule.min !== undefined && seconds < rule.min) return false
  if (rule.max !== undefined && seconds > rule.max) return false
  return true
}
