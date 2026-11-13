import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { OPENAI_LOGIN } from '@dramai/core'
import type { ListenerFactory, LoginErrorCode } from '@dramai/core'

/**
 * OAuth 回调的临时监听器：只绑 127.0.0.1（官方要求回调是回环 IP，不能是 localhost），
 * 先试文档示例的端口 1455，被占用就换一个空闲端口（文档：后续登录只有端口可以变）。
 * 只接受 `GET /auth/callback`，Host 头必须是我们自己的回环地址（防 DNS rebinding）；
 * 收到一次回调（不管成败）后由登录流程关闭，超时也由它关闭。
 */

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function page(ok: boolean, error?: LoginErrorCode): string {
  const title = ok ? '登录完成 · Signed in' : '登录没有完成 · Sign-in did not finish'
  const body = ok
    ? '可以关闭这个页面，回到 dramai。<br>You can close this tab and go back to dramai.'
    : `请回到 dramai 重试。<br>Go back to dramai and try again.${error ? `<br><small>${escapeHtml(error)}</small>` : ''}`
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>dramai</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:28rem;margin:20vh auto;padding:0 1rem"><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p>`
}

function listenOn(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve((server.address() as AddressInfo).port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

export function createLoopbackListenerFactory(
  options: { preferredPort?: number } = {},
): ListenerFactory {
  return async (onCallback, listenOptions = {}) => {
    const host = listenOptions.host ?? '127.0.0.1'
    const path = listenOptions.path ?? OPENAI_LOGIN.callbackPath
    let port = 0
    const servers: Server[] = []
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      const reply = (status: number, html: string) => {
        res.writeHead(status, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
          'X-Content-Type-Options': 'nosniff',
          Connection: 'close',
        })
        res.end(html)
      }
      // Host 头必须是我们自己给出的那个地址（防 DNS rebinding）
      if ((req.headers.host ?? '').toLowerCase() !== `${host}:${port}`)
        return reply(400, page(false))
      const url = new URL(req.url ?? '/', `http://${host}:${port}`)
      if (req.method !== 'GET' || url.pathname !== path) return reply(404, page(false))
      onCallback(url.searchParams).then(
        (r) => reply(r.ok ? 200 : 400, page(r.ok, r.error)),
        () => reply(500, page(false)),
      )
    }
    const primary = createServer(handler)
    servers.push(primary)
    const preferred =
      listenOptions.preferredPort ?? options.preferredPort ?? OPENAI_LOGIN.preferredPort
    try {
      port = await listenOn(primary, '127.0.0.1', preferred)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
      port = await listenOn(primary, '127.0.0.1', 0)
    }
    if (host === 'localhost') {
      // 浏览器可能把 localhost 解析成 ::1：同一个端口也在 IPv6 回环上听（没有 IPv6 或端口被占就算了）
      const v6 = createServer(handler)
      try {
        await listenOn(v6, '::1', port)
        servers.push(v6)
      } catch {
        v6.close()
      }
    }
    return {
      redirectUri: `http://${host}:${port}${path}`,
      close: () => {
        // 停止接收新连接；正在回复浏览器的那一个连接让它写完（Connection: close），兜底 2 秒后强制断开
        for (const server of servers) {
          server.close()
          server.closeIdleConnections()
        }
        setTimeout(() => servers.forEach((s) => s.closeAllConnections()), 2000).unref()
      },
    }
  }
}
