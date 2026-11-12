import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectAssets, installerPattern } from '../src/assets.ts'

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

describe('installerPattern', () => {
  it('matches the naming convention for each platform family', () => {
    expect(installerPattern('0.5.0', 'mac', 'arm64').test('dramai-0.5.0-mac-arm64.dmg')).toBe(true)
    expect(installerPattern('0.5.0', 'mac', 'x64').test('dramai-0.5.0-mac-x64.zip')).toBe(true)
    expect(installerPattern('0.5.0', 'win', 'x64').test('dramai-0.5.0-win-x64.exe')).toBe(true)
    expect(installerPattern('0.5.0', 'linux', 'x64').test('dramai-0.5.0-linux-x64.AppImage')).toBe(
      true,
    )
    expect(
      installerPattern('0.5.0-beta.1', 'win', 'x64').test('dramai-0.5.0-beta.1-windows-x64.exe'),
    ).toBe(true)
  })

  it('does not accept the wrong version, arch, os or a look-alike dot', () => {
    expect(installerPattern('0.5.0', 'mac', 'arm64').test('dramai-0.5.1-mac-arm64.dmg')).toBe(false)
    expect(installerPattern('0.5.0', 'mac', 'arm64').test('dramai-0.5.0-mac-x64.dmg')).toBe(false)
    expect(installerPattern('0.5.0', 'mac', 'arm64').test('dramai-0.5.0-win-arm64.dmg')).toBe(false)
    expect(installerPattern('0.5.0', 'mac', 'arm64').test('dramai-0x5y0-mac-arm64.dmg')).toBe(false)
    expect(
      installerPattern('0.5.0', 'mac', 'arm64').test('dramai-0.5.0-beta.1-mac-arm64.dmg'),
    ).toBe(false)
    expect(
      installerPattern('0.5.0', 'mac', 'arm64').test('dramai-0.5.0-mac-arm64.dmg.blockmap'),
    ).toBe(false)
  })
})

describe('collectAssets', () => {
  it('copies conforming installers and reports the rest', () => {
    touch(
      'dramai-0.5.0-mac-arm64.dmg',
      'dramai-0.5.0-mac-arm64.zip',
      'dramai-0.5.0-mac-arm64.dmg.blockmap',
      'dramai-0.5.0-mac-x64.dmg', // 另一个架构的产物不属于这次
      'latest-mac.yml',
      'builder-debug.yml',
    )
    mkdirSync(join(dir, 'dramai-0.5.0-mac-arm64.dir')) // 目录忽略
    const r = collectAssets({ dir, out, version: '0.5.0', family: 'mac', arch: 'arm64' })
    expect(r.collected).toEqual(['dramai-0.5.0-mac-arm64.dmg', 'dramai-0.5.0-mac-arm64.zip'])
    expect(r.ignored).toEqual(['dramai-0.5.0-mac-arm64.dmg.blockmap', 'dramai-0.5.0-mac-x64.dmg'])
    expect(readdirSync(out).sort()).toEqual(r.collected)
  })

  it('fails when nothing matches and says what it saw', () => {
    touch('dramai-0.4.1-mac-arm64.dmg')
    expect(() =>
      collectAssets({ dir, out, version: '0.5.0', family: 'mac', arch: 'arm64' }),
    ).toThrow(
      /No installer named dramai-0\.5\.0-<mac\|macos\|darwin>-arm64.*saw: dramai-0\.4\.1-mac-arm64\.dmg/,
    )
  })

  it('fails on an empty or unrelated directory', () => {
    touch('latest.yml')
    expect(() => collectAssets({ dir, out, version: '0.5.0', family: 'win', arch: 'x64' })).toThrow(
      /no dramai-\* files/,
    )
  })
})
