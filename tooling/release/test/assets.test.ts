import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CollectError,
  RELEASE_TARGETS,
  REQUIRED_KINDS,
  collectAssets,
  expectedInstallers,
  verifyReleaseSet,
} from '../src/assets.ts'

let dir: string
let out: string

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'dramai-assets-'))
  dir = join(base, 'release')
  out = join(base, 'staging')
  mkdirSync(dir)
})

afterEach(() => {
  rmSync(join(dir, '..'), { recursive: true, force: true })
})

function touch(...names: string[]): void {
  for (const n of names) writeFileSync(join(dir, n), 'x')
}

function problemsOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(CollectError)
    return (error as CollectError).problems
  }
  throw new Error('expected collectAssets to throw')
}

describe('expectedInstallers (the single definition of what each system must produce)', () => {
  it('lists two installer kinds per system, named dramai-<version>-<os>-<arch>.<ext>', () => {
    expect(REQUIRED_KINDS).toEqual({
      mac: ['dmg', 'zip'],
      win: ['exe', 'zip'],
      linux: ['AppImage', 'tar.gz'],
    })
    expect(expectedInstallers('0.5.0', 'mac', 'arm64')).toEqual([
      'dramai-0.5.0-mac-arm64.dmg',
      'dramai-0.5.0-mac-arm64.zip',
    ])
    expect(expectedInstallers('0.5.0-beta.1', 'win', 'x64')).toEqual([
      'dramai-0.5.0-beta.1-win-x64.exe',
      'dramai-0.5.0-beta.1-win-x64.zip',
    ])
    expect(expectedInstallers('0.5.0', 'linux', 'x64')).toEqual([
      'dramai-0.5.0-linux-x64.AppImage',
      'dramai-0.5.0-linux-x64.tar.gz',
    ])
  })
})

describe('collectAssets: everything is there', () => {
  const cases = [
    ['mac', 'arm64'],
    ['mac', 'x64'],
    ['win', 'x64'],
    ['linux', 'x64'],
  ] as const

  it.each(cases)('%s-%s: collects both installers and ignores side files', (family, arch) => {
    const files = expectedInstallers('0.5.0', family, arch)
    touch(
      ...files,
      ...files.map((f) => `${f}.blockmap`),
      'builder-debug.yml',
      'latest.yml',
      'latest-mac.yml',
    )
    mkdirSync(join(dir, 'win-unpacked'))
    mkdirSync(join(dir, 'dramai-0.5.0-mac-arm64.dir'))
    const r = collectAssets({ dir, out, version: '0.5.0', family, arch })
    expect(r.collected).toEqual(files)
    expect(r.ignored).toEqual([])
    expect(readdirSync(out).sort()).toEqual([...files].sort())
  })

  it('reports other dramai-* files that are not installers, without failing', () => {
    touch(...expectedInstallers('0.5.0', 'win', 'x64'), 'dramai-notes.txt')
    const r = collectAssets({ dir, out, version: '0.5.0', family: 'win', arch: 'x64' })
    expect(r.ignored).toEqual(['dramai-notes.txt'])
  })
})

describe('collectAssets: an installer is missing', () => {
  it('fails and names the full expected file name of each missing kind', () => {
    touch('dramai-0.5.0-beta.1-linux-x64.tar.gz')
    const problems = problemsOf(() =>
      collectAssets({ dir, out, version: '0.5.0-beta.1', family: 'linux', arch: 'x64' }),
    )
    expect(problems).toEqual([`Missing dramai-0.5.0-beta.1-linux-x64.AppImage in ${dir}`])
  })

  it('names every missing file, and copies nothing', () => {
    touch('dramai-0.5.0-mac-arm64.dmg.blockmap', 'latest-mac.yml')
    const problems = problemsOf(() =>
      collectAssets({ dir, out, version: '0.5.0', family: 'mac', arch: 'arm64' }),
    )
    expect(problems).toEqual([
      `Missing dramai-0.5.0-mac-arm64.dmg in ${dir}`,
      `Missing dramai-0.5.0-mac-arm64.zip in ${dir}`,
    ])
    expect(() => readdirSync(out)).toThrow()
  })

  it('fails when the directory has no dramai-* files at all', () => {
    touch('latest.yml')
    expect(
      problemsOf(() => collectAssets({ dir, out, version: '0.5.0', family: 'win', arch: 'x64' })),
    ).toHaveLength(2)
  })

  it('fails when the build directory does not exist', () => {
    expect(() =>
      collectAssets({ dir: join(dir, 'nope'), out, version: '0.5.0', family: 'win', arch: 'x64' }),
    ).toThrow(/ENOENT/)
  })
})

