import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'

/**
 * Fail once, with one clear sentence, when the browser is missing — instead of every spec
 * reporting "Executable doesn't exist". Typical after a first checkout or a Playwright upgrade.
 */
export default function globalSetup() {
  if (process.env.PW_CHANNEL) return
  if (!existsSync(chromium.executablePath())) {
    throw new Error(
      "Playwright's chromium is not installed for this Playwright version. Run `pnpm exec playwright install chromium` " +
        '(add `--with-deps` on Linux), or set PW_CHANNEL=chrome to use an installed Chrome.',
    )
  }
}
