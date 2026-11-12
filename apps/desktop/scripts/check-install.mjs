#!/usr/bin/env node
// pnpm desktop:check-install — what CI runs on every system: build the app (always, so it can never test a stale
// build; --skip-build reuses the last `desktop:build`), then run the unattended install self-test
// (sandboxed install -> smoke check -> uninstall -> purge). Nothing outside a temporary folder is touched.
// Exit code 0 = everything passed.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildApp, findUnpackedApp, parseArch } from './lib/app-build.mjs'

const rest = process.argv.slice(2).filter((a) => a !== '--skip-build')
if (!process.argv.includes('--skip-build') || !findUnpackedApp()) {
  await buildApp({ distribution: 'local', arch: parseArch(), unpackedOnly: true })
}
const selftest = fileURLToPath(new URL('./selftest.mjs', import.meta.url))
const r = spawnSync(process.execPath, [selftest, ...rest], { stdio: 'inherit' })
process.exit(r.status ?? 1)
