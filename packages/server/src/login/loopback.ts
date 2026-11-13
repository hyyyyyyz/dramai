import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { OPENAI_LOGIN } from '@dramai/core'
import type { ListenerFactory, OpenAiLoginErrorCode } from '@dramai/core'

/**
 * OAuth 回调的临时监听器：只绑 127.0.0.1（官方要求回调是回环 IP，不能是 localhost），
 * 先试文档示例的端口 1455，被占用就换一个空闲端口（文档：后续登录只有端口可以变）。
 * 只接受 `GET /auth/callback`，Host 头必须是我们自己的回环地址（防 DNS rebinding）；
 * 收到一次回调（不管成败）后由登录流程关闭，超时也由它关闭。
 */

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function page(ok: boolean, error?: OpenAiLoginErrorCode): string {
  const title = ok ? '登录完成 · Signed in' : '登录没有完成 · Sign-in did not finish'
  const body = ok
    ? '可以关闭这个页面，回到 dramai。<br>You can close this tab and go back to dramai.'
    : `请回到 dramai 重试。<br>Go back to dramai and try again.${error ? `<br><small>${escapeHtml(error)}</small>` : ''}`
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>dramai</title><body style="font:16px/1.6 system-ui,sans-serif;max-width:28rem;margin:20vh auto;padding:0 1rem"><h1 style="font-size:1.25rem">${title}</h1><p>${body}</p>`
}

function listenOn(server: Server, port: number): Promise<number> {
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
    server.listen(port, '127.0.0.1')
  })
}

export function createLoopbackListenerFactory(
  options: { preferredPort?: number } = {},
): ListenerFactory {
  return async (onCallback) => {
    let port = 0
    const server = createServer((req, res) => {
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
      const host = (req.headers.host ?? '').toLowerCase()
      if (host !== `127.0.0.1:${port}`) return reply(400, page(false))
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      if (req.method !== 'GET' || url.pathname !== OPENAI_LOGIN.callbackPath) {
        return reply(404, page(false))
      }
      onCallback(url.searchParams).then(
        (r) => reply(r.ok ? 200 : 400, page(r.ok, r.error)),
        () => reply(500, page(false)),
      )
    })
    const preferred = options.preferredPort ?? OPENAI_LOGIN.preferredPort
    try {
      port = await listenOn(server, preferred)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err
      port = await listenOn(server, 0)
    }
    return {
      redirectUri: `http://127.0.0.1:${port}${OPENAI_LOGIN.callbackPath}`,
      close: () => {
        // 停止接收新连接；正在回复浏览器的那一个连接让它写完（Connection: close），兜底 2 秒后强制断开
        server.close()
        server.closeIdleConnections()
        setTimeout(() => server.closeAllConnections(), 2000).unref()
      },
    }
  }
}
