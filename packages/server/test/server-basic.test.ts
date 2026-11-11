import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

describe('server basics', () => {
  it('starts, reports system info, and answers health', async () => {
    const h = await startServer()
    const info = await h.client.call('system.get')
    expect(info.dataDir).toBe(h.dataDir)
    expect(info.auth.tokenRequired).toBe(false)
    expect((await h.raw('/api/health')).status).toBe(200)
    expect((await h.raw('/api/nope')).status).toBe(404)
  })
})

describe('contract coverage', () => {
  it('every route in the @dramai/api contract has a real handler (none answers 501)', async () => {
    const h = await startServer()
    const bogus = await h.raw('/api/projects/none/materials', { method: 'GET' })
    expect(bogus.status).not.toBe(501)
    // 逐条路由：契约里的每个名字都已注册（没注册的会落到 NOT_IMPLEMENTED 桩）
    const { routes } = await import('@dramai/api')
    const probes = Object.values(routes).map(async (def) => {
      const path = def.path.replace(/:[A-Za-z]+/g, 'x')
      const res = await h.raw(path, {
        method: def.method,
        headers: { 'Content-Type': 'application/json' },
        body: def.method === 'GET' || def.method === 'DELETE' ? undefined : '{}',
      })
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } }
      return { path, method: def.method, code: body.error?.code }
    })
    const notImplemented = (await Promise.all(probes)).filter((r) => r.code === 'NOT_IMPLEMENTED')
    expect(notImplemented).toEqual([])
  })
})
