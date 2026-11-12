import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, resolve, win32 } from 'node:path'
import { createClient } from '@dramai/api'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveUserPath } from '../src/demo-lib.ts'

const root = join(import.meta.dirname, '..')

describe('resolveUserPath: relative paths follow where the user ran the command', () => {
  it('uses INIT_CWD (set by pnpm/npm before they chdir into the package), else the process cwd; absolute paths are untouched', () => {
    const p = posix
    expect(resolveUserPath('out/data', { INIT_CWD: '/work/proj' }, '/pkg/dir', p)).toBe(
      '/work/proj/out/data',
    )
    expect(resolveUserPath('./web/dist', { INIT_CWD: '/work/proj' }, '/pkg/dir', p)).toBe(
      '/work/proj/web/dist',
    )
    expect(resolveUserPath('../x', { INIT_CWD: '/work/proj' }, '/pkg/dir', p)).toBe('/work/x')
    expect(resolveUserPath('out/data', {}, '/pkg/dir', p)).toBe('/pkg/dir/out/data')
    expect(resolveUserPath('out/data', { INIT_CWD: '' }, '/pkg/dir', p)).toBe('/pkg/dir/out/data')
    expect(resolveUserPath('/abs/data', { INIT_CWD: '/work/proj' }, '/pkg/dir', p)).toBe(
      '/abs/data',
    )
  })

  it('follows Windows rules for Windows-style paths (drive letters, backslashes, UNC), on any machine', () => {
    const w = win32
    const env = { INIT_CWD: 'C:\\Users\\me\\proj' }
    const pkg = 'C:\\repo\\packages\\mock-providers'
    expect(resolveUserPath('out\\data', env, pkg, w)).toBe('C:\\Users\\me\\proj\\out\\data')
    expect(resolveUserPath('out/data', env, pkg, w)).toBe('C:\\Users\\me\\proj\\out\\data')
    expect(resolveUserPath('..\\x', env, pkg, w)).toBe('C:\\Users\\me\\x')
    expect(resolveUserPath('out\\data', {}, pkg, w)).toBe(
      'C:\\repo\\packages\\mock-providers\\out\\data',
    )
    expect(resolveUserPath('D:\\demo', env, pkg, w)).toBe('D:\\demo')
    expect(resolveUserPath('\\\\server\\share\\demo', env, pkg, w)).toBe('\\\\server\\share\\demo')
    // a relative path on another drive keeps that drive's context
    expect(resolveUserPath('D:demo', { INIT_CWD: 'D:\\work' }, pkg, w)).toBe('D:\\work\\demo')
  })

  it('without an explicit path API it follows the running platform', () => {
    const abs = resolve('some', 'dir')
    expect(resolveUserPath(abs, { INIT_CWD: join(abs, 'x') })).toBe(abs)
    expect(resolveUserPath('a', { INIT_CWD: abs })).toBe(resolve(abs, 'a'))
  })
})

interface Running {
  child: ChildProcess
  out: () => string
  err: () => string
  appUrl: string
  stop: () => Promise<void>
}
const running: Running[] = []
afterEach(async () => {
  for (const r of running.splice(0)) await r.stop()
})

/** 真的启动演示入口（子进程），工作目录是包目录，INIT_CWD 是“用户所在的目录”。 */
async function startDemo(userDir: string, args: string[]): Promise<Running> {
  const child = spawn(
    process.execPath,
    [
      '--conditions=dramai-source',
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      'src/demo.ts',
      '--port',
      '0',
      '--mock-port',
      '0',
      ...args,
    ],
    { cwd: root, env: { ...process.env, INIT_CWD: userDir }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let out = ''
  let err = ''
  child.stdout!.on('data', (d) => (out += d.toString()))
  child.stderr!.on('data', (d) => (err += d.toString()))
  const end = Date.now() + 30_000
  while (
    !/(?:Mock providers|模拟服务商|模擬服務商)[^\n]*http/.test(out) ||
    !new RegExp('═'.repeat(64) + '\\r?\\n\\r?\\n').test(out)
  ) {
    if (child.exitCode !== null)
      throw new Error(`demo exited early (${child.exitCode}): ${err}${out}`)
    if (Date.now() > end) throw new Error(`demo did not start: ${err}${out}`)
    await new Promise((r) => setTimeout(r, 50))
  }
  const appUrl = /(?:App \/ API|界面 \/ 接口|介面 \/ API)\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(
    out,
  )![1]!
  const r: Running = {
    child,
    out: () => out,
    err: () => err,
    appUrl,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve()
        child.once('exit', () => resolve())
        child.kill('SIGTERM')
      }),
  }
  running.push(r)
  return r
}

