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

/**
 * 额外请求头不能覆盖的头。比较不分大小写。
 * - 鉴权头；
 * - 内容类型头、协议必需的版本头；
 * - 传输层的头（`Host`、`Content-Length`、`Transfer-Encoding`、`Connection`）：由 fetch 按请求体自己算，
 *   填错会让请求直接失败；
 * - `Cookie`、`Proxy-Authorization`：不应该由"额外请求头"带出去。
 */
export const PROTECTED_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'x-api-key',
  'x-goog-api-key',
  'x-key',
  'api-key',
  'content-type',
  'content-length',
  'transfer-encoding',
  'connection',
  'host',
  'anthropic-version',
])

/**
 * 把配置里的额外请求头合进去（例如 Anthropic 的 `anthropic-workspace-id`）。鉴权头、内容类型头、版本头
 * 不能被覆盖（静默忽略）；值必须是字符串，名字不能带空白或换行。
 */
export function mergeHeaders(
  base: Record<string, string>,
  extra: Record<string, string> | undefined,
): Record<string, string> {
  const out = { ...base }
  if (!extra) return out
  for (const [name, value] of Object.entries(extra)) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9-]+$/.test(name)) continue
    if (/[\r\n]/.test(value)) continue
    if (PROTECTED_HEADERS.has(name.toLowerCase())) continue
    out[name] = value
  }
  return out
}
