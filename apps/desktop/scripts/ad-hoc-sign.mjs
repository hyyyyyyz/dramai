// electron-builder afterSign hook: give the macOS app an ad-hoc signature.
// Apple silicon will not run an executable that has no signature at all, and flipping the Electron fuses
// invalidates the original one, so it is re-signed last. An ad-hoc signature needs no certificate and does not
// identify a developer. It is also what lets a locally built app run without any Gatekeeper prompt (a file
// that was never downloaded has no quarantine flag).
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export default async function adHocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • ad-hoc signing (no certificate)  file=${app}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
