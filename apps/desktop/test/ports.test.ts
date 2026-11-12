import { createServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { chooseListenPort, findFreePort, isPortFree } from '../src/main/ports.ts'

const open: Array<ReturnType<typeof createServer>> = []
afterEach(() => {
  for (const s of open.splice(0)) s.close()
})

function occupy(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer()
    open.push(s)
    s.listen(0, '127.0.0.1', () => resolve((s.address() as { port: number }).port))
  })
}

describe('port selection', () => {
  it('findFreePort returns a port that can then be bound', async () => {
    const port = await findFreePort()
    expect(port).toBeGreaterThan(1023)
    expect(await isPortFree(port)).toBe(true)
  })

  it('successive free ports are usable and differ while held', async () => {
    const a = await occupy()
    const b = await findFreePort()
    expect(b).not.toBe(a)
  })

  it('isPortFree is false for a port in use', async () => {
    const port = await occupy()
    expect(await isPortFree(port)).toBe(false)
  })

  it('reuses the preferred (previous) port when it is free, so the page origin stays stable', async () => {
    const free = await findFreePort()
    expect(await chooseListenPort(free)).toBe(free)
  })

  it('lets the system pick (0) when the preferred port is taken or absent', async () => {
    const taken = await occupy()
    expect(await chooseListenPort(taken)).toBe(0)
    expect(await chooseListenPort(undefined)).toBe(0)
  })
})
