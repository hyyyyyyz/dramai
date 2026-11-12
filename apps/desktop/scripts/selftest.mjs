#!/usr/bin/env node
// Unattended check of the local install, for CI and for you:
//   pnpm desktop:build && node apps/desktop/scripts/selftest.mjs [--arg=--no-sandbox]
// It installs the built app into a throw-away sandbox folder (nothing outside it is touched, no OS registration),
// checks the files, starts the installed app and runs the smoke check against it, uninstalls, and verifies that
// the app is gone while user data is kept (and only goes with --purge-data --yes).
// On a headless Linux runner wrap it in `xvfb-run -a`; add --arg=--no-sandbox if the runner blocks user namespaces.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installPaths } from './lib/install-paths.mjs'

const scripts = fileURLToPath(new URL('.', import.meta.url))
const passthrough = process.argv.slice(2).filter((a) => a.startsWith('--arg='))
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
