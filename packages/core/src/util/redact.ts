export const REDACTED = '[redacted]'

/**
 * 短于这个长度的"凭据"不处理：真实的 API Key 和令牌都远长于此；一两个字符的串（测试里的 `k`）在正常文字里
 * 随处可见，替换它只会弄坏输出（"ok" 变成 "o[redacted]"）。
 */
export const MIN_REDACTED_LENGTH = 6

/** 一个凭据在文本里可能出现的写法：原样、URL 编码、JSON 字符串里的转义。 */
function forms(secrets: ReadonlyArray<string | undefined>): string[] {
  const out = new Set<string>()
  for (const s of secrets) {
    if (!s || s.length < MIN_REDACTED_LENGTH) continue
    out.add(s)
    out.add(encodeURIComponent(s))
    out.add(JSON.stringify(s).slice(1, -1))
  }
  out.delete('')
  return [...out]
}

/** 把文本里出现的凭据（API Key、访问令牌……）替换成 `[redacted]`。没有凭据 / 没出现时原样返回。 */
export function redactText(text: string, secrets: ReadonlyArray<string | undefined>): string {
  let out = text
  for (const f of forms(secrets)) if (out.includes(f)) out = out.split(f).join(REDACTED)
  return out
}

/**
 * 对一个 JSON 形的值里、名字在 `fields` 里的字符串字段做 `redactText`（返回新值；没有凭据时原样返回同一个对象）。
 * 只动给人看的文字字段（`error` / `reason` / `message`），`outcome`、`code` 这类结构字段永远不碰。
 */
export function redactFields<T>(
  value: T,
  secrets: ReadonlyArray<string | undefined>,
  fields: readonly string[],
): T {
  if (forms(secrets).length === 0) return value
  return JSON.parse(JSON.stringify(value), (k, v) =>
    typeof v === 'string' && fields.includes(k) ? redactText(v, secrets) : v,
  ) as T
}

/** 测试连接 / 探测结果里给人看的文字字段。 */
export const RESULT_TEXT_FIELDS = ['error', 'reason', 'message'] as const