describe('collectAssets: an installer is misnamed', () => {
  it('fails on the real file name seen in the dry run (x86_64 instead of x64), with actual and expected names', () => {
    touch('dramai-0.5.0-beta.1-linux-x86_64.AppImage', 'dramai-0.5.0-beta.1-linux-x64.tar.gz')
    const problems = problemsOf(() =>
      collectAssets({ dir, out, version: '0.5.0-beta.1', family: 'linux', arch: 'x64' }),
    )
    expect(problems).toContain(
      'Found dramai-0.5.0-beta.1-linux-x86_64.AppImage, which looks like an installer but is not named as expected; expected dramai-0.5.0-beta.1-linux-x64.AppImage',
    )
    expect(problems).toContain(`Missing dramai-0.5.0-beta.1-linux-x64.AppImage in ${dir}`)
    expect(problems).toHaveLength(2)
  })

  it('fails on a wrong version, a wrong os word and a file from another architecture', () => {
    touch('dramai-0.4.1-mac-arm64.dmg', 'dramai-0.5.0-macos-arm64.zip', 'dramai-0.5.0-mac-x64.dmg')
    const problems = problemsOf(() =>
      collectAssets({ dir, out, version: '0.5.0', family: 'mac', arch: 'arm64' }),
    )
    expect(problems.filter((p) => p.startsWith('Found'))).toHaveLength(3)
    expect(problems.filter((p) => p.startsWith('Missing'))).toHaveLength(2)
  })

  it('fails on an installer kind this system should not produce', () => {
    touch(...expectedInstallers('0.5.0', 'linux', 'x64'), 'dramai-0.5.0-linux-x64.deb')
    const problems = problemsOf(() =>
      collectAssets({ dir, out, version: '0.5.0', family: 'linux', arch: 'x64' }),
    )
    expect(problems).toEqual([
      'Found dramai-0.5.0-linux-x64.deb, which is not an installer this system should produce (expected only dramai-0.5.0-linux-x64.AppImage, dramai-0.5.0-linux-x64.tar.gz)',
    ])
  })
})

describe('verifyReleaseSet (the release job: every system arrived, nothing else)', () => {
  const all = (version: string) =>
    RELEASE_TARGETS.flatMap((t) => expectedInstallers(version, t.family, t.arch))

  it('has four targets with eight installers', () => {
    expect(RELEASE_TARGETS.map((t) => t.name)).toEqual([
      'mac-arm64',
      'mac-x64',
      'win-x64',
      'linux-x64',
    ])
    expect(all('0.5.0')).toHaveLength(8)
  })

  it('passes when all eight are present, ignoring files that are not dramai-*', () => {
    touch(...all('0.5.0'), 'SHA256SUMS.txt')
    expect(verifyReleaseSet(dir, '0.5.0')).toEqual(all('0.5.0'))
  })

  it('fails when a whole system never arrived', () => {
    touch(...all('0.5.0').filter((f) => !f.includes('-win-')))
    const problems = problemsOf(() => verifyReleaseSet(dir, '0.5.0'))
    expect(problems).toEqual([
      'Missing dramai-0.5.0-win-x64.exe: the release would ship without it',
      'Missing dramai-0.5.0-win-x64.zip: the release would ship without it',
    ])
  })

  it('fails on a leftover file from another version or an extra installer', () => {
    touch(...all('0.5.0'), 'dramai-0.4.1-mac-arm64.dmg', 'dramai-0.5.0-linux-x86_64.AppImage')
    const problems = problemsOf(() => verifyReleaseSet(dir, '0.5.0'))
    expect(problems).toEqual([
      'Unexpected dramai-0.4.1-mac-arm64.dmg: not part of this release',
      'Unexpected dramai-0.5.0-linux-x86_64.AppImage: not part of this release',
    ])
  })
})
