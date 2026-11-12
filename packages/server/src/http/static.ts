import { readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { MiddlewareHandler } from 'hono'
import { APP_CSP } from './csp.ts'
import { mimeOf } from './mime.ts'

/**
 * 托管前端构建产物（可选）。只服务 GET/HEAD、非 /api 的请求；找不到文件且不像资源（无扩展名）时回退到
 * index.html（单页应用路由）。路径严格限制在 staticDir 内。
 */
export function staticFiles(staticDir: string): MiddlewareHandler {
  const root = resolve(staticDir)
  return async (c, next) => {
    if ((c.req.method !== 'GET' && c.req.method !== 'HEAD') || c.req.path.startsWith('/api/')) {
      return next()
    }
    let rel: string
    try {
      rel = decodeURIComponent(c.req.path)
    } catch {
      return next()
    }
    // A backslash, a drive colon or a NUL never occurs in a real asset URL; on Windows they would reach other places
    // (`..\\`, `C:`, alternate data streams), so such a path never maps to a file — it may still fall back to index.html.
    const hostile = /[\0\\:]/.test(rel)
    const candidate = resolve(root, '.' + (rel.endsWith('/') ? rel + 'index.html' : rel))
    const tryFile = async (file: string) => {
      if (file !== root && !file.startsWith(root + sep)) return undefined
      try {
        const s = await stat(file)
        return s.isFile() ? file : undefined
      } catch {
        return undefined
      }
    }
    let file = hostile ? undefined : await tryFile(candidate)
    const hasExt = /\.[A-Za-z0-9]+$/.test(rel)
    if (!file && !hasExt) file = await tryFile(join(root, 'index.html'))
    if (!file) return next()
    const body = c.req.method === 'HEAD' ? null : new Uint8Array(await readFile(file))
    const isIndex = file.endsWith(`${sep}index.html`)
    return new Response(body, {
      headers: {
        'Content-Type': mimeOf(file),
        'X-Content-Type-Options': 'nosniff',
        // 带哈希的构建资源可长期缓存；入口 HTML 不缓存。
        'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
        ...(isIndex
          ? {
              'Content-Security-Policy': APP_CSP,
              'X-Frame-Options': 'DENY',
              'Referrer-Policy': 'no-referrer',
            }
          : {}),
      },
    })
  }
}
