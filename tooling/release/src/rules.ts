// 版本号规则（docs/VERSIONING.md）：
//   MAJOR.MINOR.PATCH，预发布只允许 -beta.N 和 -rc.N（N 从 1 起），不带构建元数据。
//   1.0.0 之前，不兼容的变更改次版本，所以“升主版本”从 0.x 出发必须明确确认。
//   已发布的版本号（已有 tag）不重用。

export type PreId = 'beta' | 'rc'

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  pre?: { id: PreId; n: number }
}

const PROJECT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(beta|rc)\.([1-9]\d*))?$/

export const VERSION_FORMAT_HINT =
  'use MAJOR.MINOR.PATCH, optionally with a -beta.N or -rc.N suffix where N starts at 1 (e.g. 0.5.0 or 0.5.0-beta.1)'

/** 按项目规则解析（不接受前导 v）；不合规返回 null。 */
export function parseVersion(version: string): ParsedVersion | null {
  const m = PROJECT_VERSION.exec(version)
  if (!m) return null
  const parsed: ParsedVersion = { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
  if (m[4] !== undefined) parsed.pre = { id: m[4] as PreId, n: Number(m[5]) }
  return parsed
}

export function formatVersion(v: ParsedVersion): string {
  const base = `${v.major}.${v.minor}.${v.patch}`
  return v.pre ? `${base}-${v.pre.id}.${v.pre.n}` : base
}

function mustParse(version: string, what: string): ParsedVersion {
  const parsed = parseVersion(version)
  if (!parsed)
    throw new Error(`${what} "${version}" is not a valid version: ${VERSION_FORMAT_HINT}`)
  return parsed
}

const PRE_ORDER: Record<PreId, number> = { beta: 0, rc: 1 }

/** 版本优先级：-1 / 0 / 1。预发布低于同一个三段式的正式版，beta 低于 rc。 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const x = mustParse(a, 'Version')
  const y = mustParse(b, 'Version')
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1
  }
  if (!x.pre && !y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  if (x.pre.id !== y.pre.id) return PRE_ORDER[x.pre.id] < PRE_ORDER[y.pre.id] ? -1 : 1
  if (x.pre.n !== y.pre.n) return x.pre.n < y.pre.n ? -1 : 1
  return 0
}

export type BumpKind =
  | 'patch'
  | 'minor'
  | 'major'
  | 'prepatch'
  | 'preminor'
  | 'premajor'
  | 'prerelease'
  | 'release'

export const BUMP_KINDS: readonly BumpKind[] = [
  'patch',
  'minor',
  'major',
  'prepatch',
  'preminor',
  'premajor',
  'prerelease',
  'release',
]

export function isBumpKind(value: string): value is BumpKind {
  return (BUMP_KINDS as readonly string[]).includes(value)
}

export interface BumpOptions {
  /** 预发布前缀，默认 beta。`prerelease` 时可从 beta 切到 rc。 */
  preid?: PreId
  /** 从 0.x 升到 1.0.0 需要明确确认。 */
  confirmMajorOne?: boolean
}

function bumpedBase(
  current: ParsedVersion,
  level: 'patch' | 'minor' | 'major',
  options: BumpOptions,
): ParsedVersion {
  if (level === 'major') {
    if (current.major === 0 && !options.confirmMajorOne) {
      throw new Error(
        `Before 1.0.0, incompatible changes bump the minor version (0.${current.minor + 1}.0), not the major one. ` +
          `Use "minor" instead. To really publish 1.0.0 (a commitment that data formats only change with automatic upgrades), pass --confirm-1.0.`,
      )
    }
    return { major: current.major + 1, minor: 0, patch: 0 }
  }
  if (level === 'minor') return { major: current.major, minor: current.minor + 1, patch: 0 }
  return { major: current.major, minor: current.minor, patch: current.patch + 1 }
}

/** 按规则从 `current` 算出下一个版本。不合规的输入抛出带原因的错误。 */
export function bumpVersion(current: string, kind: BumpKind, options: BumpOptions = {}): string {
  const cur = mustParse(current, 'Current version')
  const preid = options.preid ?? 'beta'

  switch (kind) {
    case 'patch':
    case 'minor':
    case 'major': {
      if (cur.pre) {
        throw new Error(
          `${current} is a prerelease, so "${kind}" is ambiguous. Use "release" to promote it to ` +
            `${formatVersion({ ...cur, pre: undefined })}, or "prerelease" to move on to the next beta/rc.`,
        )
      }
      return formatVersion(bumpedBase(cur, kind, options))
    }

    case 'prepatch':
    case 'preminor':
    case 'premajor': {
      if (cur.pre) {
        throw new Error(
          `${current} is already a prerelease. Use "prerelease" for the next beta/rc, or "release" to promote it.`,
        )
      }
      const level = kind === 'prepatch' ? 'patch' : kind === 'preminor' ? 'minor' : 'major'
      return formatVersion({ ...bumpedBase(cur, level, options), pre: { id: preid, n: 1 } })
    }

    case 'prerelease': {
      if (!cur.pre) {
        throw new Error(
          `${current} is a stable release, so there is no prerelease to advance. ` +
            `Start one with "prepatch", "preminor" or "premajor" (e.g. ${formatVersion({ ...bumpedBase(cur, 'minor', options), pre: { id: preid, n: 1 } })}).`,
        )
      }
      if (options.preid === undefined || options.preid === cur.pre.id) {
        return formatVersion({ ...cur, pre: { id: cur.pre.id, n: cur.pre.n + 1 } })
      }
      if (PRE_ORDER[options.preid] < PRE_ORDER[cur.pre.id]) {
        throw new Error(
          `Cannot go back from ${cur.pre.id} to ${options.preid}; prereleases only move beta -> rc.`,
        )
      }
      return formatVersion({ ...cur, pre: { id: options.preid, n: 1 } })
    }

    case 'release': {
      if (!cur.pre) {
        throw new Error(
          `${current} is already a stable release; there is no prerelease to promote.`,
        )
      }
      return formatVersion({ ...cur, pre: undefined })
    }
  }
}

/** 检查“把仓库版本改成 `next`”是否合规：格式、不低于当前、不重复已有 tag。返回问题列表（空即合规）。 */
export function validateTransition(
  current: string,
  next: string,
  existingTags: readonly string[],
): string[] {
  const problems: string[] = []
  const target = parseVersion(next)
  if (!target) {
    return [`"${next}" is not a valid version: ${VERSION_FORMAT_HINT}`]
  }
  const cur = parseVersion(current)
  if (cur && compareVersions(next, current) < 0) {
    problems.push(`${next} is lower than the current version ${current}; versions only go up.`)
  }
  if (next !== current && existingTags.includes(`v${next}`)) {
    problems.push(
      `Tag v${next} already exists. Published version numbers are never reused or changed; ` +
        `pick the next one (a new patch release fixes problems in an old one).`,
    )
  }
  return problems
}
