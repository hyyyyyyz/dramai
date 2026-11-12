import { describe, expect, it } from 'vitest'
import {
  bumpVersion,
  compareVersions,
  formatVersion,
  parseVersion,
  validateTransition,
  type BumpKind,
} from '../src/rules.ts'

describe('parseVersion', () => {
  it('accepts MAJOR.MINOR.PATCH with an optional -beta.N / -rc.N', () => {
    expect(parseVersion('0.5.0')).toEqual({ major: 0, minor: 5, patch: 0 })
    expect(parseVersion('1.12.3-rc.4')).toEqual({
      major: 1,
      minor: 12,
      patch: 3,
      pre: { id: 'rc', n: 4 },
    })
    expect(parseVersion('0.5.0-beta.1')?.pre).toEqual({ id: 'beta', n: 1 })
  })

  it('rejects everything else', () => {
    for (const v of [
      '1',
      '1.0',
      'v1.0.0',
      '01.0.0',
      '1.0.0-alpha.1',
      '1.0.0-beta',
      '1.0.0-beta.0',
      '1.0.0-beta.01',
      '1.0.0-beta.1.2',
      '1.0.0-rc.1+build',
      '1.0.0+build',
      '1.0.0-',
      '',
    ]) {
      expect(parseVersion(v), v).toBeNull()
    }
  })

  it('round-trips through formatVersion', () => {
    for (const v of ['0.0.1', '0.5.0-beta.1', '10.20.30-rc.12']) {
      expect(formatVersion(parseVersion(v)!)).toBe(v)
    }
  })
})

