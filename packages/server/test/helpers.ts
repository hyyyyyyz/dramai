import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@dramai/api'
import { createServer } from '../src/app.ts'
import type { CreateServerOptions, DramaiServer } from '../src/app.ts'

export interface Harness {
  server: DramaiServer
  dataDir: string
  client: ReturnType<typeof createClient>
  raw(path: string, init?: RequestInit): Promise<Response>
  stop(options?: { graceful?: boolean }): Promise<void>
  cleanup(): Promise<void>
  /** True when this harness created the data directory (and so removes it). */
  ownsDir: boolean
}

const live: Harness[] = []

export async function startServer(
  options: Partial<CreateServerOptions> & { dataDir?: string } = {},
): Promise<Harness> {
  const dataDir = options.dataDir ?? (await mkdtemp(join(tmpdir(), 'dramai-srv-')))
  const server = await createServer({
    port: 0,
    validateResponses: true,
    logger: { error: () => {} },
    ...options,
    dataDir,
  })
  const client = createClient({ baseUrl: server.url, token: server.token })
  const h: Harness = {
    server,
    dataDir,
    client,
    raw: (path, init) =>
      fetch(server.url + path, {
        ...init,
        headers: {
          ...(server.token ? { Authorization: `Bearer ${server.token}` } : {}),
          ...init?.headers,
        },
      }),
    stop: (o) => server.close(o),
    cleanup: async () => {
      await server.close({ graceful: false }).catch(() => {})
      if (!options.dataDir) await removeDir(dataDir)
    },
    ownsDir: !options.dataDir,
  }
  live.push(h)
  return h
}

const removeDir = (dir: string) =>
  rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })

/**
 * Stop every server first, then delete the data directories. A "restart" test starts a second server on the first
 * one's directory, so removing the directory when the *first* is cleaned up would delete files the second still has
 * open. POSIX allows that; Windows refuses (`EBUSY` on `dramai.sqlite-shm` / `-wal`).
 * `remove` is a parameter so a test can observe the order.
 */
export async function cleanupAllWith(remove: (dir: string) => Promise<void>): Promise<void> {
  const all = live.splice(0)
  for (const h of all) await h.server.close({ graceful: false }).catch(() => {})
  for (const h of all) if (h.ownsDir) await remove(h.dataDir)
}

/** Used as `afterEach(cleanupAll)` (vitest passes its own argument, so no parameters here). */
export const cleanupAll = (): Promise<void> => cleanupAllWith(removeDir)

import { connect } from 'node:net'

/** 发一个原始 HTTP 请求（自定义 Host、不经过 fetch 的 URL 规范化）。 */
export function rawRequest(
  port: number,
  lines: string[],
): Promise<{ status: number; headers: string; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let data = ''
    socket.on('data', (d) => (data += d.toString()))
    socket.on('error', reject)
    socket.on('close', () => {
      const [head = '', ...rest] = data.split('\r\n\r\n')
      resolve({
        status: Number(/HTTP\/1\.1 (\d+)/.exec(head)?.[1]),
        headers: head,
        body: rest.join('\r\n\r\n'),
      })
    })
    socket.write([...lines, 'Connection: close', '', ''].join('\r\n'))
  })
}
