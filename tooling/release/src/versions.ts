// 全仓统一版本号：发现 workspace 里的所有 package.json，读取 / 校验 / 批量改写 version。
//
// 只依赖 Node 内置模块，CI 里在 `pnpm install` 之前就能运行。
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** 官方 semver 正则（https://semver.org），不带前导 v。 */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

export function isSemver(value: string): boolean {
  return SEMVER.test(value)
}

/** 带后缀（-beta.1、-rc.2 …）的版本视为预发布。 */
export function isPrerelease(version: string): boolean {
  const m = SEMVER.exec(version)
  return m !== null && m[4] !== undefined
}

/** 接受 `0.5.0` 或 `v0.5.0`，返回不带 v 的版本；不合法时抛错。 */
export function normalizeVersion(input: string): string {
  const v = input.startsWith('v') ? input.slice(1) : input
  if (!isSemver(v)) {
    throw new Error(
      `"${input}" is not a valid semantic version (expected e.g. 0.5.0 or 0.5.0-beta.1)`,
    )
  }
  return v
}

/** tag 必须形如 `v<semver>`；返回其中的版本。 */
export function versionFromTag(tag: string): string {
  const ref = tag.replace(/^refs\/tags\//, '')
  if (!ref.startsWith('v')) {
    throw new Error(`Tag "${ref}" must look like v<version>, e.g. v0.5.0 or v0.5.0-beta.1`)
  }
  return normalizeVersion(ref)
}

/** 解析 pnpm-workspace.yaml 的 `packages:` 列表（只支持 `dir/*` 和 `dir` 两种写法）。 */
export function workspaceGlobs(root: string): string[] {
  const text = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
  const globs: string[] = []
  let inPackages = false
  for (const line of text.split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages) continue
    const item = /^\s+-\s+['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/.exec(line)
    if (item?.[1]) {
      globs.push(item[1])
      continue
    }
    if (line.trim() === '' || /^\s*#/.test(line)) continue
    break // 下一个顶层键
  }
  if (globs.length === 0) throw new Error('No "packages:" entries found in pnpm-workspace.yaml')
  return globs
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** 根目录 + workspace 里每个含 package.json 的目录，返回 package.json 的相对路径（用 `/` 分隔，已排序）。 */
export function findPackageJsonFiles(root: string): string[] {
  const dirs = ['.']
  for (const glob of workspaceGlobs(root)) {
    if (glob.endsWith('/*')) {
      const base = glob.slice(0, -2)
      const baseDir = join(root, base)
      if (!isDir(baseDir)) continue
      for (const name of readdirSync(baseDir).sort()) {
        if (name === 'node_modules' || name.startsWith('.')) continue
        if (isDir(join(baseDir, name))) dirs.push(`${base}/${name}`)
      }
    } else if (!glob.includes('*')) {
      dirs.push(glob)
    } else {
      throw new Error(
        `Unsupported workspace pattern "${glob}" (only "dir/*" and plain directories are supported)`,
      )
    }
  }
  const files: string[] = []
  for (const dir of dirs) {
    const file = dir === '.' ? 'package.json' : `${dir}/package.json`
    try {
      statSync(join(root, file))
      files.push(file)
    } catch {
      // 目录里没有 package.json（例如只放了占位文件），忽略
    }
  }
  return files
}

export interface PackageVersion {
  /** package.json 相对仓库根的路径 */
  file: string
  name: string
  version: string
}

export function readVersions(root: string): PackageVersion[] {
  return findPackageJsonFiles(root).map((file) => {
    const pkg = JSON.parse(readFileSync(join(root, file), 'utf8')) as {
      name?: string
      version?: string
    }
    return { file, name: pkg.name ?? file, version: pkg.version ?? '' }
  })
}

export interface VersionCheck {
  ok: boolean
  /** 根 package.json 的版本，即“仓库版本” */
  version: string
  problems: string[]
  packages: PackageVersion[]
}

/** 检查所有包版本一致且合法；可选地再核对 tag。 */
export function checkVersions(root: string, options: { tag?: string } = {}): VersionCheck {
  const packages = readVersions(root)
  const rootPkg = packages.find((p) => p.file === 'package.json')
  const version = rootPkg?.version ?? ''
  const problems: string[] = []

  if (!isSemver(version)) {
    problems.push(`Root package.json has no valid semantic version (found "${version}")`)
  }
  for (const p of packages) {
    if (p.version !== version) {
      problems.push(`${p.file} (${p.name}) is at "${p.version}", expected "${version}"`)
    }
  }
  if (options.tag !== undefined) {
    try {
      const fromTag = versionFromTag(options.tag)
      if (fromTag !== version) {
        problems.push(
          `Tag "${options.tag}" is version ${fromTag}, but the repository is at ${version}. ` +
            `Run "pnpm version:set ${fromTag}", commit, and re-tag; or delete the tag and use v${version}.`,
        )
      }
    } catch (error) {
      problems.push((error as Error).message)
    }
  }
  return { ok: problems.length === 0, version, problems, packages }
}

const VERSION_LINE = /^(\s{2}"version":\s*")([^"]*)(")/m

/** 把所有 package.json 的 version 改成 `version`；只改这一行，保持其余格式不变。 */
export function setVersion(
  root: string,
  input: string,
  options: { dryRun?: boolean } = {},
): { version: string; changed: PackageVersion[] } {
  const version = normalizeVersion(input)
  const changed: PackageVersion[] = []
  for (const file of findPackageJsonFiles(root)) {
    const path = join(root, file)
    const text = readFileSync(path, 'utf8')
    const match = VERSION_LINE.exec(text)
    if (!match) {
      throw new Error(`${relative(root, path)} has no top-level "version" field to update`)
    }
    const name = (JSON.parse(text) as { name?: string }).name ?? file
    if (match[2] === version) continue
    const next = text.replace(VERSION_LINE, `$1${version}$3`)
    // 防御：改完必须仍是合法 JSON，且 version 已是目标值
    if ((JSON.parse(next) as { version?: string }).version !== version) {
      throw new Error(`Failed to update the version in ${file}`)
    }
    changed.push({ file, name, version: match[2] ?? '' })
    if (!options.dryRun) writeFileSync(path, next)
  }
  return { version, changed }
}
