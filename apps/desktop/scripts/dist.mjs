#!/usr/bin/env node
// pnpm desktop:dist — installers for this system, in apps/desktop/release/, named
// dramai-<version>-<os>-<arch>.<ext>:
//   macOS   .dmg and .zip      Windows  .exe (NSIS) and .zip      Linux  .AppImage and .tar.gz
// Same app as `desktop:build`; the installers are the only extra. Options: --arch arm64|x64, --skip-build.
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { buildApp, parseArch, releaseDir } from './lib/app-build.mjs'

const argv = process.argv.slice(2)
const arch = parseArch(argv.includes('--arch') ? argv[argv.indexOf('--arch') + 1] : undefined)
await buildApp({
  distribution: 'package',
  arch,
  unpackedOnly: false,
  skipBuild: argv.includes('--skip-build'),
})

console.log('\n[desktop] artifacts in apps/desktop/release/:')
for (const name of (await readdir(releaseDir)).sort()) {
  const s = await stat(join(releaseDir, name))
  if (s.isFile() && /^dramai-.*\.(dmg|zip|exe|AppImage|tar\.gz)$/.test(name)) {
    console.log(`  ${name}  ${(s.size / 1024 / 1024).toFixed(1)} MB`)
  }
}
