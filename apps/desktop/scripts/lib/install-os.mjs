// Install / uninstall for macOS, Windows and Linux. Everything goes to the current user's own folders, so no
// administrator rights are needed (macOS uses /Applications only when the user can already write there).
import { execFileSync, spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  desktopEntry,
  installPaths,
  linuxIconPath,
  shortcutScript,
  windowsRegistryValues,
  windowsUninstallScript,
} from './install-paths.mjs'
import { linuxIcons } from './icons.mjs'

const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

export class InstallError extends Error {}

function canWrite(dir) {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function resolvePaths({ platform, home, env, root }) {
  return installPaths({
    platform,
    home,
    env,
    root,
    canWriteSystemApps: platform === 'darwin' && canWrite('/Applications'),
  })
}

function tryRun(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', ...options })
  return r.status === 0
}

/** Is the installed copy running right now (replacing or removing a running app would fail or corrupt it)? */
export function isRunning(paths) {
  if (paths.platform === 'win32') {
    const out =
      spawnSync('tasklist', ['/FI', 'IMAGENAME eq Dramai.exe', '/NH'], { encoding: 'utf8' })
        .stdout ?? ''
    return /Dramai\.exe/i.test(out)
  }
  return spawnSync('pgrep', ['-f', paths.executable]).status === 0
}

function swapIn(source, dest, copy) {
  const backup = `${dest}.old`
  rmSync(backup, { recursive: true, force: true })
  if (existsSync(dest)) renameSync(dest, backup)
  try {
    mkdirSync(dirname(dest), { recursive: true })
    copy()
  } catch (err) {
    rmSync(dest, { recursive: true, force: true })
    if (existsSync(backup)) renameSync(backup, dest) // keep the previous install working
    throw err
  }
  rmSync(backup, { recursive: true, force: true })
}

export function install({ paths, source, version, log = console.log }) {
  if (!existsSync(source)) throw new InstallError(`built app not found: ${source}`)
  if (isRunning(paths))
    throw new InstallError('Dramai is running. Quit it, then run the install again.')
  const sandboxed = paths.sandboxed

  if (paths.platform === 'darwin') {
    swapIn(source, paths.appDest, () => execFileSync('ditto', [source, paths.appDest]))
    // The app was built here, so it carries no quarantine flag; clear it anyway in case the folder was copied around.
    tryRun('xattr', ['-dr', 'com.apple.quarantine', paths.appDest])
    if (!tryRun('codesign', ['--verify', '--deep', '--strict', paths.appDest])) {
      throw new InstallError('the installed app failed its signature check (codesign --verify)')
    }
    if (!sandboxed) tryRun(LSREGISTER, ['-f', paths.appDest]) // make Launchpad / Spotlight pick it up now
    log(`Installed ${paths.appDest}`)
    log('Open it from Launchpad, Spotlight or the Applications folder.')
    return
  }

  if (paths.platform === 'win32') {
    swapIn(source, paths.appDest, () => cpSync(source, paths.appDest, { recursive: true }))
    mkdirSync(dirname(paths.startMenuShortcut), { recursive: true })
    writeFileSync(paths.uninstallScript, windowsUninstallScript(paths))
    const ps = (script) =>
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { stdio: 'inherit' },
      )
    ps(shortcutScript(paths.startMenuShortcut, paths.executable, paths.appDest))
    if (!sandboxed)
      for (const args of windowsRegistryValues(paths, version))
        execFileSync('reg.exe', args, { stdio: 'ignore' })
    log(`Installed ${paths.appDest}`)
    log(
      'Open it from the Start menu (search for "Dramai"); it is also listed under Settings > Apps.',
    )
    return
  }

  // Linux
  swapIn(source, paths.appDest, () =>
    cpSync(source, paths.appDest, { recursive: true, verbatimSymlinks: true }),
  )
  mkdirSync(dirname(paths.binLink), { recursive: true })
  rmSync(paths.binLink, { force: true })
  symlinkSync(paths.executable, paths.binLink)
  mkdirSync(dirname(paths.desktopFile), { recursive: true })
  writeFileSync(paths.desktopFile, desktopEntry(paths.executable))
  for (const icon of linuxIcons(paths.iconSizes)) {
    const file = linuxIconPath(paths, icon.size)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, icon.data)
  }
  if (!sandboxed) {
    tryRun('update-desktop-database', [dirname(paths.desktopFile)])
    tryRun('gtk-update-icon-cache', ['-f', '-t', paths.iconDir])
  }
  log(`Installed ${paths.appDest}`)
  log(
    'Open it from your application menu ("Dramai") or run `dramai` (make sure ~/.local/bin is on your PATH).',
  )
  const warn = linuxSandboxWarning(paths)
  if (warn) log(`\n${warn}`)
}

