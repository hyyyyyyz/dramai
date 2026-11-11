import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ServerContext } from '../context.ts'
import type { BufferedEvent } from '../events/event-bus.ts'

export const HEARTBEAT_MS = 15_000

/**
 * `GET /api/events`：唯一的 SSE 通道。
 *
 * 连接流程：先发 `hello`（带 epoch）；若带了 `Last-Event-ID`，按总线的判断补发错过的事件，
 * 或发 `resync` 让前端整体刷新；之后实时转发。先订阅、再补发，所以补发与实时之间不会漏。
 * 每 15 秒一条注释心跳，防止代理 / 浏览器把空闲连接掐断。
 */
export function registerEventRoutes(
  app: Hono,
  ctx: ServerContext,
  open: Set<() => void>,
  heartbeatMs = HEARTBEAT_MS,
): void {
  app.get('/api/events', (c) => {
    c.header('Cache-Control', 'no-cache, no-transform')
    c.header('X-Accel-Buffering', 'no')
    const lastId = c.req.header('last-event-id') ?? c.req.query('lastEventId')
    return streamSSE(c, async (stream) => {
      let chain: Promise<unknown> = Promise.resolve()
      const send = (e: { id: string; event: string; data: string }) => {
        chain = chain.then(() => stream.writeSSE(e)).catch(() => {})
      }
      const sendBuffered = (b: BufferedEvent) =>
        send({ id: b.id, event: b.event.type, data: JSON.stringify(b.event) })

      let lastSent = -1
      const listener = (b: BufferedEvent) => {
        if (b.seq <= lastSent) return
        lastSent = b.seq
        sendBuffered(b)
      }
      const unsubscribe = ctx.bus.subscribe(listener)
      const headId = `${ctx.bus.epoch}:${ctx.bus.lastSeq}`

      send({
        id: headId,
        event: 'hello',
        data: JSON.stringify({ type: 'hello', epoch: ctx.bus.epoch, serverTime: Date.now() }),
      })
      const replay = ctx.bus.replaySince(lastId)
      if (replay.kind === 'resync') {
        send({
          id: headId,
          event: 'resync',
          data: JSON.stringify({ type: 'resync', reason: replay.reason }),
        })
        lastSent = ctx.bus.lastSeq
      } else if (replay.kind === 'replay') {
        for (const b of replay.events) {
          lastSent = Math.max(lastSent, b.seq)
          sendBuffered(b)
        }
        lastSent = Math.max(lastSent, ctx.bus.lastSeq)
      } else {
        lastSent = ctx.bus.lastSeq
      }

      const heartbeat = setInterval(() => {
        chain = chain.then(() => stream.write(': ping\n\n')).catch(() => {})
      }, heartbeatMs)
      heartbeat.unref?.()

      await new Promise<void>((resolve) => {
        const done = () => {
          clearInterval(heartbeat)
          unsubscribe()
          open.delete(done)
          resolve()
        }
        open.add(done)
        stream.onAbort(done)
      })
    })
  })
}
