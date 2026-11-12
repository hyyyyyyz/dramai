#!/usr/bin/env node
// pnpm desktop:build — compile the app for this machine without installing it.
// Output: apps/desktop/release/<mac-arm64|mac|win-unpacked|linux-unpacked>/  (CI runs this on all three systems)
import { buildApp, findUnpackedApp, parseArch } from './lib/app-build.mjs'

const argv = process.argv.slice(2)
const arch = parseArch(argv.includes('--arch') ? argv[argv.indexOf('--arch') + 1] : undefined)
await buildApp({
  distribution: 'local',
  arch,
  unpackedOnly: true,
  skipBuild: argv.includes('--skip-build'),
})
console.log(`\n[desktop] built: ${findUnpackedApp()}`)
