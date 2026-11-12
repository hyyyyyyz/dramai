import { stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { cleanupAllWith, startServer } from './helpers.ts'

describe('test harness cleanup order (a Windows lesson: open files cannot be deleted)', () => {
  it('stops every server before any data directory is removed, even when a restart shares the directory', async () => {
    const h1 = await startServer({ startWorker: false })
    await h1.stop() // the "killed" first process
    const h2 = await startServer({ startWorker: false, dataDir: h1.dataDir }) // the restarted one, same directory
    const open: string[] = []
    const removed: string[] = []
    await cleanupAllWith(async (dir) => {
      // at this point nothing may still hold files in the directory: the second server must already be down
      for (const h of [h1, h2]) {
        const up = await fetch(`${h.server.url}/api/health`).then(
          () => true,
          () => false,
        )
        if (up) open.push(h.server.url)
      }
      removed.push(dir)
      const { rm } = await import('node:fs/promises')
      await rm(dir, { recursive: true, force: true })
    })
    expect(open).toEqual([])
    expect(removed).toEqual([h1.dataDir]) // once, and only the directory the harness created
    await expect(stat(h1.dataDir)).rejects.toThrow()
  })
})
