import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

const root = join(import.meta.dirname, '..')

function runDev(env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [
        '--conditions=dramai-source',
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        'src/dev.ts',
      ],
      { cwd: root, env: { ...process.env, PORT: '0', ...env }, timeout: 20_000 },
      (error, stdout, stderr) => {
        resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr })
      },
    )
  })
}

describe('dev entry', () => {
  it('prints one clear line and exits non-zero when the data dir is already in use (no stack trace)', async () => {
    const h = await startServer()
    const r = await runDev({ DRAMAI_DATA_DIR: h.dataDir })
    expect(r.code).toBe(1)
    const lines = r.stderr.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^dramai: 无法启动：数据目录已被另一个 dramai 实例占用/)
    expect(r.stderr).not.toMatch(/\n\s+at /)
    expect(r.stdout).toBe('')
  })
})

describe('system info', () => {
  it('reports the real package version', async () => {
    const h = await startServer()
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
    expect((await h.client.call('system.get')).version).toBe(pkg.version)
    expect(pkg.version).not.toBe('0.0.0')
  })
})