/** Ubuntu 24.04+ (AppArmor) and some hardened kernels block the unprivileged user namespaces Chromium's sandbox uses. */
export function linuxSandboxWarning(
  paths,
  read = (f) => {
    try {
      return readFileSync(f, 'utf8').trim()
    } catch {
      return undefined
    }
  },
) {
  const apparmor = read('/proc/sys/kernel/apparmor_restrict_unprivileged_userns')
  const clone = read('/proc/sys/kernel/unprivileged_userns_clone')
  if (apparmor !== '1' && clone !== '0') return undefined
  const sandbox = join(paths.appDest, 'chrome-sandbox')
  return [
    'Note: this system restricts unprivileged user namespaces, which the Chromium sandbox needs. If Dramai',
    'does not start, give the sandbox helper its setuid permission once (this is the only step that needs sudo):',
    `  sudo chown root:root "${sandbox}" && sudo chmod 4755 "${sandbox}"`,
  ].join('\n')
}

export function uninstall({ paths, log = console.log }) {
  if (isRunning(paths))
    throw new InstallError('Dramai is running. Quit it, then run the uninstall again.')
  const removed = []
  const rm = (target) => {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true })
      removed.push(target)
    }
  }
  if (paths.platform === 'darwin') {
    if (!paths.sandboxed && existsSync(paths.appDest)) tryRun(LSREGISTER, ['-u', paths.appDest])
    rm(paths.appDest)
  } else if (paths.platform === 'win32') {
    rm(paths.startMenuShortcut)
    if (!paths.sandboxed) tryRun('reg.exe', ['delete', paths.registryKey, '/f'])
    rm(paths.appDest)
  } else {
    rm(paths.binLink)
    rm(paths.desktopFile)
    for (const size of paths.iconSizes) rm(linuxIconPath(paths, size))
    rm(paths.appDest)
    if (!paths.sandboxed) {
      tryRun('update-desktop-database', [dirname(paths.desktopFile)])
      tryRun('gtk-update-icon-cache', ['-f', '-t', paths.iconDir])
    }
  }
  if (removed.length === 0) log('Dramai was not installed here; nothing to remove.')
  for (const r of removed) log(`Removed ${r}`)
  return removed
}

/** The data `--purge-data` would delete: the default user-data folders plus a custom data folder, if one was chosen. */
export function dataLocations(paths) {
  const list = [...paths.userData]
  for (const base of paths.userData.slice(0, 1)) {
    try {
      const custom = JSON.parse(readFileSync(join(base, 'desktop.json'), 'utf8')).dataDir
      if (typeof custom === 'string' && custom && !list.includes(custom)) list.push(custom)
    } catch {
      /* no desktop.json, or unreadable */
    }
  }
  return list.filter((p) => existsSync(p))
}

export function purgeData({ paths, locations, log = console.log }) {
  for (const target of locations) {
    rmSync(target, { recursive: true, force: true })
    log(`Deleted ${target}`)
  }
  if (paths.platform === 'darwin' && !paths.sandboxed) {
    if (tryRun('security', ['delete-generic-password', '-s', paths.keychainService]))
      log('Deleted the keychain entry that protected your API keys')
  }
}
