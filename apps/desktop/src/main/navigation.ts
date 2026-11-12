import { originOf } from './auth.ts'

/** 是不是应用自己的来源。比较解析后的来源，不比字符串前缀（`http://127.0.0.1:1234.evil.com` 不算）。 */
export function isAppUrl(url: string, appOrigins: ReadonlySet<string>): boolean {
  const origin = originOf(url)
  return origin !== undefined && appOrigins.has(origin)
}

/** 外部链接交给系统浏览器的条件：只放行 http(s) 和 mailto，其他协议（file:、javascript:、自定义协议）一律不打开。 */
export function canOpenExternally(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:'
  } catch {
    return false
  }
}

/** 渲染进程发来的 IPC，发送者必须是应用自己的页面。 */
export function isTrustedSender(frameUrl: string, appOrigins: ReadonlySet<string>): boolean {
  return isAppUrl(frameUrl, appOrigins)
}
