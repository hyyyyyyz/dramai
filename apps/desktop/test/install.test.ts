import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
import { PNG } from 'pngjs'
import {
  ART,
  brandDir as brand,
  icoBuffer,
  iconPng,
  opaqueBounds,
  readPng,
  resizePng,
} from '../scripts/lib/icons.mjs'

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
  /** Margin (as a fraction of the canvas) between the canvas edge and the plate, ignoring the soft shadow. */
  const plate = (file: string) => opaqueBounds(readPng(file), 128)!
  const near = (value: number, px: number, tol = 0.004) => Math.abs(value - px / 1024) < tol

  it('macOS: the plate sits on the 824 px grid (100 px margin); the shadow may extend into the margin but is not clipped', () => {
    const p = plate(ART.mac)
    for (const side of [p.left, p.top, p.right, p.bottom]) expect(near(side, 100)).toBe(true)
    const all = opaqueBounds(readPng(ART.mac), 0)!
    // the shadow (blur 28, offset 12) is drawn inside the canvas: nothing touches the edge pixels
    for (const side of [all.left, all.top, all.right, all.bottom])
      expect(side).toBeGreaterThan(1 / 1024)
    // and it is a shadow, not more plate: it stays within the 28 px blur + 12 px offset around the plate
    expect(all.bottom).toBeGreaterThan(100 / 1024 - (28 + 12 + 6) / 1024)
  })

  it('Windows, Linux and the small variant have their documented plate sizes and no shadow', () => {
    for (const [file, plateSize] of [
      [ART.windows, 976],
      [ART.linux, 928],
      [ART.small, 944],
    ] as const) {
      const margin = (1024 - plateSize) / 2
      const p = plate(file)
      for (const side of [p.left, p.top, p.right, p.bottom])
        expect(near(side, margin), file).toBe(true)
      const all = opaqueBounds(readPng(file), 0)!
      expect(all.left, file).toBeCloseTo(p.left, 2) // no shadow beyond the plate
    }
  })

  it('small sizes use the small variant, larger sizes the platform artwork', () => {
    const png = (b: Buffer) => PNG.sync.read(b)
    expect(png(iconPng('darwin', 32)).width).toBe(32)
    expect(png(iconPng('win32', 256)).width).toBe(256)
    // 48 px: the small variant's plate is 944/1024 of the canvas, the macOS plate only 824/1024
    const margin48 = (platform: NodeJS.Platform) =>
      opaqueBounds(png(iconPng(platform, 48)), 128)!.left * 48
    expect(margin48('darwin')).toBeLessThan(2.5)
    // 64 px: the platform artwork again (macOS plate has the 100/1024 margin => ~6 px)
    expect(opaqueBounds(png(iconPng('darwin', 64)), 128)!.left * 64).toBeGreaterThan(5)
  })

  it('the generated .ico is a valid multi-size icon file', () => {
    const ico = icoBuffer([16, 32, 256])
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(3)
    expect(ico.readUInt8(6)).toBe(16)
    expect(ico.readUInt8(6 + 2 * 16)).toBe(0) // 256 is stored as 0
    const offset = ico.readUInt32LE(6 + 12)
    expect(ico.subarray(offset, offset + 8).toString('hex')).toBe('89504e470d0a1a0a') // PNG-compressed entry
  })

  it('downscaling keeps proportions and transparency', () => {
    const small = resizePng(readPng(ART.mac), 64)
    expect(small.width).toBe(64)
    expect(small.data[3]).toBe(0) // the corner stays transparent
  })
})

describe('failed-check diagnostics', () => {
  it('readAppLogs returns the tail of the app log so CI shows why a check failed', async () => {
    const { readAppLogs } = await import('../scripts/lib/cdp.mjs')
    const dir = tmp()
    mkdirSync(join(dir, 'logs'), { recursive: true })
    writeFileSync(
      join(dir, 'logs', 'main.log'),
      Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'),
    )
    const text = await readAppLogs(dir, 5)
    expect(text).toContain('line 99')
    expect(text).not.toContain('line 10\n')
    expect(await readAppLogs(tmp(), 5)).toBeTypeOf('string')
  })
})

