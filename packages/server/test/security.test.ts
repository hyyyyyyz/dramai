import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from '../src/app.ts'
import { DataDirLockedError } from '../src/lock.ts'
import { TokenRequiredError } from '../src/security.ts'
import { cleanupAll, rawRequest, startServer } from './helpers.ts'

afterEach(cleanupAll)

describe('host header / DNS rebinding', () => {
  it('rejects a foreign Host header and accepts loopback names', async () => {
    const h = await startServer()
    const port = h.server.port
    const evil = await rawRequest(port, ['GET /api/system HTTP/1.1', 'Host: evil.example.com'])
    expect(evil.status).toBe(403)
    expect(evil.body).toContain('HOST_NOT_ALLOWED')
    const evilWithPort = await rawRequest(port, [
      'GET /api/system HTTP/1.1',
      `Host: evil.example.com:${port}`,
    ])
    expect(evilWithPort.status).toBe(403)
    for (const name of ['localhost', '127.0.0.1', '[::1]', 'app.localhost']) {
      const ok = await rawRequest(port, ['GET /api/health HTTP/1.1', `Host: ${name}:${port}`])
      expect(ok.status, name).toBe(200)
    }
    // 没有 Host 头（HTTP/1.0 风格）也不放行
    const none = await rawRequest(port, ['GET /api/health HTTP/1.0'])
    expect([400, 403]).toContain(none.status)
  })

  it('does not trust a bare LAN IP in Host unless a token is set', async () => {
    const h = await startServer()
    const r = await rawRequest(h.server.port, [
      'GET /api/health HTTP/1.1',
      'Host: 192.168.1.20:8787',
    ])
    expect(r.status).toBe(403)
  })
})

describe('listen address + token', () => {
  it('refuses to listen on a non-loopback address without a token (and does not touch the data dir)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dramai-sec-'))
    try {
      await expect(
        createServer({ dataDir: join(dir, 'd'), host: '0.0.0.0', port: 0 }),
      ).rejects.toThrow(TokenRequiredError)
      await expect(stat(join(dir, 'd'))).rejects.toThrow() // 没有创建数据目录 / 锁
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  })

  it('rejects a too-short token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dramai-sec-'))
    try {
      await expect(createServer({ dataDir: dir, token: 'short' })).rejects.toThrow(/token/)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  })

  it('requires the token everywhere except /api/health, in header, x-header or cookie form', async () => {
    const token = 'tok-0123456789abcdef-xyz'
    const h = await startServer({ token })
    const url = h.server.url
    expect((await fetch(`${url}/api/health`)).status).toBe(200)
    expect((await fetch(`${url}/api/system`)).status).toBe(401)
    expect(
      (await fetch(`${url}/api/system`, { headers: { Authorization: 'Bearer nope' } })).status,
    ).toBe(401)
    expect(
      (await fetch(`${url}/api/system`, { headers: { Authorization: `Bearer ${token}` } })).status,
    ).toBe(200)
    expect(
      (await fetch(`${url}/api/system`, { headers: { 'X-Dramai-Token': token } })).status,
    ).toBe(200)
    expect(
      (await fetch(`${url}/api/system`, { headers: { Cookie: `dramai_token=${token}` } })).status,
    ).toBe(200)
    expect((await fetch(`${url}/api/events`)).status).toBe(401)
    // 通过客户端也是
    expect((await h.client.call('system.get')).auth.tokenRequired).toBe(true)
  })

  it('bootstraps a cookie from ?token= and redirects without leaking it into the URL', async () => {
    const token = 'tok-0123456789abcdef-xyz'
    const h = await startServer({ token })
    const bad = await fetch(`${h.server.url}/?token=wrong`, { redirect: 'manual' })
    expect(bad.status).toBe(401)
    const good = await fetch(`${h.server.url}/some/page?x=1&token=${token}`, { redirect: 'manual' })
    expect(good.status).toBe(303)
    expect(good.headers.get('location')).toBe('/some/page?x=1')
    const cookie = good.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    const value = /dramai_token=([^;]+)/.exec(cookie)?.[1]
    const withCookie = await fetch(`${h.server.url}/api/system`, {
      headers: { Cookie: `dramai_token=${value}` },
    })
    expect(withCookie.status).toBe(200)
  })

  it('serves a non-loopback bind when a token is set (LAN IP Host accepted only with token)', async () => {
    const token = 'tok-0123456789abcdef-xyz'
    const h = await startServer({ host: '0.0.0.0', token })
    // 用 127.0.0.1 访问（回环名字永远允许），带 token
    const ok = await h.raw('/api/system')
    expect(ok.status).toBe(200)
    const lan = await rawRequest(h.server.port, [
      'GET /api/system HTTP/1.1',
      'Host: 192.168.1.20:1',
      `Authorization: Bearer ${token}`,
    ])
    expect(lan.status).toBe(200)
    const noToken = await rawRequest(h.server.port, [
      'GET /api/system HTTP/1.1',
      'Host: 192.168.1.20:1',
    ])
    expect(noToken.status).toBe(401)
  })
})

