#!/usr/bin/env node
// Unattended check of the local install, for CI and for you:
//   pnpm desktop:check-install   (builds first if needed)   or   node scripts/selftest.mjs after `pnpm desktop:build`
// It installs the built app into a throw-away sandbox folder (nothing outside it is touched, no OS registration),
// checks the files, starts the installed app and runs the smoke check against it, uninstalls, and verifies that
// the app is gone while user data is kept (and only goes with --purge-data --yes).
// On Linux it handles headless runners (re-runs itself under xvfb-run) and runners that block user namespaces
// (adds --no-sandbox for this check) by itself.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installPaths } from './lib/install-paths.mjs'

const scripts = fileURLToPath(new URL('.', import.meta.url))
const passthrough = process.argv.slice(2).filter((a) => a.startsWith('--arg='))

// Linux CI runners: no display -> run under xvfb; restricted user namespaces (Ubuntu 24.04+) -> no Chromium sandbox
// for this check only (the app itself keeps the sandbox on; see README).
if (process.platform === 'linux') {
  const read = (f) => {
    try {
      return readFileSync(f, 'utf8').trim()
    } catch {
      return undefined
    }
  }
  const restricted =
    read('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') === '1' ||
    read('/proc/sys/kernel/unprivileged_userns_clone') === '0'
  if (restricted && !passthrough.includes('--arg=--no-sandbox')) {
    console.log(
      'note: user namespaces are restricted here; running the app with --no-sandbox for this check',
    )
    passthrough.push('--arg=--no-sandbox')
  }
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.DRAMAI_UNDER_XVFB) {
    const r = spawnSync(
      'xvfb-run',
      [
        '-a',
        process.execPath,
        ...process.argv.slice(1),
        ...passthrough.filter((a) => !process.argv.includes(a)),
      ],
      {
        stdio: 'inherit',
        env: { ...process.env, DRAMAI_UNDER_XVFB: '1' },
      },
    )
    if (r.error) {
      console.error('no display and xvfb-run is not installed (apt install xvfb)')
      process.exit(1)
    }
    process.exit(r.status ?? 1)
  }
}
const root = mkdtempSync(join(tmpdir(), 'dramai-selftest-'))
let failed = false
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) failed = true
}
const node = (script, args) =>
  spawnSync(process.execPath, [join(scripts, script), ...args], { stdio: 'inherit' })

const paths = installPaths({ platform: process.platform, home: root, env: {}, root })
try {
  check('install', node('install.mjs', ['--skip-build', '--root', root]).status === 0)
  check('app installed', existsSync(paths.executable))
  if (process.platform === 'win32')
    check(
      'Start menu shortcut + uninstall script',
      existsSync(paths.startMenuShortcut) && existsSync(paths.uninstallScript),
    )
  if (process.platform === 'linux')
    check(
      'launcher entry, symlink and icons',
      existsSync(paths.desktopFile) &&
        existsSync(paths.binLink) &&
        existsSync(join(paths.iconDir, '256x256', 'apps', 'dramai.png')),
    )
  check(
    'installed app passes the smoke check',
    node('smoke.mjs', ['--app', paths.executable, ...passthrough]).status === 0,
  )

  mkdirSync(paths.userData[0], { recursive: true })
  writeFileSync(join(paths.userData[0], 'marker'), 'keep me')
  check('uninstall', node('uninstall.mjs', ['--root', root]).status === 0)
  check('app removed', !existsSync(paths.appDest))
  if (process.platform === 'win32')
    check('Start menu shortcut removed', !existsSync(paths.startMenuShortcut))
  if (process.platform === 'linux')
    check('launcher entry removed', !existsSync(paths.desktopFile) && !existsSync(paths.binLink))
  check('user data kept by default', existsSync(join(paths.userData[0], 'marker')))
  check(
    '--purge-data without --yes refuses when not interactive',
    node('uninstall.mjs', ['--root', root, '--purge-data']).status !== 0 &&
      existsSync(join(paths.userData[0], 'marker')),
  )
  check(
    '--purge-data --yes deletes the data',
    node('uninstall.mjs', ['--root', root, '--purge-data', '--yes']).status === 0 &&
      !existsSync(join(paths.userData[0], 'marker')),
  )
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log(failed ? '\nSELFTEST FAILED' : '\nSELFTEST OK')
process.exit(failed ? 1 : 0)