describe('start-up stage report', () => {
  it('shows which stage a stalled start never reached', async () => {
    const { stageReport } = await import('../scripts/lib/cdp.mjs')
    const log = [
      '2026-11-12T00:00:00Z INFO dramai desktop 0.5.0-beta.1 (darwin/arm64), data: /d (env)',
      '2026-11-12T00:00:01Z INFO server ready at http://127.0.0.1:1',
    ].join('\n')
    const report = stageReport(log)
    expect(report).toContain('✓ app started')
    expect(report).toContain('✓ server process ready')
    expect(report).toContain('✗ window created')
    expect(report).toContain('· page loaded') // later stages are shown as not reached, not as failures
    expect(stageReport(log + '\n2026 ERROR server failed to start: DATA_DIR_LOCKED')).toContain(
      'DATA_DIR_LOCKED',
    )
  })
})

describe('files for external processes in the packaged app', () => {
  it('starts the server from the unpacked copy when packaged, from dist/ otherwise', async () => {
    const { serverEntryPath } = await import('../src/main/entry-path.ts')
    expect(
      serverEntryPath({
        packaged: true,
        resourcesPath: '/r',
        distDir: '/r/app.asar/dist',
      }).replaceAll('\\', '/'),
    ).toBe('/r/app.asar.unpacked/dist/server/server.mjs')
    expect(
      serverEntryPath({ packaged: false, resourcesPath: '/r', distDir: '/repo/dist' }).replaceAll(
        '\\',
        '/',
      ),
    ).toBe('/repo/dist/server/server.mjs')
  })

  it('finds <resources> from the executable on each system', async () => {
    const { resourcesDirOf, unpackedPaths } = await import('../scripts/lib/external-files.mjs')
    expect(
      resourcesDirOf('/A/Dramai.app/Contents/MacOS/Dramai', 'darwin').replaceAll('\\', '/'),
    ).toBe('/A/Dramai.app/Contents/Resources')
    expect(resourcesDirOf('/opt/dramai/dramai', 'linux').replaceAll('\\', '/')).toBe(
      '/opt/dramai/resources',
    )
    expect(unpackedPaths('/res').font.replaceAll('\\', '/')).toBe(
      '/res/app.asar.unpacked/dist/data/fonts/NotoSansSC-Regular-Subset.otf',
    )
  })

  it('the font is part of what gets bundled into dist/data', () => {
    expect(
      existsSync(
        join(brand, '..', '..', '..', 'core', 'data', 'fonts', 'NotoSansSC-Regular-Subset.otf'),
      ),
    ).toBe(true)
  })

  it('the packaging config unpacks the server script and the data folder', async () => {
    const config = (await import('../electron-builder.config.mjs')).default as {
      asarUnpack?: string[]
    }
    expect(config.asarUnpack).toEqual(expect.arrayContaining(['dist/server/**', 'dist/data/**']))
  })
})

describe('check scripts import what they use', () => {
  it('smoke.mjs names every helper it imports from cdp.mjs and uses no undeclared one', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../scripts/smoke.mjs', import.meta.url), 'utf8')
    const exported = [
      ...readFileSync(new URL('../scripts/lib/cdp.mjs', import.meta.url), 'utf8').matchAll(
        /export (?:async )?function (\w+)|export const (\w+)/g,
      ),
    ].map((m) => m[1] ?? m[2]!)
    const imported = /import \{([^}]+)\} from '\.\/lib\/cdp\.mjs'/
      .exec(source)![1]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const name of exported) {
      if (
        new RegExp(`\\b${name}\\(`).test(
          source.replace(/import \{[^}]+\} from '\.\/lib\/cdp\.mjs'/, ''),
        )
      ) {
        expect(imported, `smoke.mjs calls ${name}() but does not import it`).toContain(name)
      }
    }
  })
})

