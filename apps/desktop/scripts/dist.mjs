#!/usr/bin/env node
// pnpm desktop:dist — installers for this system, in apps/desktop/release/, named
// dramai-<version>-<os>-<arch>.<ext>:
//   macOS   .dmg and .zip      Windows  .exe (NSIS) and .zip      Linux  .AppImage and .tar.gz
// Same app as `desktop:build`; the installers are the only extra. Options: --arch arm64|x64, --skip-build.
import { readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { buildApp, parseArch, releaseDir } from './lib/app-build.mjs'
import { expectedArtifacts, verifyArtifacts } from './lib/artifacts.mjs'

const argv = process.argv.slice(2)
const arch = parseArch(argv.includes('--arch') ? argv[argv.indexOf('--arch') + 1] : undefined)
await buildApp({
  distribution: 'package',
  arch,
  unpackedOnly: false,
  skipBuild: argv.includes('--skip-build'),
})

const version = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version
const files = (await readdir(releaseDir)).sort()
console.log('\n[desktop] artifacts in apps/desktop/release/:')
for (const name of files) {
  const s = await stat(join(releaseDir, name))
  if (s.isFile() && /^dramai-.*\.(dmg|zip|exe|AppImage|tar\.gz)$/.test(name)) {
    console.log(`  ${name}  ${(s.size / 1024 / 1024).toFixed(1)} MB`)
  }
}

// Every installer this system should produce must exist and be named dramai-<version>-<os>-<arch>.<ext>:
// the release workflow only picks up files with exactly these names, so catch a wrong or missing one here.
const check = verifyArtifacts({ version, platform: process.platform, arch, files })
if (!check.ok) {
  console.error('\n[desktop] the installer set is not what the release expects:')
  for (const p of check.problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(
  `[desktop] all expected installers are present: ${expectedArtifacts({ version, platform: process.platform, arch }).join(', ')}`,
)
