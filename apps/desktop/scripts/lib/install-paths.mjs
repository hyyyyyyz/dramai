// Where a local install goes on each system, and what `uninstall --purge-data` may remove.
// Pure functions of (platform, env, home): unit-tested on every system, no file system access.
import { posix, win32 } from 'node:path'

export const APP_NAME = 'Dramai'
export const APP_ID = 'io.github.hyyyyyyz.dramai'
const WIN_UNINSTALL_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Dramai`

/**
 * @param {{ platform: NodeJS.Platform, home: string, env: Record<string, string|undefined>,
 *           root?: string, canWriteSystemApps?: boolean }} input
 * `root` puts everything under one sandbox directory (self-test): no OS registration, nothing outside it.
 */
export function installPaths({ platform, home, env, root, canWriteSystemApps = false }) {
  if (platform === 'darwin') {
    // macOS paths are POSIX paths whatever system computes them (this is unit-tested on Windows too).
    const m = posix
    const apps = root
      ? m.join(root, 'Applications')
      : canWriteSystemApps
        ? '/Applications'
        : m.join(home, 'Applications')
    const appDest = m.join(apps, `${APP_NAME}.app`)
    return {
      platform,
      sandboxed: Boolean(root),
      appDest,
      executable: m.join(appDest, 'Contents', 'MacOS', APP_NAME),
      userData: [
        m.join(root ?? home, 'Library', 'Application Support', APP_NAME),
        m.join(root ?? home, 'Library', 'Logs', APP_NAME),
      ],
      keychainService: `${APP_NAME} Safe Storage`,
    }
  }
  if (platform === 'win32') {
    const w = win32
    const local = root
      ? w.join(root, 'Local')
      : (env.LOCALAPPDATA ?? w.join(home, 'AppData', 'Local'))
    const roaming = root
      ? w.join(root, 'Roaming')
      : (env.APPDATA ?? w.join(home, 'AppData', 'Roaming'))
    const appDest = w.join(local, 'Programs', APP_NAME)
    return {
      platform,
      sandboxed: Boolean(root),
      appDest,
      executable: w.join(appDest, `${APP_NAME}.exe`),
      startMenuShortcut: w.join(
        roaming,
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        `${APP_NAME}.lnk`,
      ),
      uninstallScript: w.join(appDest, 'uninstall.ps1'),
      registryKey: WIN_UNINSTALL_KEY,
      userData: [w.join(roaming, APP_NAME)],
    }
  }
  const h = root ?? home
  const dataHome = root
    ? posix.join(root, 'share')
    : (env.XDG_DATA_HOME ?? posix.join(home, '.local', 'share'))
  const configHome = root
    ? posix.join(root, 'config')
    : (env.XDG_CONFIG_HOME ?? posix.join(home, '.config'))
  const appDest = posix.join(dataHome, 'dramai')
  return {
    platform,
    sandboxed: Boolean(root),
    appDest,
    executable: posix.join(appDest, 'dramai'),
    binLink: posix.join(h, '.local', 'bin', 'dramai'),
    desktopFile: posix.join(dataHome, 'applications', 'dramai.desktop'),
    iconDir: posix.join(dataHome, 'icons', 'hicolor'),
    iconSizes: [16, 24, 32, 48, 64, 128, 256, 512],
    userData: [posix.join(configHome, APP_NAME)],
  }
}

export function linuxIconPath(paths, size) {
  return posix.join(paths.iconDir, `${size}x${size}`, 'apps', 'dramai.png')
}

/** Text of the freedesktop launcher entry. */
export function desktopEntry(executable) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${APP_NAME}`,
    'Comment=AI short-drama studio',
    `Exec="${executable}"`,
    'Icon=dramai',
    'Terminal=false',
    'Categories=AudioVideo;Video;',
    'StartupNotify=true',
    'StartupWMClass=dramai',
    '',
  ].join('\n')
}

/** PowerShell that creates the Start Menu shortcut (icon taken from the .exe). */
export function shortcutScript(shortcut, executable, workingDir) {
  const q = (s) => `'${s.replaceAll("'", "''")}'`
  return [
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(shortcut)})`,
    `$s.TargetPath = ${q(executable)}`,
    `$s.WorkingDirectory = ${q(workingDir)}`,
    `$s.IconLocation = ${q(executable + ',0')}`,
    `$s.Description = ${q(APP_NAME)}`,
    '$s.Save()',
  ].join('\n')
}

/** PowerShell uninstaller placed in the install folder and referenced by the Settings > Apps entry. */
export function windowsUninstallScript(paths) {
  const q = (s) => `'${s.replaceAll("'", "''")}'`
  return [
    '# Removes Dramai (the application only; projects and settings under %APPDATA%\\Dramai are kept).',
    `Remove-Item -LiteralPath ${q(paths.startMenuShortcut)} -Force -ErrorAction SilentlyContinue`,
    `& reg.exe delete ${q(paths.registryKey)} /f 2>$null | Out-Null`,
    `Start-Process cmd.exe -WindowStyle Hidden -ArgumentList '/c', ('ping -n 3 127.0.0.1 >nul & rmdir /s /q "' + ${q(paths.appDest)} + '"')`,
    '',
  ].join('\n')
}

/** `reg add` argument lists for the Settings > Apps entry. */
export function windowsRegistryValues(paths, version) {
  const uninstall = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${paths.uninstallScript}"`
  const values = [
    ['DisplayName', 'REG_SZ', APP_NAME],
    ['DisplayVersion', 'REG_SZ', version],
    ['Publisher', 'REG_SZ', 'dramai contributors'],
    ['InstallLocation', 'REG_SZ', paths.appDest],
    ['DisplayIcon', 'REG_SZ', paths.executable],
    ['UninstallString', 'REG_SZ', uninstall],
    ['NoModify', 'REG_DWORD', '1'],
    ['NoRepair', 'REG_DWORD', '1'],
  ]
  return values.map(([name, type, data]) => [
    'add',
    paths.registryKey,
    '/v',
    name,
    '/t',
    type,
    '/d',
    data,
    '/f',
  ])
}
