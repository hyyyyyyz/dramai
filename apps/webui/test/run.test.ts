import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as netServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openUrl, run, type Running } from '../src/main.ts'

let tmp: string
let staticDir: string
const running: Running[] = []
const blockers: Server[] = []

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'dramai-webui-'))
  staticDir = join(tmp, 'web')
  mkdirSync(staticDir)
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>dramai-test</title>')
})
afterEach(async () => {
  for (const r of running.splice(0)) await r.stop()
  for (const b of blockers.splice(0)) await new Promise((res) => b.close(res))
  rmSync(tmp, { recursive: true, force: true })
})

const capture = () => {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } }
}
const env = { DRAMAI_LANG: 'zh' }
const base = (extra: string[] = []) => [
  '--port',
  '0',
  '--data-dir',
  join(tmp, 'data'),
  '--static-dir',
  staticDir,
  '--no-open',
  ...extra,
]

describe('run', () => {
  it('starts the server, serves the workspace and prints the address', async () => {
    const c = capture()
    const opened: string[] = []
    const code = await run(base(), env, c.io, {
      onRunning: (r) => running.push(r),
      open: async (u) => (opened.push(u), true),
    })
    expect(code).toBe(0)
    expect(opened).toEqual([]) // --no-open
    const url = running[0]!.url
    expect(c.out.join('\n')).toContain(url)
    const html = await (await fetch(`${url}/`)).text()
    expect(html).toContain('dramai-test')
    const system = (await (await fetch(`${url}/api/system`)).json()) as {
      version: string
      demo: { active: boolean }
    }
    expect(system.demo.active).toBe(false)
  })

  it('opens the browser with the token in the address when one is set', async () => {
    const c = capture()
    const opened: string[] = []
    const token = 'a'.repeat(24)
    const args = base(['--token', token]).filter((a) => a !== '--no-open')
    const code = await run(args, env, c.io, {
      onRunning: (r) => running.push(r),
      open: async (u) => (opened.push(u), true),
    })
    expect(code).toBe(0)
    expect(opened).toHaveLength(1)
    expect(opened[0]).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/\\?token=${token}$`))
    // 没有令牌的请求被拒绝
    expect((await fetch(`${running[0]!.url}/api/system`)).status).toBe(401)
  })

  it('a non-loopback host without a token fails with one clear line and a non-zero code', async () => {
    const c = capture()
    const code = await run(base(['--host', '0.0.0.0']), env, c.io)
    expect(code).toBe(1)
    expect(c.err).toHaveLength(1)
    expect(c.err[0]).toMatch(/^dramai: 无法启动：.*令牌/)
    expect(running).toHaveLength(0)
  })

  it('English messages when asked', async () => {
    const c = capture()
    const code = await run(base(['--host', '0.0.0.0']), { DRAMAI_LANG: 'en' }, c.io)
    expect(code).toBe(1)
    expect(c.err[0]).toMatch(/^dramai: cannot start: .*token/)
  })

  it('a second instance on the same data directory fails clearly', async () => {
    const c1 = capture()
    expect(await run(base(), env, c1.io, { onRunning: (r) => running.push(r) })).toBe(0)
    const c2 = capture()
    const code = await run(base(), env, c2.io)
    expect(code).toBe(1)
    expect(c2.err).toHaveLength(1)
    expect(c2.err[0]).toContain('已被另一个 dramai 占用')
  })

  it('a port that is already taken fails clearly', async () => {
    const blocker = netServer()
    blockers.push(blocker)
    await new Promise<void>((res) => blocker.listen(0, '127.0.0.1', res))
    const port = (blocker.address() as { port: number }).port
    const c = capture()
    const args = base().map((a, i, all) => (all[i - 1] === '--port' ? String(port) : a))
    const code = await run(args, env, c.io)
    expect(code).toBe(1)
    expect(c.err[0]).toContain(`端口 ${port} 已被占用`)
  })

  it('missing build output is reported, not a stack trace', async () => {
    const c = capture()
    const code = await run(
      base().map((a) => (a === staticDir ? join(tmp, 'nope') : a)),
      env,
      c.io,
    )
    expect(code).toBe(1)
    expect(c.err[0]).toContain('找不到前端构建产物')
  })

  it('--help and --version exit 0 without starting a server', async () => {
    const c = capture()
    expect(await run(['--help'], env, c.io)).toBe(0)
    expect(c.out.join('\n')).toContain('--no-open')
    const v = capture()
    expect(await run(['--version'], env, v.io)).toBe(0)
    expect(v.out[0]).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('openUrl', () => {
  it('uses localhost for wildcard binds and appends the token', () => {
    expect(openUrl('http://0.0.0.0:8787', undefined)).toBe('http://localhost:8787')
    expect(openUrl('http://127.0.0.1:8787', 'tok-en')).toBe('http://127.0.0.1:8787/?token=tok-en')
  })
})
