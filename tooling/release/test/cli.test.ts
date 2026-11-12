import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
let root: string

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      CLI,
      ...args,
      '--root',
      root,
    ],
    { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', ...env } },
  )
  return { code: r.status, out: r.stdout, err: r.stderr }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dramai-release-cli-'))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
  writeFileSync(
    join(root, 'package.json'),
    '{\n  "name": "root",\n  "version": "0.5.0-beta.1"\n}\n',
  )
  mkdirSync(join(root, 'packages/a'), { recursive: true })
  writeFileSync(
    join(root, 'packages/a/package.json'),
    '{\n  "name": "a",\n  "version": "0.5.0-beta.1"\n}\n',
  )
  writeFileSync(
    join(root, 'CHANGELOG.md'),
    '## [Unreleased]\n\n## [0.5.0-beta.1] - 2026-12-01\n\n- Beta\n',
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('cli', () => {
  it('check passes and exports version / tag / prerelease for GitHub Actions', () => {
    const outFile = join(root, 'gh-output')
    const r = run(['check', '--tag', 'v0.5.0-beta.1'], { GITHUB_OUTPUT: outFile })
    expect(r.code).toBe(0)
    expect(readFileSync(outFile, 'utf8')).toBe(
      'version=0.5.0-beta.1\ntag=v0.5.0-beta.1\nprerelease=true\n',
    )
  })

  it('check fails on a tag mismatch with a ::error:: annotation', () => {
    const r = run(['check', '--tag', 'v0.5.0'])
    expect(r.code).toBe(1)
    expect(r.err).toContain(
      '::error::Tag "v0.5.0" is version 0.5.0, but the repository is at 0.5.0-beta.1',
    )
  })

  it('set then check round-trips', () => {
    expect(run(['set', '0.5.0']).code).toBe(0)
    const r = run(['check', '--tag', 'v0.5.0'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('All 2 packages are at 0.5.0 (matches tag v0.5.0)')
  })

  it('set --dry-run leaves the files alone', () => {
    const r = run(['set', '--dry-run', '0.6.0'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('[dry-run] package.json: 0.5.0-beta.1 -> 0.6.0')
    expect(run(['check']).code).toBe(0)
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('0.5.0-beta.1')
  })

  it('set rejects a bad version with a non-zero exit', () => {
    const r = run(['set', 'banana'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('not a valid semantic version')
  })

  it('notes prints the section, writes --out, and exits 3 when the section is missing', () => {
    expect(run(['notes', '0.5.0-beta.1']).out.trim()).toBe('- Beta')
    const outFile = join(root, 'notes.md')
    expect(run(['notes', '0.5.0-beta.1', '--out', outFile]).code).toBe(0)
    expect(readFileSync(outFile, 'utf8')).toBe('- Beta\n')
    expect(run(['notes', '1.0.0']).code).toBe(3)
  })

  it('collect copies the installers for one platform and warns about stray files', () => {
    mkdirSync(join(root, 'release'))
    writeFileSync(join(root, 'release/dramai-0.5.0-beta.1-win-x64.exe'), 'x')
    writeFileSync(join(root, 'release/dramai-setup.exe'), 'x')
    const r = run([
      'collect',
      '--dir',
      'release',
      '--out',
      'staging',
      '--version',
      '0.5.0-beta.1',
      '--family',
      'win',
      '--arch',
      'x64',
    ])
    expect(r.code).toBe(0)
    expect(r.out).toContain('asset: dramai-0.5.0-beta.1-win-x64.exe')
    expect(r.out).toContain('::warning::Ignoring dramai-setup.exe')
    expect(readFileSync(join(root, 'staging/dramai-0.5.0-beta.1-win-x64.exe'), 'utf8')).toBe('x')
  })

  it('collect fails when the platform produced nothing usable', () => {
    mkdirSync(join(root, 'release'))
    const r = run([
      'collect',
      '--dir',
      'release',
      '--out',
      'staging',
      '--version',
      '0.5.0-beta.1',
      '--family',
      'mac',
      '--arch',
      'arm64',
    ])
    expect(r.code).toBe(1)
    expect(r.err).toContain('::error::No installer named')
  })
})
