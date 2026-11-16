export const REDACTED = '[redacted]'

/**
 * 短于这个长度的"凭据"不处理。真实的 API Key 和令牌都远长于此；而一两个字符的串（`o`、`ok`）在正常文字里随处可见，
 * 替换它只会弄坏输出。代价：上游回显一个这么短的串时不会被去掉——这样的串不是凭据。
 */
export const MIN_REDACTED_LENGTH = 8

const jsonInner = (s: string) => JSON.stringify(s).slice(1, -1)
const unicodeEscaped = (s: string, upper: boolean) =>
  s.replace(/[^\x20-\x7e]/g, (c) => {
    const hex = c.charCodeAt(0).toString(16).padStart(4, '0')
    return `\\u${upper ? hex.toUpperCase() : hex}`
  })
const htmlEscaped = (s: string, quote: '&#39;' | '&#x27;') =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, quote)

/**
 * 一个凭据在文本里可能出现的写法：原样；URL 编码（含表单的 `+`）；JSON 字符串里的转义（`\"`、`\\`、PHP 式的 `\/`、
 * `\uXXXX`，大小写两种十六进制）；HTML 转义；base64 / base64url（带或不带 `=`）。
 * 边界：只认**整个凭据**的这些写法；被截断的回显（只露出一部分）、拆成几段的回显、再套一层别的编码的，不做猜测。
 */
function forms(secrets: ReadonlyArray<string | undefined>): string[] {
  const out = new Set<string>()
  for (const s of secrets) {
    if (!s || s.length < MIN_REDACTED_LENGTH) continue
    out.add(s)
    const url = encodeURIComponent(s)
    out.add(url)
    out.add(url.replace(/%20/g, '+'))
    const json = jsonInner(s)
    for (const base of [json, s]) {
      for (const slash of [false, true]) {
        const v = slash ? base.replace(/\//g, '\\/') : base
        out.add(v)
        out.add(unicodeEscaped(v, false))
        out.add(unicodeEscaped(v, true))
      }
    }
    out.add(htmlEscaped(s, '&#39;'))
    out.add(htmlEscaped(s, '&#x27;'))
    const b64 = Buffer.from(s, 'utf8').toString('base64')
    for (const v of [b64, b64.replace(/=+$/, '')]) {
      out.add(v)
      out.add(v.replace(/\+/g, '-').replace(/\//g, '_'))
    }
  }
  out.delete('')
  // 长的写法先换，免得一个写法被另一个写法的一部分抢先替换掉
  return [...out].sort((a, b) => b.length - a.length)
}

/** 把文本里出现的凭据（API Key、访问令牌……）替换成 `[redacted]`。没有凭据 / 没出现时原样返回。 */
export function redactText(text: string, secrets: ReadonlyArray<string | undefined>): string {
  let out = text
  for (const f of forms(secrets)) if (out.includes(f)) out = out.split(f).join(REDACTED)
  return out
}

/**
 * 对一个 JSON 形的值里**所有字符串值**做 `redactText`（字段名不动）。用在"整份来自上游的数据"上：上游响应体、流里的事件——
 * 这些里的每个字符串（错误信息、错误码、错误类型、状态、失败原因……）都可能回显凭据。没有凭据 / 没出现时原样返回同一个对象。
 */
export function redactStrings<T>(value: T, secrets: ReadonlyArray<string | undefined>): T {
  if (forms(secrets).length === 0) return value
  return JSON.parse(JSON.stringify(value), (_k, v) =>
    typeof v === 'string' ? redactText(v, secrets) : v,
  ) as T
}

/**
 * 对一个 JSON 形的值里、名字在 `fields` 里的字符串**值**做 `redactText`（返回新值；没有凭据时原样返回同一个对象）。
 * 只动给人看的文字字段（`error` / `reason` / `message`）的值：字段名，以及 `outcome`、`code` 这类服务端自己生成的
 * 结构 / 枚举字段永远不碰，所以无论凭据是什么，结果的结构都不会被改坏。
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
