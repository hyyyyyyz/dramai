import { afterEach, describe, expect, it } from 'vitest'
import { parseRange } from '../src/http/range.ts'
import { FsFileStore, UnsafePathError } from '../src/storage/files.ts'
import { cleanupAll, rawRequest, startServer } from './helpers.ts'

afterEach(cleanupAll)

describe('parseRange', () => {
  it('handles the RFC 9110 forms', () => {
    expect(parseRange(undefined, 100)).toEqual({ kind: 'none' })
    expect(parseRange('bytes=0-9', 100)).toEqual({ kind: 'ok', start: 0, end: 9 })
    expect(parseRange('bytes=90-', 100)).toEqual({ kind: 'ok', start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'ok', start: 90, end: 99 })
    expect(parseRange('bytes=-500', 100)).toEqual({ kind: 'ok', start: 0, end: 99 })
    expect(parseRange('bytes=50-5000', 100)).toEqual({ kind: 'ok', start: 50, end: 99 })
    expect(parseRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' })
    expect(parseRange('bytes=0-1,5-6', 100)).toEqual({ kind: 'none' })
    expect(parseRange('items=0-5', 100)).toEqual({ kind: 'none' })
    expect(parseRange('bytes=9-2', 100)).toEqual({ kind: 'none' })
    expect(parseRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' })
  })
})

describe('FsFileStore path safety', () => {
  it('rejects traversal, absolute paths and odd project ids', async () => {
    const store = new FsFileStore('/tmp/x')
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a//b', './a', 'a\\b', '', 'a\0b']) {
      expect(() => store.resolve('p1', bad), bad).toThrow(UnsafePathError)
    }
    for (const bad of ['../p', 'a/b', '', '.']) {
      expect(() => store.resolve(bad, 'a.png'), bad).toThrow(UnsafePathError)
    }
    expect(store.resolve('p1', 'images/a.png')).toBe('/tmp/x/projects/p1/images/a.png')
  })
})

describe('GET /api/projects/:id/files/*', () => {
  const bytes = new Uint8Array(1000).map((_, i) => i % 251)

  async function setup() {
    const h = await startServer()
    await h.server.ctx.files.put('p1', 'media/video/clip.mp4', bytes)
    await h.server.ctx.files.put('p1', 'media/中文 名字.png', bytes)
    return h
  }

  it('serves the whole file with Accept-Ranges, ETag and safe headers', async () => {
    const h = await setup()
    const res = await h.raw('/api/projects/p1/files/media/video/clip.mp4')
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('content-length')).toBe('1000')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(res.headers.get('content-disposition')).toBe('inline')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
  })

  it('answers Range requests with 206 and exactly the requested bytes', async () => {
    const h = await setup()
    const mid = await h.raw('/api/projects/p1/files/media/video/clip.mp4', {
      headers: { Range: 'bytes=100-199' },
    })
    expect(mid.status).toBe(206)
    expect(mid.headers.get('content-range')).toBe('bytes 100-199/1000')
    expect(mid.headers.get('content-length')).toBe('100')
    expect(new Uint8Array(await mid.arrayBuffer())).toEqual(bytes.slice(100, 200))

    const open = await h.raw('/api/projects/p1/files/media/video/clip.mp4', {
      headers: { Range: 'bytes=990-' },
    })
    expect(open.status).toBe(206)
    expect(open.headers.get('content-range')).toBe('bytes 990-999/1000')
    expect(new Uint8Array(await open.arrayBuffer())).toEqual(bytes.slice(990))

    const suffix = await h.raw('/api/projects/p1/files/media/video/clip.mp4', {
      headers: { Range: 'bytes=-5' },
    })
    expect(suffix.status).toBe(206)
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(bytes.slice(995))

    const past = await h.raw('/api/projects/p1/files/media/video/clip.mp4', {
      headers: { Range: 'bytes=2000-' },
    })
    expect(past.status).toBe(416)
    expect(past.headers.get('content-range')).toBe('bytes */1000')

    const head = await h.raw('/api/projects/p1/files/media/video/clip.mp4', {
      method: 'HEAD',
      headers: { Range: 'bytes=0-9' },
    })
    expect(head.status).toBe(206)
    expect(head.headers.get('content-length')).toBe('10')
    expect((await head.arrayBuffer()).byteLength).toBe(0)
  })

  it('supports conditional requests and percent-encoded unicode paths', async () => {
    const h = await setup()
    const first = await h.raw('/api/projects/p1/files/media/video/clip.mp4')
    const etag = first.headers.get('etag')!
    const again = await h.raw('/api/projects/p1/files/media/video/clip.mp4', {
      headers: { 'If-None-Match': etag },
    })
    expect(again.status).toBe(304)
    const uni = await h.raw(
      `/api/projects/p1/files/${['media', '中文 名字.png'].map(encodeURIComponent).join('/')}`,
    )
    expect(uni.status).toBe(200)
    expect(uni.headers.get('content-type')).toBe('image/png')
  })

  it('refuses traversal and returns 404 for missing files', async () => {
    const h = await setup()
    expect((await h.raw('/api/projects/p1/files/media/nothing.mp4')).status).toBe(404)
    const get = async (path: string) =>
      (
        await rawRequest(h.server.port, [
          `GET ${path} HTTP/1.1`,
          `Host: 127.0.0.1:${h.server.port}`,
        ])
      ).status
    // 点段在进入路由前就被 URL 规范化掉了（落到别的路由），总之拿不到文件
    expect(await get('/api/projects/p1/files/%2e%2e/%2e%2e/dramai.sqlite')).not.toBe(200)
    expect([400, 404]).toContain(
      await get('/api/projects/p1/files/media%2f..%2f..%2f..%2fdramai.sqlite'),
    )
    expect(await get('/api/projects/p1/files/media/%2e%2e/..%2fsecrets.json')).not.toBe(200)
    // 项目 id 不能带路径
    expect([400, 404]).toContain(await get('/api/projects/..%2Fp1/files/media/video/clip.mp4'))
  })

  it('never serves active content inline', async () => {
    const h = await startServer()
    await h.server.ctx.files.put(
      'p1',
      'notes/page.html',
      new TextEncoder().encode('<script>alert(1)</script>'),
    )
    const res = await h.raw('/api/projects/p1/files/notes/page.html')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
  })
})
