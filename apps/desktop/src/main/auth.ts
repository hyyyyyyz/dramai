/**
 * 窗口怎么通过服务的令牌校验——令牌不出现在任何地址里，页面的脚本也读不到它：
 * 主进程在窗口所属的会话里拦截发往“应用自己那个来源”的请求，补上 `Authorization: Bearer`。
 * 其他来源的请求（外部网站、别的本地端口）不带令牌。
 */

export function originOf(url: string): string | undefined {
  try {
    const u = new URL(url)
    return u.origin === 'null' ? undefined : u.origin
  } catch {
    return undefined
  }
}

/** 给一次请求的头补上令牌；不是应用来源的请求原样返回。 */
export function withAuthHeader(
  url: string,
  headers: Record<string, string | string[]>,
  appOrigins: ReadonlySet<string>,
  token: string,
): Record<string, string | string[]> {
  const origin = originOf(url)
  if (!origin || !appOrigins.has(origin)) return headers
  return { ...headers, Authorization: `Bearer ${token}` }
}
