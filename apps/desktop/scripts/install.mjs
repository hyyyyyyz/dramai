#!/usr/bin/env node
// pnpm desktop:install — build the app on this machine and install it for the current user.
//   macOS    /Applications (or ~/Applications when /Applications is not writable)  -> Launchpad, Spotlight
//   Windows  %LOCALAPPDATA%\Programs\Dramai + Start menu shortcut + Settings > Apps entry
//   Linux    ~/.local/share/dramai + ~/.local/bin/dramai + application menu entry + icons
// Run it again after pulling new code to upgrade: the old copy is replaced, your data is not touched.
// Options: --skip-build (reuse the last `desktop:build`), --arch, --root <dir> (sandbox for self-tests).
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { buildApp, findUnpackedApp, parseArch, root as desktopRoot } from './lib/app-build.mjs'
import { InstallError, install, resolvePaths } from './lib/install-os.mjs'

const argv = process.argv.slice(2)
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
const sandbox = option('--root') ? resolve(option('--root')) : undefined
const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version

try {
  const paths = resolvePaths({
    platform: process.platform,
    home: homedir(),
    env: process.env,
    root: sandbox,
  })
  if (!argv.includes('--skip-build')) {
    await buildApp({ distribution: 'local', arch: parseArch(option('--arch')), unpackedOnly: true })
  }
  const source = findUnpackedApp()
  if (!source)
    throw new InstallError(`no built app under ${desktopRoot}/release — run without --skip-build`)
  install({ paths, source, version })
} catch (err) {
  console.error(`\ndesktop:install failed: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
