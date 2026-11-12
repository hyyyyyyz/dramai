import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
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
    const store = new FsFileStore(join(tmpdir(), 'x'))
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a//b', './a', 'a\\b', '', 'a\0b']) {
      expect(() => store.resolve('p1', bad), bad).toThrow(UnsafePathError)
    }
    for (const bad of ['../p', 'a/b', '', '.']) {
      expect(() => store.resolve(bad, 'a.png'), bad).toThrow(UnsafePathError)
    }
    expect(store.resolve('p1', 'images/a.png')).toBe(
      join(tmpdir(), 'x', 'projects', 'p1', 'images', 'a.png'),
    )
  })

  it('rejects what Windows reads differently: drive letters, UNC, streams, device names, trailing dots', () => {
    const store = new FsFileStore(join(tmpdir(), 'x'))
    const bad = [
      'C:/Windows/win.ini', // drive letter
      'C:win.ini', // drive-relative
      '//server/share/a', // UNC
      '\\\\server\\share\\a', // UNC with backslashes
      'a.txt:stream', // NTFS alternate data stream
      'a.txt::$DATA',
      'images/CON',
      'images/nul.png',
      'audio/COM1.wav',
      'media/lpt9',
      'images/a.png.', // Windows strips the trailing dot: a.png.
      'images/a.png ',
      'images/dir./a.png',
      'a<b',
      'a>b',
      'a"b',
      'a|b',
      'a?b',
      'a*b',
      'a\tb',
      'a\nb',
      'a\u007fb',
    ]
    for (const p of bad)
      expect(() => store.resolve('p1', p), JSON.stringify(p)).toThrow(UnsafePathError)
    // ordinary and non-ASCII names are fine, and so are names that merely contain a device name
    for (const ok of [
      'media/中文 名字.png',
      'materials/m_1/第一章 开端.txt',
      'output/ep_1/cut_9.mp4',
      'images/console.png',
      'images/com10.png',
      'audio/bgm/bgm_ab12',
      'a.b.c',
    ]) {
      expect(() => store.resolve('p1', ok), ok).not.toThrow()
    }
  })

  it('under Windows path rules: resolves into the project folder, and nothing escapes it', () => {
    const store = new FsFileStore('D:\\Users\\me\\AppData\\Dramai', win32)
    expect(store.root).toBe('D:\\Users\\me\\AppData\\Dramai\\projects')
    expect(store.resolve('p1', 'images/a.png')).toBe(
      'D:\\Users\\me\\AppData\\Dramai\\projects\\p1\\images\\a.png',
    )
    expect(store.resolve('p1', 'media/中文 名字.png')).toBe(
      'D:\\Users\\me\\AppData\\Dramai\\projects\\p1\\media\\中文 名字.png',
    )
    const attacks = [
      '../x',
      '..\\x',
      'a/../../x',
      'a\\..\\..\\x',
      '/windows/win.ini',
      '\\windows\\win.ini',
      '\\\\server\\share\\x',
      '//server/share/x',
      'C:/Windows/win.ini',
      'C:\\Windows\\win.ini',
      'c:win.ini',
      'D:../x',
      '..%2fx',
      '%2e%2e/x',
      '....//x',
      '.../x',
      '..../x',
      'a/..',
      'a/./b',
      'images/a.png::$DATA',
      'images/a.png:Zone.Identifier',
      'images/NUL',
      'images/Con.txt',
      'images/aux.',
      '\\\\?\\C:\\x',
      '\\\\.\\PhysicalDrive0',
      'PROGRA~1/x:y',
    ]
    for (const a of attacks) {
      let result: string | undefined
      try {
        result = store.resolve('p1', a)
      } catch (err) {
        expect(err, a).toBeInstanceOf(UnsafePathError)
        continue
      }
      // anything that is accepted must still be inside the project folder under Windows rules
      const rel = win32.relative(store.projectDir('p1'), result)
      expect(
        rel === '..' || rel.startsWith('..\\') || win32.isAbsolute(rel),
        `${a} -> ${result}`,
      ).toBe(false)
    }
    // a different spelling of the same drive or folder is still inside: Windows paths are case-insensitive
    const lower = new FsFileStore('d:\\users\\me\\appdata\\dramai', win32)
    expect(lower.resolve('p1', 'a.png')).toBe('d:\\users\\me\\appdata\\dramai\\projects\\p1\\a.png')
    for (const bad of ['p1\\..', 'p1/x', '..', 'P1:x', 'p1.', '']) {
      expect(() => store.projectDir(bad), bad).toThrow(UnsafePathError)
    }
  })

  it('under POSIX path rules it behaves the same', () => {
    const store = new FsFileStore('/var/lib/dramai', posix)
    expect(store.resolve('p1', 'images/a.png')).toBe('/var/lib/dramai/projects/p1/images/a.png')
    for (const bad of ['../x', '/etc/passwd', 'a/../../x', 'C:/x', 'a\\b'])
      expect(() => store.resolve('p1', bad), bad).toThrow(UnsafePathError)
  })

  it('writes without leaving temp files, replaces an existing file, and removes it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dramai-files-'))
    try {
      const store = new FsFileStore(dir)
      await store.put('p1', 'a/b.bin', new Uint8Array([1, 2, 3]))
      await store.put('p1', 'a/b.bin', new Uint8Array([4, 5]))
      expect(Array.from(await store.get('p1', 'a/b.bin'))).toEqual([4, 5])
      expect(await readdir(join(dir, 'projects', 'p1', 'a'))).toEqual(['b.bin'])
      await store.remove('p1', 'a/b.bin')
      await store.remove('p1', 'a/b.bin') // already gone: not an error
      expect(await store.exists('p1', 'a/b.bin')).toBe(false)
      await store.removeProject('p1')
      expect(await readdir(join(dir, 'projects'))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
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
