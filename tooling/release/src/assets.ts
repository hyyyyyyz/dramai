// Naming convention of the desktop installers: dramai-<version>-<os>-<arch>.<extension>
//   dramai-0.5.0-mac-arm64.dmg, dramai-0.5.0-beta.1-win-x64.exe, dramai-0.5.0-linux-x64.AppImage
// `<os>` is mac | win | linux and `<arch>` is arm64 | x64, exactly as electron-builder's
// `dramai-${version}-${os}-${arch}.${ext}` produces them.
//
// This file is the single place that says which installers every system must produce; docs/RELEASING.md
// has the same table. A release is only as good as this check: a missing or misnamed installer fails the
// build instead of silently producing a Release without it.
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type PlatformFamily = 'mac' | 'win' | 'linux'
export type Arch = 'arm64' | 'x64'

/** The installer kinds (file extensions) each system must produce, in the order they are reported. */
export const REQUIRED_KINDS: Record<PlatformFamily, readonly string[]> = {
  mac: ['dmg', 'zip'],
  win: ['exe', 'zip'],
  linux: ['AppImage', 'tar.gz'],
}

/** Extensions that mark a file as an installer. A file with one of these that is not expected is an error. */
const INSTALLER_EXTENSIONS = [
  ...new Set([...Object.values(REQUIRED_KINDS).flat(), 'msi', 'deb', 'rpm', 'pkg']),
]

/** The exact file names a system's build must produce. */
export function expectedInstallers(version: string, family: PlatformFamily, arch: Arch): string[] {
  return REQUIRED_KINDS[family].map((ext) => `dramai-${version}-${family}-${arch}.${ext}`)
}

/** A problem that makes the build unusable for a release. `problems` has one line per issue. */
export class CollectError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(problems.join('\n'))
    this.name = 'CollectError'
    this.problems = problems
  }
}

export interface CollectResult {
  /** Installers that match the convention and were copied to `out`. */
  collected: string[]
  /** Other `dramai-*` files that are not installers and not known side files (not uploaded; worth a warning). */
  ignored: string[]
}

function extensionOf(name: string): string | undefined {
  return INSTALLER_EXTENSIONS.find((ext) => name.endsWith(`.${ext}`))
}

/**
 * Check that `dir` holds exactly the installers this system must produce and copy them to `out`.
 * Throws CollectError when an expected installer is missing, or when a file looks like an installer
 * but is not named as expected (for example `…-linux-x86_64.AppImage`).
 * `.blockmap` files, `latest*.yml`, `builder-debug.yml` and folders are never uploaded and never an error.
 */
export function collectAssets(options: {
  dir: string
  out: string
  version: string
  family: PlatformFamily
  arch: Arch
}): CollectResult {
  const { dir, out, version, family, arch } = options
  const expected = expectedInstallers(version, family, arch)
  const present = new Set<string>()
  const problems: string[] = []
  const ignored: string[] = []

  for (const name of readdirSync(dir).sort()) {
    if (!name.startsWith('dramai-') || !statSync(join(dir, name)).isFile()) continue
    if (name.endsWith('.blockmap')) continue
    if (expected.includes(name)) {
      present.add(name)
      continue
    }
    const ext = extensionOf(name)
    if (ext === undefined) {
      ignored.push(name)
      continue
    }
    const wanted = expected.find((e) => e.endsWith(`.${ext}`))
    problems.push(
      wanted
        ? `Found ${name}, which looks like an installer but is not named as expected; expected ${wanted}`
        : `Found ${name}, which is not an installer this system should produce (expected only ${expected.join(', ')})`,
    )
  }
  for (const name of expected) {
    if (!present.has(name)) {
      problems.push(`Missing ${name} in ${dir}`)
    }
  }
  if (problems.length > 0) throw new CollectError(problems)

  mkdirSync(out, { recursive: true })
  for (const name of expected) copyFileSync(join(dir, name), join(out, name))
  return { collected: [...expected], ignored }
}
