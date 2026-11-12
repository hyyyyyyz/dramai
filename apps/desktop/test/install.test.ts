import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  desktopEntry,
  installPaths,
  linuxIconPath,
  shortcutScript,
  windowsRegistryValues,
  windowsUninstallScript,
} from '../scripts/lib/install-paths.mjs'
import { dataLocations, linuxSandboxWarning } from '../scripts/lib/install-os.mjs'
import { opaqueBounds, readPng, resizePng, MAC_ART, SQUARE_ART } from '../scripts/lib/icons.mjs'

const temp: string[] = []
afterEach(() => {
  for (const d of temp.splice(0)) rmSync(d, { recursive: true, force: true })
})
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'dramai-inst-'))
  temp.push(d)
  return d
}

describe('install locations', () => {
  it('macOS: /Applications when writable, otherwise ~/Applications', () => {
    const base = { platform: 'darwin' as const, home: '/Users/u', env: {} }
    expect(installPaths({ ...base, canWriteSystemApps: true }).appDest).toBe(
      '/Applications/Dramai.app',
    )
    const user = installPaths({ ...base, canWriteSystemApps: false })
    expect(user.appDest).toBe('/Users/u/Applications/Dramai.app')
    expect(user.executable).toBe('/Users/u/Applications/Dramai.app/Contents/MacOS/Dramai')
    expect(user.userData).toContain('/Users/u/Library/Application Support/Dramai')
  })

  it('Windows: per-user Programs folder, Start menu shortcut, uninstall entry (no admin)', () => {
    const p = installPaths({
      platform: 'win32',
      home: 'C:\\Users\\u',
      env: {
        LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
        APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
      },
    })
    expect(p.appDest).toBe('C:\\Users\\u\\AppData\\Local\\Programs\\Dramai')
    expect(p.executable).toBe('C:\\Users\\u\\AppData\\Local\\Programs\\Dramai\\Dramai.exe')
    expect(p.startMenuShortcut).toBe(
      'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Dramai.lnk',
    )
    expect(p.registryKey?.startsWith('HKCU\\')).toBe(true) // current user: no elevation
    expect(p.userData).toEqual(['C:\\Users\\u\\AppData\\Roaming\\Dramai'])
  })

  it('Linux: XDG user folders, honouring XDG_DATA_HOME', () => {
    const p = installPaths({ platform: 'linux', home: '/home/u', env: {} })
    expect(p.appDest).toBe('/home/u/.local/share/dramai')
    expect(p.binLink).toBe('/home/u/.local/bin/dramai')
    expect(p.desktopFile).toBe('/home/u/.local/share/applications/dramai.desktop')
    expect(linuxIconPath(p, 256)).toBe('/home/u/.local/share/icons/hicolor/256x256/apps/dramai.png')
    expect(
      installPaths({ platform: 'linux', home: '/home/u', env: { XDG_DATA_HOME: '/x/data' } })
        .appDest,
    ).toBe('/x/data/dramai')
  })

  it('a sandbox root keeps everything inside it', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const p = installPaths({ platform, home: '/h', env: {}, root: '/sandbox' })
      expect(p.sandboxed).toBe(true)
      expect(p.appDest.replaceAll('\\', '/').startsWith('/sandbox')).toBe(true)
    }
  })
})

describe('launcher and uninstaller text', () => {
  it('desktop entry points at the executable and the dramai icon', () => {
    const entry = desktopEntry('/home/u/.local/share/dramai/dramai')
    expect(entry).toContain('Exec="/home/u/.local/share/dramai/dramai"')
    expect(entry).toContain('Icon=dramai')
    expect(entry).toContain('Name=Dramai')
    expect(entry).toContain('StartupWMClass=dramai')
  })
  it('Windows shortcut script escapes quotes and takes the icon from the exe', () => {
    const s = shortcutScript("C:\\a'b\\Dramai.lnk", 'C:\\p\\Dramai.exe', 'C:\\p')
    expect(s).toContain("'C:\\a''b\\Dramai.lnk'")
    expect(s).toContain("IconLocation = 'C:\\p\\Dramai.exe,0'")
  })
  it('Windows uninstaller keeps user data and removes shortcut, registry key and folder', () => {
    const p = installPaths({
      platform: 'win32',
      home: 'C:\\Users\\u',
      env: { LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\R' },
    })
    const script = windowsUninstallScript(p)
    expect(script).toContain('Start Menu')
    expect(script).toContain('reg.exe')
    expect(script).toContain('rmdir')
    expect(script).not.toContain("C:\\R\\Dramai'") // never the data folder
    const reg = windowsRegistryValues(p, '0.4.1').map((a) => a[3])
    expect(reg).toEqual(
      expect.arrayContaining(['DisplayName', 'DisplayVersion', 'UninstallString', 'DisplayIcon']),
    )
  })
  it('warns about the Linux sandbox only where unprivileged user namespaces are restricted', () => {
    const p = installPaths({ platform: 'linux', home: '/h', env: {} })
    expect(linuxSandboxWarning(p, () => undefined)).toBeUndefined()
    expect(
      linuxSandboxWarning(p, (f: string) => (f.includes('apparmor') ? '1' : undefined)),
    ).toContain('chmod 4755')
    expect(
      linuxSandboxWarning(p, (f: string) =>
        f.includes('unprivileged_userns_clone') ? '0' : undefined,
      ),
    ).toContain('sudo')
  })
})

describe('data locations for --purge-data', () => {
  it('lists the default folders that exist, plus a custom data folder chosen in the app', () => {
    const root = tmp()
    const p = installPaths({ platform: process.platform, home: root, env: {}, root })
    const base = p.userData[0]!
    mkdirSync(base, { recursive: true })
    const custom = join(root, 'my-data')
    mkdirSync(custom)
    expect(dataLocations(p)).toEqual([base])
    writeFileSync(join(base, 'desktop.json'), JSON.stringify({ dataDir: custom }))
    expect(dataLocations(p)).toEqual([base, custom])
  })
})

describe('icons come from the brand artwork', () => {
  it('the macOS artwork keeps Apple-style transparent margins and the Windows/Linux one is full-bleed', () => {
    const mac = opaqueBounds(readPng(MAC_ART))!
    for (const side of [mac.left, mac.top, mac.right, mac.bottom])
      expect(side).toBeGreaterThan(0.08)
    const square = opaqueBounds(readPng(SQUARE_ART))!
    expect(square).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })
  it('downscaling keeps proportions and transparency', () => {
    const small = resizePng(readPng(MAC_ART), 32)
    expect(small.width).toBe(32)
    expect(small.data[3]).toBe(0) // the corner stays transparent
    const b = opaqueBounds(small)!
    expect(Math.abs(b.left - 0.09)).toBeLessThan(0.04)
  })
})

describe('failed-check diagnostics', () => {
  it('readAppLogs returns the tail of the app log so CI shows why a check failed', async () => {
    const { readAppLogs } = await import('../scripts/lib/cdp.mjs')
    const dir = tmp()
    mkdirSync(join(dir, 'logs'), { recursive: true })
    writeFileSync(join(dir, 'logs', 'main.log'), Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'))
    const text = await readAppLogs(dir, 5)
    expect(text).toContain('line 99')
    expect(text).not.toContain('line 10\n')
    expect(await readAppLogs(tmp(), 5)).toBeTypeOf('string')
  })
})
