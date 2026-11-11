import { createHash, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { HttpError } from './errors.ts'

/**
 * 本地服务的安全边界（REFACTOR_PLAN 4.2）。
 *
 * 1. 默认只监听 127.0.0.1。
 * 2. 校验 Host 头：防 DNS rebinding（恶意网页把自己的域名解析到 127.0.0.1 再来读你的数据）。
 * 3. 不开 CORS：不发任何 Access-Control-*；跨站的写请求（Origin 与 Host 不同）直接拒绝。
 * 4. 监听非回环地址必须有 token；token 也可以在回环模式下启用（桌面版每次启动随机生成）。
 */

export const TOKEN_COOKIE = 'dramai_token'

const LOOPBACK_BIND = new Set(['127.0.0.1', '::1', 'localhost', '[::1]'])

export function isLoopbackBind(host: string): boolean {
  return LOOPBACK_BIND.has(host.toLowerCase()) || /^127(?:\.\d{1,3}){3}$/.test(host)
}

/** 从 Host 头里取出主机名（去端口；IPv6 去括号）。 */
export function hostnameOf(hostHeader: string): string | undefined {
  const h = hostHeader.trim().toLowerCase()
  if (!h) return undefined
  if (h.startsWith('[')) {
    const end = h.indexOf(']')
    return end > 0 ? h.slice(1, end) : undefined
  }
  const colon = h.lastIndexOf(':')
  const name = colon === -1 ? h : h.slice(0, colon)
  return name || undefined
}

const isIpLiteral = (name: string): boolean =>
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(name) || name.includes(':')

const isLoopbackName = (name: string): boolean =>
  name === 'localhost' ||
  name.endsWith('.localhost') ||
  name === '::1' ||
  /^127(?:\.\d{1,3}){3}$/.test(name)

export interface SecurityOptions {
  /** 实际绑定的地址。 */
  host: string
  /** 访问令牌；为空表示不启用（仅允许回环绑定）。 */
  token?: string
  /** 额外允许出现在 Host 头里的主机名（例如反向代理的域名）。 */
  allowedHosts?: string[]
}

export class TokenRequiredError extends Error {
  constructor(host: string) {
    super(
      `监听 ${host}（非回环地址）必须提供 token（createServer({ token })）；否则同一网络里的任何人都能读写你的项目`,
    )
    this.name = 'TokenRequiredError'
  }
}

/** 常数时间比较（先哈希，长度不泄露）。 */
export function tokensEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim())
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

export function extractToken(c: Context): string | undefined {
  const auth = c.req.header('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  const x = c.req.header('x-dramai-token')
  if (x) return x.trim()
  return readCookie(c.req.header('cookie'), TOKEN_COOKIE)
}

export interface Security {
  readonly tokenRequired: boolean
  /** 校验 Host 头；通过则放行。 */
  hostGuard: MiddlewareHandler
  /** 非 GET/HEAD 与 SSE：Origin（若有）必须与 Host 同源；Sec-Fetch-Site 为 cross-site 一律拒绝。 */
  originGuard: MiddlewareHandler
  /** token 校验，并处理 `?token=` 引导（写 cookie 后重定向到去掉 token 的地址）。 */
  authGuard: MiddlewareHandler
}

export function createSecurity(options: SecurityOptions): Security {
  const token = options.token?.trim() || undefined
  if (!isLoopbackBind(options.host) && !token) throw new TokenRequiredError(options.host)
  if (token && token.length < 16) {
    throw new Error(
      'token 太短：至少 16 个字符（建议 crypto.randomBytes(24).toString("base64url")）',
    )
  }

  const configured = new Set((options.allowedHosts ?? []).map((h) => h.toLowerCase()))
  const bindName = options.host.toLowerCase().replace(/^\[|\]$/g, '')
  if (!isIpLiteral(bindName) && bindName !== 'localhost') configured.add(bindName)

  const hostAllowed = (hostHeader: string | undefined): boolean => {
    if (!hostHeader) return false
    const name = hostnameOf(hostHeader)
    if (!name) return false
    if (isLoopbackName(name)) return true
    if (configured.has(name)) return true
    // 其他 IP 字面量（局域网地址访问）：只有启用了 token 才放行，裸 IP 本身无法被 rebinding 指向别的域名。
    if (isIpLiteral(name)) return token !== undefined
    return false
  }

  const hostGuard: MiddlewareHandler = async (c, next) => {
    if (!hostAllowed(c.req.header('host'))) {
      throw new HttpError(
        403,
        'HOST_NOT_ALLOWED',
        `不允许的 Host：${c.req.header('host') ?? '(空)'}`,
      )
    }
    await next()
  }

  const originGuard: MiddlewareHandler = async (c, next) => {
    const method = c.req.method
    const safe = method === 'GET' || method === 'HEAD'
    const isEvents = c.req.path === '/api/events'
    if (!safe || isEvents) {
      const site = c.req.header('sec-fetch-site')
      if (site === 'cross-site') throw new HttpError(403, 'CROSS_ORIGIN', '不接受跨站请求')
      const origin = c.req.header('origin')
      if (origin && origin !== 'null') {
        let originHost: string | undefined
        try {
          originHost = new URL(origin).host.toLowerCase()
        } catch {
          /* 非法 Origin */
        }
        if (!originHost || originHost !== c.req.header('host')?.toLowerCase()) {
          throw new HttpError(403, 'CROSS_ORIGIN', `不接受来自 ${origin} 的跨源请求`)
        }
      } else if (origin === 'null') {
        throw new HttpError(403, 'CROSS_ORIGIN', '不接受不透明来源的请求')
      }
    }
    await next()
  }

  const authGuard: MiddlewareHandler = async (c, next) => {
    if (!token) return next()
    // 引导：`/?token=xxx` → 种 cookie → 重定向到不带 token 的地址（避免 token 留在地址栏 / 历史 / Referer）。
    const queryToken = c.req.query('token')
    if (queryToken !== undefined && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
      if (!tokensEqual(queryToken, token)) throw new HttpError(401, 'UNAUTHORIZED', 'token 无效')
      const url = new URL(c.req.url)
      url.searchParams.delete('token')
      const target = url.pathname + url.search
      c.header(
        'Set-Cookie',
        `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`,
      )
      c.header('Cache-Control', 'no-store')
      c.header('Referrer-Policy', 'no-referrer')
      return c.redirect(target || '/', 303)
    }
    const presented = extractToken(c)
    if (!presented || !tokensEqual(presented, token)) {
      c.header('WWW-Authenticate', 'Bearer')
      throw new HttpError(401, 'UNAUTHORIZED', '需要访问令牌')
    }
    await next()
  }

  return { tokenRequired: token !== undefined, hostGuard, originGuard, authGuard }
}
