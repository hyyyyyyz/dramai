import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { expandHome, parseCli, posixPaths, win32Paths } from '../src/args.ts'
import { browserCommand } from '../src/open-browser.ts'
import { messages } from '../src/messages.ts'

const zh = messages.zh
const parse = (argv: string[], env: Record<string, string> = {}) => parseCli(argv, env, zh, '/work')

describe('parseCli', () => {
  it('defaults: loopback, 8787, opens the browser', () => {
    const r = parse([])
    expect(r.kind).toBe('run')
    if (r.kind !== 'run') return
    expect(r.options).toMatchObject({ port: 8787, host: '127.0.0.1', open: true, token: undefined })
    // native path rules of the machine the test runs on (POSIX here, drive letters and backslashes on Windows)
    expect(r.options.dataDir).toBe(join(homedir(), '.dramai'))
  })

  it('takes port, data dir, token and --no-open', () => {
    const r = parse([
      '--port',
      '9000',
      '--data-dir',
      'data',
      '--token',
      'x'.repeat(20),
      '--no-open',
    ])
    expect(r).toMatchObject({
      kind: 'run',
      options: {
        port: 9000,
        dataDir: resolve('/work', 'data'),
        token: 'x'.repeat(20),
        open: false,
      },
    })
  })

  it('command line wins over the environment', () => {
    const r = parse(['--port', '9000'], { DRAMAI_PORT: '9100', DRAMAI_DATA_DIR: '/env' })
    expect(r).toMatchObject({
      kind: 'run',
      options: { port: 9000, dataDir: resolve('/work', '/env') },
    })
  })

  it('tolerates the habitual leading `--` that `pnpm webui -- …` passes along', () => {
    const r = parse(['--', '--no-open', '--port', '9000'])
    expect(r).toMatchObject({ kind: 'run', options: { port: 9000, open: false } })
    // only a leading one: a later `--` still ends the options, and positionals stay refused
    expect(parse(['--port', '9000', '--', '--no-open']).kind).toBe('error')
    expect(parse(['--', 'stray']).kind).toBe('error')
  })

  it('a non-loopback host requires a token, with a clear message', () => {
    for (const host of ['0.0.0.0', '192.168.1.5', 'myhost.lan']) {
      const r = parse(['--host', host])
      expect(r.kind).toBe('error')
      if (r.kind === 'error') expect(r.message).toContain('DRAMAI_TOKEN')
    }
    expect(parse(['--host', '0.0.0.0', '--token', 'x'.repeat(16)]).kind).toBe('run')
    expect(parse(['--host', 'localhost']).kind).toBe('run')
    expect(parse(['--host', '[::1]']).kind).toBe('run')
  })

  it('rejects a short token and a bad port', () => {
    expect(parse(['--token', 'short']).kind).toBe('error')
    expect(parse(['--port', 'abc']).kind).toBe('error')
    expect(parse(['--port', '70000']).kind).toBe('error')
    expect(parse(['--port', '-1']).kind).toBe('error')
  })

  it('unknown options are an error, help and version short-circuit', () => {
    expect(parse(['--nope']).kind).toBe('error')
    expect(parse(['--port']).kind).toBe('error')
    expect(parse(['-h']).kind).toBe('help')
    expect(parse(['--version']).kind).toBe('version')
  })
})

describe('Windows rules, exercised on any machine', () => {
  const home = 'C:\\Users\\me'
  const win = (argv: string[], env: Record<string, string> = {}, cwd = 'C:\\work') =>
    parseCli(argv, env, zh, cwd, win32Paths(home))
  const dir = (r: ReturnType<typeof win>) => (r.kind === 'run' ? r.options.dataDir : r)

  it('the default data directory is under the user profile', () => {
    expect(dir(win([]))).toBe('C:\\Users\\me\\.dramai')
  })
  it('relative paths resolve against the current directory with backslashes', () => {
    expect(dir(win(['--data-dir', 'data']))).toBe('C:\\work\\data')
    expect(dir(win(['--data-dir', '..\\other\\data']))).toBe('C:\\other\\data')
  })
  it('absolute paths keep their drive, forward slashes are accepted, UNC paths stay UNC', () => {
    expect(dir(win(['--data-dir', 'D:\\dramai\\data']))).toBe('D:\\dramai\\data')
    expect(dir(win(['--data-dir', 'D:/dramai/data']))).toBe('D:\\dramai\\data')
    expect(dir(win(['--data-dir', '\\\\nas\\share\\dramai']))).toBe('\\\\nas\\share\\dramai')
  })
  it('a path on another drive than the current one is not glued to the cwd', () => {
    expect(dir(win(['--data-dir', 'E:\\x'], {}, 'C:\\work'))).toBe('E:\\x')
  })
  it('~ is expanded here because cmd.exe and PowerShell do not do it', () => {
    expect(dir(win(['--data-dir', '~\\dramai-data']))).toBe('C:\\Users\\me\\dramai-data')
    expect(dir(win(['--data-dir', '~/dramai-data']))).toBe('C:\\Users\\me\\dramai-data')
    expect(dir(win(['--data-dir', '~']))).toBe('C:\\Users\\me')
    // a name that merely starts with ~ is left alone
    expect(dir(win(['--data-dir', '~backup']))).toBe('C:\\work\\~backup')
  })
  it('the environment variable goes through the same rules, and --static-dir too', () => {
    expect(dir(win([], { DRAMAI_DATA_DIR: '~\\env' }))).toBe('C:\\Users\\me\\env')
    const r = win(['--static-dir', 'web'])
    expect(r.kind === 'run' && r.options.staticDir).toBe('C:\\work\\web')
  })
  it('POSIX rules are unchanged: backslash is an ordinary character and ~\\ is not expanded', () => {
    expect(expandHome('~/x', posixPaths('/home/me'))).toBe('/home/me/x')
    expect(expandHome('~\\x', posixPaths('/home/me'))).toBe('~\\x')
    const r = parseCli(['--data-dir', 'a'], {}, zh, '/work', posixPaths('/home/me'))
    expect(r.kind === 'run' && r.options.dataDir).toBe('/work/a')
  })
})

describe('opening the browser', () => {
  const url = 'http://localhost:8787/?token=a%26b%25PATH%25%5E'
  it('on Windows the URL is one argument to rundll32, never re-parsed by cmd', () => {
    const [cmd, args] = browserCommand(url, 'win32')
    expect(cmd).toBe('rundll32')
    expect(args).toEqual(['url.dll,FileProtocolHandler', url])
    expect(cmd).not.toBe('cmd')
  })
  it('macOS and Linux use open and xdg-open', () => {
    expect(browserCommand(url, 'darwin')).toEqual(['open', [url]])
    expect(browserCommand(url, 'linux')).toEqual(['xdg-open', [url]])
  })
})
