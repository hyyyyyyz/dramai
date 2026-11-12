import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { ServerHost, ServerStartError } from '../src/main/server-host.ts'
import type { ChildHandle, SecretBackend } from '../src/main/server-host.ts'
import type { HostToServer, ServerStartOptions, ServerToHost } from '../src/shared/protocol.ts'

class FakeChild extends EventEmitter implements ChildHandle {
  sent: HostToServer[] = []
  killed = false
  postMessage(m: HostToServer) {
    this.sent.push(m)
    this.onSend?.(m)
  }
  onSend?: (m: HostToServer) => void
  kill() {
    this.killed = true
    queueMicrotask(() => this.emit('exit', 0))
    return true
  }
  say(m: ServerToHost) {
    this.emit('message', m)
  }
}

const OPTIONS: ServerStartOptions = {
  dataDir: '/data',
  port: 0,
  token: 't'.repeat(32),
  version: '0.0.0',
}

const secrets = (): SecretBackend & { store: Map<string, string> } => {
  const store = new Map<string, string>()
  return {
    store,
    get: async (ref) => store.get(ref),
    set: async (ref, v) => void store.set(ref, v),
    delete: async (ref) => void store.delete(ref),
    has: async (ref) => store.has(ref),
  }
}

function setup(extra: Partial<ConstructorParameters<typeof ServerHost>[0]> = {}) {
  const child = new FakeChild()
  const logs: string[] = []
  const host = new ServerHost({
    fork: () => child,
    secrets: secrets(),
    log: (_l, t) => logs.push(t),
    ...extra,
  })
  return { child, host, logs }
}

describe('ServerHost lifecycle', () => {
  it('starts the server, passes the options (token included) over the message channel, and reports the url', async () => {
    const { child, host } = setup()
    const started = host.start(OPTIONS)
    expect(child.sent[0]).toEqual({ type: 'start', options: OPTIONS })
    child.say({ type: 'ready', url: 'http://127.0.0.1:4321', port: 4321 })
    await expect(started).resolves.toEqual({ url: 'http://127.0.0.1:4321', port: 4321 })
    expect(host.state).toBe('running')
    expect(host.url).toBe('http://127.0.0.1:4321')
  })

  it('rejects with a typed error when the server reports a start failure, and kills the child', async () => {
    const { child, host } = setup()
    const started = host.start(OPTIONS)
    child.say({ type: 'start.failed', code: 'DATA_DIR_LOCKED', message: 'locked' })
    await expect(started).rejects.toMatchObject({
      name: 'ServerStartError',
      code: 'DATA_DIR_LOCKED',
    })
    expect(child.killed).toBe(true)
    expect(host.state).toBe('idle') // can be retried
  })

  it('rejects when the process dies before it is ready', async () => {
    const { child, host } = setup()
    const started = host.start(OPTIONS)
    child.emit('exit', 1)
    await expect(started).rejects.toBeInstanceOf(ServerStartError)
    expect(host.state).toBe('idle')
  })

  it('rejects when the server takes too long to start', async () => {
    const { host } = setup({ startTimeoutMs: 20 })
    await expect(host.start(OPTIONS)).rejects.toMatchObject({ code: 'UNKNOWN' })
  })

  it('refuses a second start while running', async () => {
    const { child, host } = setup()
    const started = host.start(OPTIONS)
    child.say({ type: 'ready', url: 'http://127.0.0.1:1', port: 1 })
    await started
    await expect(host.start(OPTIONS)).rejects.toThrow(/running/)
  })

  it('emits "crashed" when the server process exits on its own', async () => {
    const { child, host } = setup()
    const crashed = vi.fn()
    host.on('crashed', crashed)
    const started = host.start(OPTIONS)
    child.say({ type: 'ready', url: 'http://127.0.0.1:1', port: 1 })
    await started
    child.emit('exit', 139)
    expect(crashed).toHaveBeenCalledWith(139)
    expect(host.state).toBe('idle')
  })

  it('stop(): asks the server to close (without waiting for running jobs), then ends the process, and does not report a crash', async () => {
    const { child, host } = setup()
    const crashed = vi.fn()
    host.on('crashed', crashed)
    const started = host.start(OPTIONS)
    child.say({ type: 'ready', url: 'http://127.0.0.1:1', port: 1 })
    await started
    child.onSend = (m) => m.type === 'stop' && queueMicrotask(() => child.say({ type: 'stopped' }))
    await host.stop()
    expect(child.sent.at(-1)).toEqual({ type: 'stop', graceful: false })
    expect(child.killed).toBe(true)
    expect(crashed).not.toHaveBeenCalled()
    expect(host.state).toBe('idle')
  })

  it('stop(): kills a server that does not answer in time', async () => {
    const { child, host, logs } = setup({ stopTimeoutMs: 20 })
    const started = host.start(OPTIONS)
    child.say({ type: 'ready', url: 'http://127.0.0.1:1', port: 1 })
    await started
    await host.stop()
    expect(child.killed).toBe(true)
    expect(logs.some((l) => /did not stop in time/.test(l))).toBe(true)
  })

  it('stop() when nothing is running is a no-op', async () => {
    const { host } = setup()
    await expect(host.stop()).resolves.toBeUndefined()
  })
})

describe('ServerHost secrets bridge', () => {
  async function running() {
    const s = setup({ secrets: undefined as never })
    return s
  }
  void running

  it('serves get / set / has / delete requests from the server out of the main-process vault', async () => {
    const vault = secrets()
    const { child, host } = setup({ secrets: vault })
    const started = host.start(OPTIONS)
    child.say({ type: 'ready', url: 'http://127.0.0.1:1', port: 1 })
    await started
    const reply = () => new Promise<HostToServer>((resolve) => (child.onSend = resolve))

    let r = reply()
    child.say({ type: 'secret.request', id: 1, op: 'set', ref: 'provider:a', value: 'sk-123' })
    expect(await r).toMatchObject({ type: 'secret.result', id: 1, ok: true })
    expect(vault.store.get('provider:a')).toBe('sk-123')

    r = reply()
    child.say({ type: 'secret.request', id: 2, op: 'get', ref: 'provider:a' })
    expect(await r).toMatchObject({ id: 2, ok: true, value: 'sk-123' })

    r = reply()
    child.say({ type: 'secret.request', id: 3, op: 'has', ref: 'provider:a' })
    expect(await r).toMatchObject({ id: 3, value: true })

    r = reply()
    child.say({ type: 'secret.request', id: 4, op: 'get', ref: 'missing' })
    expect(await r).toMatchObject({ id: 4, ok: true, value: null })

    r = reply()
    child.say({ type: 'secret.request', id: 5, op: 'delete', ref: 'provider:a' })
    await r
    expect(vault.store.has('provider:a')).toBe(false)
  })

  it('reports a failing vault back to the server without leaking the value into the log', async () => {
    const failing: SecretBackend = {
      get: async () => undefined,
      set: async () => {
        throw new Error('disk full')
      },
      delete: async () => {},
      has: async () => false,
    }
    const { child, host, logs } = setup({ secrets: failing })
    const started = host.start(OPTIONS)
    child.say({ type: 'ready', url: 'http://127.0.0.1:1', port: 1 })
    await started
    const reply = new Promise<HostToServer>((resolve) => (child.onSend = resolve))
    child.say({ type: 'secret.request', id: 9, op: 'set', ref: 'x', value: 'sk-very-secret' })
    expect(await reply).toMatchObject({ id: 9, ok: false, error: 'disk full' })
    expect(logs.join('\n')).not.toContain('sk-very-secret')
  })
})