describe('pnpm demo with relative paths', () => {
  it('--data-dir and --static-dir are resolved against the directory the user ran it in', async () => {
    const userDir = await realpath(await mkdtemp(join(tmpdir(), 'dramai-demo-user-')))
    try {
      await mkdir(join(userDir, 'site'), { recursive: true })
      await writeFile(join(userDir, 'site', 'index.html'), '<!doctype html><title>mine</title>')
      const demo = await startDemo(userDir, [
        '--data-dir',
        'state/demo',
        '--static-dir',
        'site',
        '--lang',
        'en',
      ])
      // 数据落在用户的目录里，而不是包目录里
      expect((await stat(join(userDir, 'state', 'demo', 'dramai.sqlite'))).isFile()).toBe(true)
      await expect(stat(join(root, 'state'))).rejects.toThrow()
      expect(demo.out()).toContain(join(userDir, 'state', 'demo'))
      expect(demo.out()).toContain(join(userDir, 'site'))
      // 前端目录也是：首页就是用户目录里的那个文件
      const home = await fetch(`${demo.appUrl}/`)
      expect(await home.text()).toContain('<title>mine</title>')
    } finally {
      await rm(userDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  }, 60_000)

  it('--lang en: English banner, English provider names and notice; restarting in zh renames them without duplicating', async () => {
    const userDir = await realpath(await mkdtemp(join(tmpdir(), 'dramai-demo-user-')))
    try {
      const first = await startDemo(userDir, ['--data-dir', 'd', '--lang', 'en'])
      expect(first.out()).toContain('DEMO MODE')
      expect(first.out()).toContain('Nothing is charged')
      const en = createClient({ baseUrl: first.appUrl, locale: 'en' })
      const labels = (await en.call('providers.list')).items.map((p) => p.label)
      expect(labels).toHaveLength(6)
      expect(labels.every((l) => l.startsWith('Demo ·'))).toBe(true)
      expect((await en.call('system.get')).demo).toMatchObject({
        active: true,
        notice: expect.stringContaining('Demo mode'),
      })
      expect(
        (await createClient({ baseUrl: first.appUrl }).call('system.get')).demo.notice,
      ).toContain('演示模式')
      await first.stop()

      const second = await startDemo(userDir, ['--data-dir', 'd'])
      expect(second.out()).toContain('演示模式')
      const zh = createClient({ baseUrl: second.appUrl })
      const after = (await zh.call('providers.list')).items
      expect(after).toHaveLength(6) // 没有重复创建
      expect(after.every((p) => p.label.startsWith('演示 ·'))).toBe(true)
      // 第二次的模拟服务商端口变了：配置的地址也跟着更新
      const mockUrl = /(?:Mock providers|模拟服务商|模擬服務商)\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(
        second.out(),
      )![1]!
      expect(after.every((p) => p.baseUrl === mockUrl)).toBe(true)
    } finally {
      await rm(userDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  }, 90_000)

  it('--lang zh-Hant: Traditional banner, provider names and notice (Taiwan wording: 影片)', async () => {
    const userDir = await realpath(await mkdtemp(join(tmpdir(), 'dramai-demo-user-')))
    try {
      const demo = await startDemo(userDir, ['--data-dir', 'd', '--lang', 'zh-Hant'])
      expect(demo.out()).toContain('這是演示')
      expect(demo.out()).toContain('影片')
      const items = (await createClient({ baseUrl: demo.appUrl }).call('providers.list')).items
      expect(items).toHaveLength(6)
      expect(items.every((p) => p.label.startsWith('演示 ·'))).toBe(true)
      expect(items.some((p) => p.label.includes('圖生影片'))).toBe(true)
      expect(items.map((p) => p.label).join('')).not.toMatch(/视频|图生/) // no Simplified leftovers
      const notice = (
        await createClient({ baseUrl: demo.appUrl, locale: 'zh-TW' }).call('system.get')
      ).demo.notice
      expect(notice).toContain('不會產生任何費用')
      // the same data dir started again in English renames, not duplicates
      await demo.stop()
      const again = await startDemo(userDir, ['--data-dir', 'd', '--lang', 'en'])
      expect(
        (await createClient({ baseUrl: again.appUrl }).call('providers.list')).items,
      ).toHaveLength(6)
    } finally {
      await rm(userDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  }, 90_000)

  it('rejects a bad --lang with one clear line and a non-zero exit', async () => {
    const out = await new Promise<{ code: number | null; err: string }>((resolve) => {
      const c = spawn(
        process.execPath,
        [
          '--conditions=dramai-source',
          '--experimental-strip-types',
          '--disable-warning=ExperimentalWarning',
          'src/demo.ts',
          '--lang',
          'fr',
        ],
        { cwd: root },
      )
      let err = ''
      c.stderr.on('data', (d) => (err += d.toString()))
      c.on('exit', (code) => resolve({ code, err }))
    })
    expect(out.code).toBe(1)
    expect(out.err.trim().split(/\r?\n/)).toHaveLength(1)
    expect(out.err).toContain('--lang')
  })
})
