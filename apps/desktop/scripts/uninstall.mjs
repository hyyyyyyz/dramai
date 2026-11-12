#!/usr/bin/env node
// pnpm desktop:uninstall — remove the locally installed app. Your projects, settings and API keys are kept.
//   --purge-data   ALSO delete all Dramai data (projects, settings, keys, logs). Lists what will go and asks you
//                  to type "delete"; non-interactive runs must add --yes.
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import {
  InstallError,
  dataLocations,
  purgeData,
  resolvePaths,
  uninstall,
} from './lib/install-os.mjs'

const argv = process.argv.slice(2)
const option = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
const paths = resolvePaths({
  platform: process.platform,
  home: homedir(),
  env: process.env,
  root: option('--root') ? resolve(option('--root')) : undefined,
})

try {
  uninstall({ paths })
  if (argv.includes('--purge-data')) {
    const locations = dataLocations(paths)
    if (locations.length === 0) {
      console.log('No Dramai data found.')
    } else {
      console.log('\n--purge-data will permanently delete:')
      for (const l of locations) console.log(`  ${l}`)
      let confirmed = argv.includes('--yes')
      if (!confirmed) {
        if (!process.stdin.isTTY)
          throw new InstallError('refusing to delete data without confirmation: add --yes')
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        confirmed = (await rl.question('Type "delete" to confirm: ')).trim() === 'delete'
        rl.close()
      }
      if (confirmed) purgeData({ paths, locations })
      else console.log('Data kept.')
    }
  } else {
    console.log('\nYour projects and settings were kept. Add --purge-data to delete them too.')
  }
} catch (err) {
  console.error(`\ndesktop:uninstall failed: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
