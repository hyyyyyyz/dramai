// 打包配置（electron-builder）。签名和公证完全由环境变量驱动：没有就干净地跳过，有了就生效，不需要改这个文件。
//
//   macOS 签名     CSC_LINK（.p12 证书，base64 或路径）+ CSC_KEY_PASSWORD
//   macOS 公证     APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER   （推荐）
//                  或 APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
//   Windows 签名   WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD   （证书）
//                  或 Azure Trusted Signing：AZURE_TRUSTED_SIGNING_ENDPOINT / _ACCOUNT / _PROFILE / _PUBLISHER
//                  （认证用 AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET）
//   随包 ffmpeg    DRAMAI_FFMPEG_DIR=<放着 ffmpeg(.exe)、ffprobe(.exe) 和许可证文件的目录>
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signingState } from './scripts/lib/signing.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const brand = resolve(root, '../../packages/ui/src/brand')
const env = process.env

const signing = signingState(env)
const { macSigned, macNotarize, winAzure } = signing
export const signingSummary = signing.summary

const ffmpegDir = env.DRAMAI_FFMPEG_DIR?.trim()
const extraResources = []
if (ffmpegDir && existsSync(ffmpegDir)) {
  extraResources.push({ from: ffmpegDir, to: 'ffmpeg', filter: ['**/*'] })
}

/** @type {import('electron-builder').Configuration} */
export default {
  appId: 'io.github.hyyyyyyz.dramai',
  productName: 'Dramai',
  copyright: 'Copyright © dramai contributors. Apache-2.0',
  directories: { output: 'release', buildResources: 'build' },
  // 主进程 / 预加载 / 服务进程已经各自打成单个文件，应用包里不需要 node_modules。
  files: ['dist/**/*', '!dist/**/*.map', '!dist/demo.mjs', 'package.json'],
  extraResources,
  afterSign: join(root, 'scripts/after-sign.mjs'),
  asar: true,
  npmRebuild: false,
  publish: null,
  compression: 'normal',
  artifactName: 'dramai-${version}-${os}-${arch}.${ext}',

  // 只留应用确实需要的能力。runAsNode 关掉后别的程序不能把应用当 Node 解释器用；
  // 服务进程用的是 utilityProcess，不依赖它。
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
    icon: join(brand, 'app-icon-1024.png'),
    // 只保留界面用到的系统语言包（Chromium 自带 100 多种）。
    electronLanguages: ['en', 'en_US', 'zh_CN', 'zh_TW'],
    target: [{ target: 'dmg' }, { target: 'zip' }],
    // 没有证书：electron-builder 不签名（identity: null，也不会去用钥匙串里碰巧存在的别的证书），
    // 由 afterSign 钩子做 ad-hoc 签名；用户第一次打开仍会被 Gatekeeper 拦一下（见 apps/desktop/README.md）。
    ...(macSigned
      ? {
          hardenedRuntime: true,
          gatekeeperAssess: false,
          entitlements: join(root, 'build/entitlements.mac.plist'),
          entitlementsInherit: join(root, 'build/entitlements.mac.plist'),
          notarize: macNotarize,
        }
      : { identity: null, hardenedRuntime: false, notarize: false }),
  },

  win: {
    icon: join(brand, 'app-icon-square-1024.png'),
    target: [{ target: 'nsis' }, { target: 'zip' }],
    ...(winAzure
      ? {
          azureSignOptions: {
            endpoint: env.AZURE_TRUSTED_SIGNING_ENDPOINT,
            codeSigningAccountName: env.AZURE_TRUSTED_SIGNING_ACCOUNT,
            certificateProfileName: env.AZURE_TRUSTED_SIGNING_PROFILE,
            publisherName: env.AZURE_TRUSTED_SIGNING_PUBLISHER,
          },
        }
      : {}),
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    // 卸载时不删用户的数据（项目、密钥都在 %APPDATA%\Dramai\data）。
    deleteAppDataOnUninstall: false,
  },

  linux: {
    icon: join(brand, 'app-icon-square-1024.png'),
    target: [{ target: 'AppImage' }],
    category: 'AudioVideo',
    maintainer: 'dramai contributors',
  },
}
