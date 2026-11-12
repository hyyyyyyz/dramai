#!/usr/bin/env node
// 打包当前平台：  pnpm desktop:dist [--arch arm64|x64] [--dir] [--skip-build]
//
//   1. 构建前端（packages/workspace）
//   2. 打包主进程 / 预加载 / 服务进程，并带上数据和前端（scripts/build.mjs）
//   3. electron-builder 生成安装包，输出到 apps/desktop/release/，文件名 dramai-<版本>-<系统>-<架构>.<扩展名>
//
//   --arch       目标架构（默认本机；macOS 上可以交叉打另一种架构）
//   --dir        只生成未打包的应用目录（release/<平台>/，用于冒烟检查），不生成安装包
//   --skip-build 前端和 dist/ 已经是最新的，跳过步骤 1、2
// 签名 / 公证 / 随包 ffmpeg 由环境变量决定，见 electron-builder.config.mjs。
import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { signingState } from './lib/signing.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const repo = join(root, '../..')
const argv = process.argv.slice(2)
const value = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
const arch = value('--arch') ?? process.arch
if (!['arm64', 'x64'].includes(arch)) {
  console.error(`--arch 只支持 arm64 / x64，收到 "${arch}"`)
  process.exit(1)
}
const platformFlag = { darwin: '--mac', win32: '--win', linux: '--linux' }[process.platform]
if (!platformFlag) {
  console.error(`不支持的系统：${process.platform}`)
  process.exit(1)
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} 退出码 ${code}`)),
    )
  })
}

const state = signingState()
const signing =
  process.platform === 'darwin'
    ? state.summary.mac
    : process.platform === 'win32'
      ? state.summary.win
      : 'unsigned'
console.log(`[desktop] platform ${process.platform}/${arch} · signing: ${signing}`)
// 没有配置证书时，不要让 electron-builder 去钥匙串里“自动发现”一个碰巧存在的证书来签名。
if (!state.macSigned) process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'

if (!argv.includes('--skip-build')) {
  await run('pnpm', ['--filter', '@dramai/workspace', 'build'], repo)
  await run('node', ['scripts/build.mjs'], root)
}

const builderArgs = [
  platformFlag,
  `--${arch}`,
  '--publish',
  'never',
  '--config',
  'electron-builder.config.mjs',
]
if (argv.includes('--dir')) builderArgs.push('--dir')
const rest = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : []
await run('pnpm', ['exec', 'electron-builder', ...builderArgs, ...rest], root)

const release = join(root, 'release')
console.log('\n[desktop] artifacts in apps/desktop/release/:')
for (const name of (await readdir(release)).sort()) {
  const s = await stat(join(release, name))
  if (
    s.isFile() &&
    /^dramai-.*\.(dmg|zip|exe|AppImage|blockmap)$/.test(name) &&
    !name.endsWith('.blockmap')
  ) {
    console.log(`  ${name}  ${(s.size / 1024 / 1024).toFixed(1)} MB`)
  }
}
