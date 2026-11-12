// electron-builder configuration shared by `pnpm desktop:build` (unpacked app for a local install)
// and `pnpm desktop:dist` (installers). One configuration, one app: the only difference between the two
// is the `dramai.distribution` field baked into package.json ("local" or "package"), which lets the app tell
// a local build from a downloaded installer (it changes what the update notice says).
//
// Nothing is signed. macOS gets an ad-hoc signature from scripts/ad-hoc-sign.mjs (Apple silicon refuses to run
// an executable without at least that); to add real signing later, set `mac.identity` / `win.signtoolOptions`
// here and drop that hook — nothing else needs to change.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
const brand = resolve(root, '../../packages/ui/src/brand')
// Icons generated from the brand artwork by scripts/build.mjs (per-platform artwork + the small-size variant).
// Fall back to the brand PNG when building without that step (electron-builder then scales it itself).
const generated = join(root, 'build', 'generated')
const icon = (file, fallback) =>
  existsSync(join(generated, file)) ? join(generated, file) : join(brand, fallback)
const distribution = process.env.DRAMAI_DISTRIBUTION === 'package' ? 'package' : 'local'

/** @type {import('electron-builder').Configuration} */
export default {
  appId: 'io.github.hyyyyyyz.dramai',
  productName: 'Dramai',
  copyright: 'Copyright © dramai contributors. Apache-2.0',
  directories: { output: 'release', buildResources: 'build' },
  // Main process, preload and server process are each bundled into one file: no node_modules in the app.
  files: ['dist/**/*', '!dist/**/*.map', '!dist/demo.mjs', 'package.json'],
  extraMetadata: { dramai: { distribution } },
  afterSign: join(root, 'scripts/ad-hoc-sign.mjs'),
  asar: true,
  npmRebuild: false,
  publish: null,
  compression: 'normal',
  artifactName: 'dramai-${version}-${os}-${arch}.${ext}',

  // Keep only the capabilities the app needs. With runAsNode off other programs cannot use the app as a Node
  // interpreter; the server runs in a utilityProcess, which does not need it.
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },

  mac: {
    category: 'public.app-category.video',
    icon: icon('icon.icns', 'app-icon-1024.png'),
    // Only the system languages the UI uses (Chromium ships 100+).
    electronLanguages: ['en', 'en_US', 'zh_CN', 'zh_TW'],
    target: [{ target: 'dmg' }, { target: 'zip' }],
    identity: null,
    hardenedRuntime: false,
    notarize: false,
  },

  win: {
    icon: icon('icon.ico', 'app-icon-windows-1024.png'),
    target: [{ target: 'nsis' }, { target: 'zip' }],
    signAndEditExecutable: true,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    // Uninstalling must not delete the user's projects and keys (they live under %APPDATA%\Dramai).
    deleteAppDataOnUninstall: false,
  },

  linux: {
    icon: icon('linux-icons', 'app-icon-linux-1024.png'),
    target: [{ target: 'AppImage' }, { target: 'tar.gz' }],
    executableName: 'dramai',
    category: 'AudioVideo',
    maintainer: 'dramai contributors',
    synopsis: 'AI short-drama studio',
  },
}
