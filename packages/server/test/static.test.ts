import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'

let outer = ''
let dist = ''
beforeEach(async () => {
  outer = await mkdtemp(join(tmpdir(), 'dramai-static-'))
  dist = join(outer, 'dist')
  await mkdir(join(dist, 'assets'), { recursive: true })
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>app</title>')
  await writeFile(join(dist, 'assets', 'app-1.js'), 'console.log(1)')
  await writeFile(join(outer, 'secret.txt'), 'outside the static root')
})
afterEach(async () => {
  await cleanupAll()
  await rm(outer, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

describe('static frontend hosting: paths that mean something else on Windows never reach a file', () => {
  it('serves assets and falls back to index.html for app routes', async () => {
    const h = await startServer({ startWorker: false, staticDir: dist })
    const js = await h.raw('/assets/app-1.js')
    expect(js.status).toBe(200)
    expect(await js.text()).toBe('console.log(1)')
    const route = await h.raw('/projects/p1/episodes')
    expect(route.status).toBe(200)
    expect(await route.text()).toContain('<title>app</title>')
    expect((await h.raw('/assets/missing.js')).status).toBe(404)
  })

  it('refuses traversal in every spelling: ../, ..\\, encoded, drive letters, alternate data streams', async () => {
    const h = await startServer({ startWorker: false, staticDir: dist })
    const attempts = [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/..%5csecret.txt',
      '/assets/..%5c..%5csecret.txt',
      '/%2e%2e%5csecret.txt',
      '/C:/Windows/win.ini',
      '/C%3A/Windows/win.ini',
      '/assets/app-1.js:stream',
      '/assets/app-1.js::$DATA',
      '/index.html::$DATA',
      '/assets/app-1.js%00.png',
    ]
    for (const p of attempts) {
      const res = await h.raw(p)
      const body = await res.text()
      expect(body, p).not.toContain('outside the static root')
      expect(body, p).not.toBe('console.log(1)')
      // Either not found, or the SPA page for a route that does not look like a file — never the file itself.
      if (res.status === 200) expect(body, p).toBe('<!doctype html><title>app</title>')
      else expect(res.status, p).toBe(404)
    }
  })
})
