import { describe, expect, it, vi } from 'vitest'
import { acquireSingleInstance } from '../src/main/single-instance.ts'
import type { SingleInstanceApp } from '../src/main/single-instance.ts'

function fakeApp(lock: boolean) {
  const listeners: Array<(event: unknown, argv: string[]) => void> = []
  const app: SingleInstanceApp = {
    requestSingleInstanceLock: () => lock,
    on: (_event, listener) => void listeners.push(listener),
    quit: vi.fn(),
  }
  return { app, listeners }
}

describe('single instance', () => {
  it('the first launch keeps running and focuses the window when a second one starts', () => {
    const { app, listeners } = fakeApp(true)
    const focus = vi.fn()
    expect(acquireSingleInstance(app, focus)).toBe(true)
    expect(app.quit).not.toHaveBeenCalled()
    listeners[0]!({}, ['dramai'])
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('a second launch quits itself and does not register a listener', () => {
    const { app, listeners } = fakeApp(false)
    const focus = vi.fn()
    expect(acquireSingleInstance(app, focus)).toBe(false)
    expect(app.quit).toHaveBeenCalledTimes(1)
    expect(listeners).toHaveLength(0)
  })
})
