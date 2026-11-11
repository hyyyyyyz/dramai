import { describe, expect, it } from 'vitest'
import { parseCli } from '../src/args.ts'
import { messages } from '../src/messages.ts'

const zh = messages.zh
const parse = (argv: string[], env: Record<string, string> = {}) => parseCli(argv, env, zh, '/work')

describe('parseCli', () => {
  it('defaults: loopback, 8787, opens the browser', () => {
    const r = parse([])
    expect(r.kind).toBe('run')
    if (r.kind !== 'run') return
    expect(r.options).toMatchObject({ port: 8787, host: '127.0.0.1', open: true, token: undefined })
    expect(r.options.dataDir.endsWith('/.dramai')).toBe(true)
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
      options: { port: 9000, dataDir: '/work/data', token: 'x'.repeat(20), open: false },
    })
  })

  it('command line wins over the environment', () => {
    const r = parse(['--port', '9000'], { DRAMAI_PORT: '9100', DRAMAI_DATA_DIR: '/env' })
    expect(r).toMatchObject({ kind: 'run', options: { port: 9000, dataDir: '/env' } })
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