describe('installer names', () => {
  it('every system and architecture produces dramai-<version>-<os>-<arch>.<ext>', async () => {
    const { expectedArtifacts } = await import('../scripts/lib/artifacts.mjs')
    const v = '0.5.0-beta.1'
    expect(expectedArtifacts({ version: v, platform: 'darwin', arch: 'arm64' })).toEqual([
      `dramai-${v}-mac-arm64.dmg`,
      `dramai-${v}-mac-arm64.zip`,
    ])
    expect(expectedArtifacts({ version: v, platform: 'darwin', arch: 'x64' })).toEqual([
      `dramai-${v}-mac-x64.dmg`,
      `dramai-${v}-mac-x64.zip`,
    ])
    expect(expectedArtifacts({ version: v, platform: 'win32', arch: 'x64' })).toEqual([
      `dramai-${v}-win-x64.exe`,
      `dramai-${v}-win-x64.zip`,
    ])
    expect(expectedArtifacts({ version: v, platform: 'linux', arch: 'x64' })).toEqual([
      `dramai-${v}-linux-x64.AppImage`,
      `dramai-${v}-linux-x64.tar.gz`,
    ])
    expect(expectedArtifacts({ version: v, platform: 'linux', arch: 'arm64' })).toEqual([
      `dramai-${v}-linux-arm64.AppImage`,
      `dramai-${v}-linux-arm64.tar.gz`,
    ])
  })

  it('the packaging config spells the architecture out for AppImage (electron-builder would say x86_64)', async () => {
    const { createConfig } = await import('../electron-builder.config.mjs')
    for (const arch of ['x64', 'arm64']) {
      const config = createConfig(arch) as {
        artifactName: string
        appImage: { artifactName: string }
      }
      expect(config.artifactName).toBe('dramai-${version}-${os}-${arch}.${ext}')
      expect(config.appImage.artifactName).toBe(`dramai-\${version}-linux-${arch}.\${ext}`)
    }
  })

  it('verifyArtifacts passes a complete set and names what is missing or misnamed', async () => {
    const { verifyArtifacts, expectedArtifacts } = await import('../scripts/lib/artifacts.mjs')
    const v = '0.5.0-beta.1'
    const linux = { version: v, platform: 'linux' as const, arch: 'x64' }
    expect(
      verifyArtifacts({ ...linux, files: [...expectedArtifacts(linux), 'builder-debug.yml'] }).ok,
    ).toBe(true)
    const bad = verifyArtifacts({
      ...linux,
      files: [`dramai-${v}-linux-x86_64.AppImage`, `dramai-${v}-linux-x64.tar.gz`],
    })
    expect(bad.ok).toBe(false)
    expect(bad.problems[0]).toContain(`dramai-${v}-linux-x64.AppImage is missing`)
    expect(bad.problems[0]).toContain('x86_64')
    const missing = verifyArtifacts({
      version: v,
      platform: 'win32',
      arch: 'x64',
      files: [`dramai-${v}-win-x64.zip`],
    })
    expect(missing.problems).toEqual([`dramai-${v}-win-x64.exe is missing`])
    expect(
      verifyArtifacts({ version: v, platform: 'darwin', arch: 'arm64', files: [] }).problems,
    ).toHaveLength(2)
  })
})

describe('debugging-protocol calls cannot hang a check', () => {
  it('a page call that never answers fails after its deadline with a hint about the Keychain prompt', async () => {
    class SilentSocket {
      onopen: (() => void) | undefined
      onerror: (() => void) | undefined
      onmessage: ((e: { data: string }) => void) | undefined
      constructor() {
        queueMicrotask(() => this.onopen?.())
      }
      send() {} // never answers, like a page whose call waits on the Keychain prompt
      close() {}
    }
    const original = globalThis.WebSocket
    ;(globalThis as { WebSocket: unknown }).WebSocket = SilentSocket
    process.env.DRAMAI_CALL_TIMEOUT_MS = '50'
    try {
      const { connect } = await import('../scripts/lib/cdp.mjs')
      const page = await connect({ webSocketDebuggerUrl: 'ws://x' })
      const started = Date.now()
      await expect(page.evaluate('window.dramaiDesktop.getInfo()')).rejects.toThrow(
        /Keychain.*Always Allow/s,
      )
      expect(Date.now() - started).toBeLessThan(2000)
    } finally {
      delete process.env.DRAMAI_CALL_TIMEOUT_MS
      globalThis.WebSocket = original
    }
  })

  it('the default deadline is generous but finite', async () => {
    const { CALL_TIMEOUT_MS } = await import('../scripts/lib/cdp.mjs')
    expect(CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
    expect(CALL_TIMEOUT_MS).toBeLessThanOrEqual(60_000)
  })
})

describe('stage report uses only the newest run', () => {
  it('ignores earlier runs that share the same log file', async () => {
    const { stageReport } = await import('../scripts/lib/cdp.mjs')
    const old = [
      'T INFO dramai desktop 1 (darwin/arm64), data: /a',
      'T INFO server ready at http://127.0.0.1:1',
      'T INFO page loaded: x',
      'T INFO secret storage ready: os',
    ].join('\n')
    const now = 'T INFO dramai desktop 1 (darwin/arm64), data: /b'
    const report = stageReport(old + '\n' + now)
    expect(report).toContain('✓ app started')
    expect(report).toContain('✗ server process ready')
    expect(report).not.toContain('✓ page loaded')
  })
})
