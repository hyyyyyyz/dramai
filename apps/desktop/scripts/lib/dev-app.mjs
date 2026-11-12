// Source-run on macOS: the Dock icon, the Cmd-Tab entry and the menu-bar name come from the app *bundle*
// (Info.plist + icns), and a bare `electron .` uses Electron's own bundle ("Electron", atom icon).
// So the dev launcher runs a patched copy of Electron.app — named "Dramai Dev", with the dramai icon — kept in
// apps/desktop/.dev/ (git-ignored) and rebuilt only when Electron or the artwork changes.
// On Windows and Linux the window / taskbar icon is set from the app itself (see src/main/index.ts).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ART, makeIcns } from './icons.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const require = createRequire(import.meta.url)

const DEV_APP_NAME = 'Dramai Dev'

/** Path of the executable to launch for source-run (patched copy on macOS, plain Electron elsewhere). */
export function ensureDevApp() {
  if (process.platform !== 'darwin') return require('electron')
  const electron = require('electron')
  const source = join(dirname(electron), '..', '..')
  const target = join(root, '.dev', `${DEV_APP_NAME}.app`)
  const electronVersion = JSON.parse(
    readFileSync(join(dirname(require.resolve('electron/package.json')), 'package.json'), 'utf8'),
  ).version
  const stamp = createHash('sha256')
    .update(electronVersion)
    .update(readFileSync(ART.mac))
    .update(readFileSync(ART.small))
    .update('v2')
    .digest('hex')
  const stampFile = join(root, '.dev', 'stamp')
  const executable = join(target, 'Contents', 'MacOS', 'Electron')
  if (existsSync(executable) && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp)
    return executable

  console.log('[desktop] preparing the dev app (Dramai Dev.app: dramai icon and name)…')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(join(root, '.dev'), { recursive: true })
  try {
    execFileSync('cp', ['-cR', source, target]) // APFS clone: instant and no extra disk
  } catch {
    execFileSync('cp', ['-R', source, target])
  }
  const plist = join(target, 'Contents', 'Info.plist')
  const set = (key, value) => execFileSync('plutil', ['-replace', key, '-string', value, plist])
  set('CFBundleName', DEV_APP_NAME)
  set('CFBundleDisplayName', DEV_APP_NAME)
  set('CFBundleIdentifier', 'io.github.hyyyyyyz.dramai.dev')
  set('CFBundleIconFile', 'dramai.icns')
  makeIcns(join(target, 'Contents', 'Resources', 'dramai.icns'))
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', target], { stdio: 'ignore' })
  writeFileSync(stampFile, stamp)
  return executable
}
