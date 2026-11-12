// electron-builder 的 afterSign 钩子：没有 Apple 证书时给 macOS 应用做 ad-hoc 签名。
// Apple 芯片要求可执行文件至少有一个签名才能运行；翻转 Electron fuses 会让原来的签名失效，所以要在最后重新签一遍。
// ad-hoc 签名不代表开发者身份，Gatekeeper 仍会拦截首次打开（见 apps/desktop/README.md）。
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { signingState } from './lib/signing.mjs'

export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (signingState().macSigned) return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • ad-hoc signing (no Apple certificate configured)  file=${app}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
