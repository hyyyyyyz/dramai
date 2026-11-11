export type RangeResult =
  | { kind: 'none' }
  | { kind: 'ok'; start: number; end: number }
  | { kind: 'unsatisfiable' }

/**
 * 解析 `Range: bytes=...`（RFC 9110）。只支持单区间；多区间当作没有 Range（回完整内容，合规）。
 * - `bytes=a-b`、`bytes=a-`（到结尾）、`bytes=-n`（最后 n 字节）
 * - 起点越界 → unsatisfiable（416）；终点越界 → 截到文件末尾。
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: 'none' }
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return { kind: 'none' }
  const a = m[1] ?? ''
  const b = m[2] ?? ''
  if (a === '' && b === '') return { kind: 'none' }
  if (a === '') {
    const n = Number(b)
    if (n === 0 || size === 0) return { kind: 'unsatisfiable' }
    return { kind: 'ok', start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(a)
  if (start >= size) return { kind: 'unsatisfiable' }
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  if (end < start) return { kind: 'none' } // 语法上无效的区间要忽略，而不是 416
  return { kind: 'ok', start, end }
}
