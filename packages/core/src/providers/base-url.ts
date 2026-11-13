/**
 * 服务商接口地址的校验。**只在写入时做**（创建、按预设创建、`providers.update` 改了地址）；
 * 已经存在库里的旧配置不会因为规则收紧而读不出来、也不会在读取时被拦。
 *
 * - `placeholders`：地址里还有没替换的 `{名字}`（预设里的 `{WorkspaceId}` 之类），也识别百分号编码的花括号
 *   （`%7BWorkspaceId%7D`）——不能用；
 * - `invalid`：不是合法 URL、不是 http / https、带用户名密码、带空白、**带查询串或片段**
 *   （`?x=1` / `#frag`：协议会在地址后面拼路径，拼出来的请求路径是错的）；
 * - `insecure`：明文 http 只允许发往本机或局域网（回环地址、私有 IPv4 段、`.local` / `.lan` / `.internal` 名字、
 *   不带点的主机名如 `ollama-box`）；发往公网的必须 https。**链路本地地址（`169.254.0.0/16`、`fe80::/10`，
 *   含云厂商的元数据地址 `169.254.169.254`）不算"局域网"**，明文 http 一律拒绝。
 */
export type BaseUrlProblem =
  | { code: 'BASE_URL_PLACEHOLDER_UNFILLED'; message: string; placeholders: string[] }
  | { code: 'BASE_URL_INVALID'; message: string }
  | { code: 'BASE_URL_INSECURE'; message: string }

export type BaseUrlCheck = { ok: true; url: string } | ({ ok: false } & BaseUrlProblem)

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10（CGNAT / Tailscale）
]

/** http 明文可以去的主机：本机和局域网。 */
export function isLocalNetworkHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || h.endsWith('.localhost')) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return PRIVATE_V4.some((re) => re.test(h))
  // IPv6 唯一本地地址（fc00::/7）；链路本地 fe80::/10 不算（含云元数据地址）。AWS 的 IPv6 元数据地址 fd00:ec2::254 同样排除。
  if (h.includes(':')) return /^f[cd]/.test(h) && h !== 'fd00:ec2::254'
  if (/\.(local|lan|internal|home\.arpa)$/.test(h)) return true
  return !h.includes('.') // 单标签主机名（局域网里常见）
}

export function checkBaseUrl(input: string): BaseUrlCheck {
  const url = input.trim()
  // 百分号编码的花括号也算占位符（`%7BWorkspaceId%7D`），否则浏览器 / 复制粘贴编码过的地址会漏过检查
  const decoded = url.replace(/%7B/gi, '{').replace(/%7D/gi, '}')
  const placeholders = [...decoded.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]!)
  if (placeholders.length > 0) {
    return {
      ok: false,
      code: 'BASE_URL_PLACEHOLDER_UNFILLED',
      message: `接口地址里还有没替换的占位符：${placeholders.map((p) => `{${p}}`).join('、')}`,
      placeholders,
    }
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, code: 'BASE_URL_INVALID', message: '接口地址不是合法的网址' }
  }
  if (/\s/.test(url))
    return { ok: false, code: 'BASE_URL_INVALID', message: '接口地址里不能有空白' }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      code: 'BASE_URL_INVALID',
      message: '接口地址必须以 http:// 或 https:// 开头',
    }
  }
  if (url.includes('?') || url.includes('#')) {
    return {
      ok: false,
      code: 'BASE_URL_INVALID',
      message: '接口地址里不能带查询串（?…）或片段（#…）：请求路径会拼在地址后面',
    }
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      code: 'BASE_URL_INVALID',
      message: '接口地址里不能带用户名和密码（Key 请填在 API Key 里）',
    }
  }
  if (!parsed.hostname)
    return { ok: false, code: 'BASE_URL_INVALID', message: '接口地址缺少主机名' }
  if (parsed.protocol === 'http:' && !isLocalNetworkHost(parsed.hostname)) {
    return {
      ok: false,
      code: 'BASE_URL_INSECURE',
      message: '明文 http 只能用于本机或局域网的服务；发往公网的地址请用 https',
    }
  }
  return { ok: true, url }
}
