import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServerController } from '../src/server/controller.ts'
import type { HostToServer, ServerToHost } from '../src/shared/protocol.ts'

/** 用真实的 @dramai/server 和真实的 SQLite，把“主进程 ↔ 服务进程”协议完整走一遍（没有 Electron）。 */
let dir: string
beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), 'dramai-ctl-'))))
afterEach(() => rm(dir, { recursive: true, force: true }))

const TOKEN = 'a'.repeat(32)

function get(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = request({ host: u.hostname, port: u.port, path: u.pathname, headers }, (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('server controller', () => {
  it('starts a desktop-flagged, token-protected server on loopback and shuts it down cleanly', async () => {
    const sent: ServerToHost[] = []
    const c = createServerController((m) => sent.push(m))
    await c.handle({
      type: 'start',
      options: { dataDir: dir, port: 0, token: TOKEN, version: '9.9.9' },
    })
    const ready = sent.find((m) => m.type === 'ready')
    expect(ready).toBeDefined()
    const url = (ready as Extract<ServerToHost, { type: 'ready' }>).url
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    expect((await get(`${url}/api/system`)).status).toBe(401)
    const system = await get(`${url}/api/system`, { Authorization: `Bearer ${TOKEN}` })
    expect(system.status).toBe(200)
    expect(JSON.parse(system.body)).toMatchObject({ desktop: true, version: '9.9.9', dataDir: dir })
    expect(existsSync(join(dir, 'dramai.lock'))).toBe(true)

    await c.handle({ type: 'stop', graceful: false })
    expect(sent.at(-1)).toEqual({ type: 'stopped' })
    expect(existsSync(join(dir, 'dramai.lock'))).toBe(false) // 数据目录锁已释放
  })

  it('a second server on the same data dir fails with DATA_DIR_LOCKED and does not disturb the first', async () => {
    const a: ServerToHost[] = []
    const b: ServerToHost[] = []
    const first = createServerController((m) => a.push(m))
    const second = createServerController((m) => b.push(m))
    const options = { dataDir: dir, port: 0, token: TOKEN, version: '1' }
    await first.handle({ type: 'start', options })
    await second.handle({ type: 'start', options })
    expect(b.find((m) => m.type === 'start.failed')).toMatchObject({ code: 'DATA_DIR_LOCKED' })
    await first.handle({ type: 'stop', graceful: false })
  })

  it('keeps provider keys out of the data dir: the server asks the main process, not a file', async () => {
    const sent: ServerToHost[] = []
    const vault = new Map<string, string>()
    const c = createServerController((m) => {
      sent.push(m)
      if (m.type === 'secret.request') {
        // 扮演主进程
        let value: string | boolean | null | undefined
        if (m.op === 'set') vault.set(m.ref, m.value ?? '')
        if (m.op === 'get') value = vault.get(m.ref) ?? null
        if (m.op === 'has') value = vault.has(m.ref)
        if (m.op === 'delete') vault.delete(m.ref)
        const reply: HostToServer = { type: 'secret.result', id: m.id, ok: true, value }
        queueMicrotask(() => void c.handle(reply))
      }
    })
    await c.handle({
      type: 'start',
      options: { dataDir: dir, port: 0, token: TOKEN, version: '1' },
    })
    const url = (sent.find((m) => m.type === 'ready') as Extract<ServerToHost, { type: 'ready' }>)
      .url
    const auth = { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
    const post = (
      path: string,
      method: string,
      body: unknown,
    ): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const u = new URL(url + path)
        const req = request(
          { host: u.hostname, port: u.port, path: u.pathname, method, headers: auth },
          (res) => {
            let text = ''
            res.on('data', (d) => (text += d))
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }))
          },
        )
        req.on('error', reject)
        req.end(JSON.stringify(body))
      })
    const created = await post('/api/providers', 'POST', {
      label: 't',
      kind: 'llm',
      protocol: 'openai-chat',
      baseUrl: 'http://127.0.0.1:9',
      model: 'm',
      apiKey: 'sk-test-key',
    })
    expect(created.status).toBe(200)
    expect([...vault.values()]).toContain('sk-test-key')
    expect(existsSync(join(dir, 'secrets.json'))).toBe(false)
    await c.handle({ type: 'stop', graceful: false })
  })
})