describe('no CORS / cross-origin writes', () => {
  it('sends no Access-Control headers and rejects cross-origin mutating requests and SSE', async () => {
    const h = await startServer()
    const res = await h.raw('/api/system', { headers: { Origin: 'https://evil.example.com' } })
    expect(res.status).toBe(200) // GET 读取由浏览器同源策略挡住响应；我们不发 CORS 头
    expect([...res.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([])

    const preflight = await h.raw('/api/projects', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST' },
    })
    expect([...preflight.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([])

    const post = await h.raw('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ name: 'x', aspectRatio: '9:16' }),
    })
    expect(post.status).toBe(403)
    expect(((await post.json()) as { error: { code: string } }).error.code).toBe('CROSS_ORIGIN')

    const sse = await h.raw('/api/events', { headers: { Origin: 'https://evil.example.com' } })
    expect(sse.status).toBe(403)

    const site = await h.raw('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
      body: '{}',
    })
    expect(site.status).toBe(403)

    // 同源的 Origin 放行（不是 403 即可（具体状态取决于路由校验））
    const same = await h.raw('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: h.server.url },
      body: '{}',
    })
    expect(same.status).not.toBe(403)
  })
})

describe('secrets never leave the server', () => {
  it('returns only a mask from every provider route and settings, and stores the key 0600', async () => {
    const h = await startServer()
    const KEY = 'sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789'
    const created = await h.client.call('providers.create', {
      body: {
        label: 'LLM',
        kind: 'llm',
        protocol: 'openai-chat',
        baseUrl: 'https://llm.example/v1',
        model: 'm',
        apiKey: KEY,
      },
    })
    expect(created.hasKey).toBe(true)
    expect(created.keyMask).toBe('sk-…6789')

    const bodies: string[] = []
    const grab = async (path: string, init?: RequestInit) =>
      bodies.push(await (await h.raw(path, init)).text())
    await grab('/api/providers')
    await grab(`/api/providers/${created.id}`)
    await grab(`/api/providers/${created.id}/capability`)
    await grab('/api/settings')
    await grab('/api/system')
    await grab(`/api/providers/${created.id}/test`, { method: 'POST' })
    await grab(`/api/providers/${created.id}/key`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: KEY }),
    })
    for (const b of bodies) expect(b).not.toContain(KEY)
    expect(bodies.join('\n')).not.toContain('secretRef')

    // 清除后不再有 key
    const cleared = await h.client.call('providers.clearKey', {
      params: { providerId: created.id },
    })
    expect(cleared.hasKey).toBe(false)
    expect(cleared.keyMask).toBeUndefined()

    // 文件权限：仅当前用户可读写
    await h.client.call('providers.setKey', {
      params: { providerId: created.id },
      body: { apiKey: KEY },
    })
    const file = join(h.dataDir, 'secrets.json')
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
    // 数据库里没有 key 明文
    const dbBytes = (await readFile(join(h.dataDir, 'dramai.sqlite'))).toString('latin1')
    expect(dbBytes).not.toContain(KEY)
  })
})

describe('data directory lock', () => {
  it('a second instance on the same data dir fails with a clear error and does not disturb the first', async () => {
    const h = await startServer()
    await expect(
      createServer({ dataDir: h.dataDir, port: 0, logger: { error: () => {} } }),
    ).rejects.toThrow(DataDirLockedError)
    await expect(createServer({ dataDir: h.dataDir, port: 0 })).rejects.toThrow(
      /已被另一个 dramai 实例占用/,
    )
    // 第一个仍然正常
    expect((await h.client.call('system.get')).dataDir).toBe(h.dataDir)
    // 关闭后锁释放，可以重新启动
    await h.stop()
    const again = await startServer({ dataDir: h.dataDir })
    expect((await again.client.call('system.get')).dataDir).toBe(h.dataDir)
  })

  it('takes over a stale lock left by a dead process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dramai-lock-'))
    try {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(
        join(dir, 'dramai.lock'),
        JSON.stringify({ pid: 2_147_483_000, startedAt: 1 }),
      )
      const h = await startServer({ dataDir: dir })
      expect((await h.client.call('system.get')).dataDir).toBe(dir)
    } finally {
      await cleanupAll()
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  })
})
