// The one "generate the app" step shared by `desktop:build`, `desktop:install` and `desktop:dist`:
//   1. build the frontend (packages/workspace)
//   2. bundle main / preload / server and bring in the data and the frontend (scripts/build.mjs)
//   3. electron-builder: an unpacked app (--dir) or installers
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../..', import.meta.url))
export const repo = join(root, '../..')
export const releaseDir = join(root, 'release')

export function run(command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)),
    )
  })
}

export const platformFlag = { darwin: '--mac', win32: '--win', linux: '--linux' }[process.platform]

export function parseArch(value) {
  const arch = value ?? process.arch
  if (!['arm64', 'x64'].includes(arch))
    throw new Error(`--arch must be arm64 or x64, got "${arch}"`)
  return arch
}

/**
 * @param {{ distribution: 'local' | 'package', arch: string, unpackedOnly: boolean, skipBuild?: boolean }} options
 */
export async function buildApp({ distribution, arch, unpackedOnly, skipBuild }) {
  if (!platformFlag) throw new Error(`unsupported platform: ${process.platform}`)
  if (!skipBuild) {
    await run('pnpm', ['--filter', '@dramai/workspace', 'build'], repo)
    await run('node', ['scripts/build.mjs'], root)
  }
  const args = [
    platformFlag,
    `--${arch}`,
    '--publish',
    'never',
    '--config',
    'electron-builder.config.mjs',
  ]
  if (unpackedOnly) args.push('--dir')
  await run('pnpm', ['exec', 'electron-builder', ...args], root, {
    DRAMAI_DISTRIBUTION: distribution,
  })
}

/** Where `electron-builder --dir` put the app: Dramai.app / win-unpacked / linux-unpacked. */
export function findUnpackedApp() {
  if (!existsSync(releaseDir)) return undefined
  const entries = readdirSync(releaseDir)
  if (process.platform === 'darwin') {
    const dir = entries.find(
      (e) => e === `mac-${process.arch}` || (e === 'mac' && process.arch === 'x64'),
    )
    return dir ? join(releaseDir, dir, 'Dramai.app') : undefined
  }
  const suffix = process.platform === 'win32' ? 'win' : 'linux'
  const dir =
    entries.find((e) => e === `${suffix}-unpacked`) ??
    entries.find((e) => e === `${suffix}-${process.arch}-unpacked`)
  return dir ? join(releaseDir, dir) : undefined
}