describe('compareVersions', () => {
  it('orders by major, minor, patch', () => {
    expect(compareVersions('0.5.0', '0.4.9')).toBe(1)
    expect(compareVersions('0.4.9', '0.5.0')).toBe(-1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.5.1', '0.5.1')).toBe(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1) // 数字比较，不是字符串
  })

  it('puts prereleases below the release and beta below rc', () => {
    expect(compareVersions('0.5.0-beta.1', '0.5.0')).toBe(-1)
    expect(compareVersions('0.5.0', '0.5.0-rc.9')).toBe(1)
    expect(compareVersions('0.5.0-beta.9', '0.5.0-rc.1')).toBe(-1)
    expect(compareVersions('0.5.0-beta.2', '0.5.0-beta.10')).toBe(-1)
    expect(compareVersions('0.5.0-rc.1', '0.5.0-rc.1')).toBe(0)
    expect(compareVersions('0.4.1', '0.5.0-beta.1')).toBe(-1)
  })

  it('explains invalid input', () => {
    expect(() => compareVersions('nope', '1.0.0')).toThrow(/not a valid version/)
  })
})

describe('bumpVersion: stable releases', () => {
  const cases: [string, BumpKind, string][] = [
    ['0.4.1', 'patch', '0.4.2'],
    ['0.4.1', 'minor', '0.5.0'], // 次版本：修订号归零
    ['0.4.9', 'minor', '0.5.0'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'major', '2.0.0'], // 主版本：后两位归零
    ['1.2.3', 'patch', '1.2.4'],
  ]
  it.each(cases)('%s + %s = %s', (from, kind, to) => {
    expect(bumpVersion(from, kind)).toBe(to)
  })

  it('refuses 0.x -> 1.0.0 unless confirmed, and says to use minor', () => {
    expect(() => bumpVersion('0.6.2', 'major')).toThrow(
      /Before 1\.0\.0.*0\.7\.0.*"minor".*--confirm-1\.0/s,
    )
    expect(bumpVersion('0.6.2', 'major', { confirmMajorOne: true })).toBe('1.0.0')
  })
})

describe('bumpVersion: prereleases', () => {
  it('starts a prerelease from a stable version (beta by default, rc on request)', () => {
    expect(bumpVersion('0.4.1', 'preminor')).toBe('0.5.0-beta.1')
    expect(bumpVersion('0.4.1', 'prepatch')).toBe('0.4.2-beta.1')
    expect(bumpVersion('0.4.1', 'preminor', { preid: 'rc' })).toBe('0.5.0-rc.1')
    expect(bumpVersion('1.2.3', 'premajor')).toBe('2.0.0-beta.1')
  })

  it('premajor from 0.x needs the same confirmation as major', () => {
    expect(() => bumpVersion('0.4.1', 'premajor')).toThrow(/--confirm-1\.0/)
    expect(bumpVersion('0.4.1', 'premajor', { confirmMajorOne: true })).toBe('1.0.0-beta.1')
  })

  it('advances the sequence number', () => {
    expect(bumpVersion('0.5.0-beta.1', 'prerelease')).toBe('0.5.0-beta.2')
    expect(bumpVersion('0.5.0-rc.3', 'prerelease')).toBe('0.5.0-rc.4')
    expect(bumpVersion('0.5.0-beta.2', 'prerelease', { preid: 'beta' })).toBe('0.5.0-beta.3')
  })

  it('moves beta -> rc with the counter reset, but never back', () => {
    expect(bumpVersion('0.5.0-beta.4', 'prerelease', { preid: 'rc' })).toBe('0.5.0-rc.1')
    expect(() => bumpVersion('0.5.0-rc.1', 'prerelease', { preid: 'beta' })).toThrow(
      /Cannot go back from rc to beta/,
    )
  })

  it('promotes a prerelease to the stable version', () => {
    expect(bumpVersion('0.5.0-rc.2', 'release')).toBe('0.5.0')
    expect(bumpVersion('0.5.0-beta.1', 'release')).toBe('0.5.0')
  })

  it('rejects kinds that do not fit the current version, with the reason', () => {
    expect(() => bumpVersion('0.5.0-beta.1', 'patch')).toThrow(
      /is a prerelease.*"release".*0\.5\.0.*"prerelease"/s,
    )
    expect(() => bumpVersion('0.5.0-beta.1', 'minor')).toThrow(/is a prerelease/)
    expect(() => bumpVersion('0.5.0-beta.1', 'preminor')).toThrow(/already a prerelease/)
    expect(() => bumpVersion('0.5.0', 'prerelease')).toThrow(/stable release.*"preminor"/s)
    expect(() => bumpVersion('0.5.0', 'release')).toThrow(/already a stable release/)
  })

  it('refuses an invalid current version', () => {
    expect(() => bumpVersion('0.5', 'patch')).toThrow(
      /Current version "0\.5" is not a valid version/,
    )
  })
})

describe('validateTransition', () => {
  it('accepts a higher, unused, well-formed version', () => {
    expect(validateTransition('0.4.1', '0.5.0', ['v0.4.1'])).toEqual([])
    expect(validateTransition('0.5.0-beta.1', '0.5.0-beta.2', [])).toEqual([])
    expect(validateTransition('0.5.0-rc.1', '0.5.0', ['v0.5.0-rc.1'])).toEqual([])
  })

  it('allows re-applying the current version (to realign drifted packages), even if it is tagged', () => {
    expect(validateTransition('0.4.1', '0.4.1', ['v0.4.1'])).toEqual([])
  })

  it('rejects a malformed version', () => {
    expect(validateTransition('0.4.1', '0.5', [])[0]).toMatch(/not a valid version/)
    expect(validateTransition('0.4.1', '0.5.0-alpha.1', [])[0]).toMatch(/not a valid version/)
  })

  it('rejects a lower version', () => {
    expect(validateTransition('0.5.0', '0.4.9', [])[0]).toMatch(
      /lower than the current version 0\.5\.0/,
    )
    expect(validateTransition('0.5.0', '0.5.0-rc.1', [])[0]).toMatch(/lower than/)
  })

  it('rejects a version whose tag already exists, explaining the rule', () => {
    const problems = validateTransition('0.4.1', '0.5.0', ['v0.5.0'])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/Tag v0\.5\.0 already exists.*never reused or changed/s)
  })

  it('reports both problems when both apply', () => {
    expect(validateTransition('0.6.0', '0.5.0', ['v0.5.0'])).toHaveLength(2)
  })
})
