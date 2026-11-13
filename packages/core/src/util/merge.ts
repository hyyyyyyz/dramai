/** 深合并：对象逐层合并，数组和标量整体覆盖。`extra` 里值为 undefined 的键忽略。返回新对象。 */
export function deepMerge(
  base: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
  protectedKeys: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  if (!extra) return out
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || protectedKeys.includes(key)) continue
    const cur = out[key]
    if (isPlain(value) && isPlain(cur)) out[key] = deepMerge(cur, value)
    else out[key] = value
  }
  return out
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
