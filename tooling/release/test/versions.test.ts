import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkVersions,
  findPackageJsonFiles,
  isPrerelease,
  isSemver,
  normalizeVersion,
  setVersion,
  versionFromTag,
  workspaceGlobs,
} from '../src/versions.ts'

let root: string

function writePkg(dir: string, name: string, version: string, extra = ''): void {
  const full = join(root, dir)
  mkdirSync(full, { recursive: true })
  // 与仓库里 prettier 格式化后的 package.json 同样的缩进和键序
  writeFileSync(
    join(full, 'package.json'),
    `{\n  "name": "${name}",\n  "private": true,\n  "version": "${version}",\n  "files": ["a", "b"]${extra}\n}\n`,
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dramai-release-'))
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    [
      'packages:',
      "  - 'apps/*'",
      "  - 'packages/*'",
      '  - "tooling/*" # shared',
      '',
      '# comment',
      'catalog:',
      '  react: ^19.0.0',
      '',
    ].join('\n'),
  )
  writePkg('.', 'monorepo', '1.2.3')
  writePkg('apps/desktop', '@x/desktop', '1.2.3')
  writePkg('packages/core', '@x/core', '1.2.3')
  writePkg('tooling/tsconfig', '@x/tsconfig', '1.2.3')
  mkdirSync(join(root, 'packages/node_modules/leftpkg'), { recursive: true })
  mkdirSync(join(root, 'packages/empty-dir'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('semver helpers', () => {
  it('accepts plain, prerelease and build versions; rejects the rest', () => {
    for (const v of ['0.5.0', '10.20.30', '1.0.0-beta.1', '1.0.0-rc.1+build.5', '1.0.0+meta']) {
      expect(isSemver(v), v).toBe(true)
    }
    for (const v of ['1', '1.0', '01.0.0', '1.0.0-', 'v1.0.0', '1.0.0.0', '', 'latest']) {
      expect(isSemver(v), v).toBe(false)
    }
  })

  it('treats a suffix as a prerelease and build metadata alone as stable', () => {
    expect(isPrerelease('0.5.0')).toBe(false)
    expect(isPrerelease('0.5.0+sha.abc')).toBe(false)
    expect(isPrerelease('0.5.0-beta.1')).toBe(true)
    expect(isPrerelease('0.5.0-rc.1+build')).toBe(true)
  })

  it('normalizes an optional leading v and explains invalid input', () => {
    expect(normalizeVersion('v0.5.0')).toBe('0.5.0')
    expect(normalizeVersion('0.5.0')).toBe('0.5.0')
    expect(() => normalizeVersion('vv1')).toThrow(/not a valid version/)
    expect(() => normalizeVersion('')).toThrow(/not a valid version/)
  })

  it('reads the version out of a tag ref', () => {
    expect(versionFromTag('v0.5.0')).toBe('0.5.0')
    expect(versionFromTag('refs/tags/v0.5.0-beta.1')).toBe('0.5.0-beta.1')
    expect(() => versionFromTag('0.5.0')).toThrow(/must look like v/)
    expect(() => versionFromTag('release-1')).toThrow(/must look like v/)
    expect(() => versionFromTag('v1.x')).toThrow(/not a valid version/)
    expect(() => versionFromTag('v1.0.0-alpha.1')).toThrow(/not a valid version/)
  })
})

describe('workspace discovery', () => {
  it('parses only the packages: list', () => {
    expect(workspaceGlobs(root)).toEqual(['apps/*', 'packages/*', 'tooling/*'])
  })

  it('finds the root and every workspace package, skipping node_modules and empty dirs', () => {
    expect(findPackageJsonFiles(root)).toEqual([
      'package.json',
      'apps/desktop/package.json',
      'packages/core/package.json',
      'tooling/tsconfig/package.json',
    ])
  })

  it('rejects patterns it cannot expand rather than silently missing packages', () => {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/**'\n")
    expect(() => findPackageJsonFiles(root)).toThrow(/Unsupported workspace pattern/)
  })
})

describe('checkVersions', () => {
  it('passes when every package matches the root version', () => {
    const r = checkVersions(root)
    expect(r).toMatchObject({ ok: true, version: '1.2.3', problems: [] })
    expect(r.packages).toHaveLength(4)
  })

  it('names every package that drifted', () => {
    writePkg('packages/core', '@x/core', '1.2.4')
    writePkg('apps/desktop', '@x/desktop', '0.0.0')
    const r = checkVersions(root)
    expect(r.ok).toBe(false)
    expect(r.problems).toHaveLength(2)
    expect(r.problems.join('\n')).toContain('packages/core/package.json (@x/core) is at "1.2.4"')
    expect(r.problems.join('\n')).toContain('apps/desktop/package.json (@x/desktop) is at "0.0.0"')
  })

  it('fails when a package has no version at all', () => {
    writeFileSync(join(root, 'packages/core/package.json'), '{ "name": "@x/core" }\n')
    const r = checkVersions(root)
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toContain('packages/core/package.json (@x/core) is at ""')
  })

  it('matches a tag to the repository version', () => {
    expect(checkVersions(root, { tag: 'v1.2.3' }).ok).toBe(true)
    expect(checkVersions(root, { tag: 'refs/tags/v1.2.3' }).ok).toBe(true)
  })

  it('fails on a tag/version mismatch and tells how to fix it', () => {
    const r = checkVersions(root, { tag: 'v1.3.0' })
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toContain('Tag "v1.3.0" is version 1.3.0, but the repository is at 1.2.3')
    expect(r.problems[0]).toContain('pnpm version:set 1.3.0')
  })

  it('treats a prerelease tag as different from the stable version', () => {
    expect(checkVersions(root, { tag: 'v1.2.3-beta.1' }).ok).toBe(false)
  })

  it('fails on a malformed tag', () => {
    const r = checkVersions(root, { tag: 'nightly' })
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toMatch(/must look like v/)
  })
})

describe('setVersion', () => {
  it('rewrites every package and keeps the rest of the file byte-identical', () => {
    const before = readFileSync(join(root, 'packages/core/package.json'), 'utf8')
    const r = setVersion(root, 'v2.0.0-rc.1')
    expect(r.version).toBe('2.0.0-rc.1')
    expect(r.changed).toHaveLength(4)
    const after = readFileSync(join(root, 'packages/core/package.json'), 'utf8')
    expect(after).toBe(before.replace('"version": "1.2.3"', '"version": "2.0.0-rc.1"'))
    expect(checkVersions(root).ok).toBe(true)
    expect(checkVersions(root, { tag: 'v2.0.0-rc.1' }).ok).toBe(true)
  })

  it('does not touch nested "version" fields (only the top-level line)', () => {
    writePkg('packages/core', '@x/core', '1.2.3', ',\n  "engines": {\n    "version": "9"\n  }')
    setVersion(root, '1.2.4')
    const pkg = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8')) as {
      version: string
      engines: { version: string }
    }
    expect(pkg.version).toBe('1.2.4')
    expect(pkg.engines.version).toBe('9')
  })

  it('dry-run reports but does not write', () => {
    const r = setVersion(root, '1.3.0', { dryRun: true })
    expect(r.changed).toHaveLength(4)
    expect(checkVersions(root).version).toBe('1.2.3')
  })

  it('is a no-op when everything already has the version', () => {
    expect(setVersion(root, '1.2.3').changed).toEqual([])
  })

  it('brings drifted packages back in line', () => {
    writePkg('apps/desktop', '@x/desktop', '0.0.1')
    const r = setVersion(root, '1.2.3')
    expect(r.changed.map((c) => c.file)).toEqual(['apps/desktop/package.json'])
    expect(checkVersions(root).ok).toBe(true)
  })

  it('refuses an invalid version without writing anything', () => {
    expect(() => setVersion(root, '1.2')).toThrow(/not a valid version/)
    expect(checkVersions(root).version).toBe('1.2.3')
  })

  it('fails loudly when a package.json has no top-level version line', () => {
    writeFileSync(join(root, 'packages/core/package.json'), '{\n  "name": "@x/core"\n}\n')
    expect(() => setVersion(root, '1.3.0')).toThrow(/no top-level "version"/)
  })
})
