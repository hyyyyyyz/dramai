// 约定式提交：校验提交标题，并据此建议下一次该升哪一位（docs/VERSIONING.md 第 4 节）。
import { execFileSync } from 'node:child_process'
import { compareVersions } from './rules.ts'

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'perf',
  'docs',
  'test',
  'ci',
  'chore',
  'refactor',
  'style',
  'build',
  'revert',
] as const
export type CommitType = (typeof COMMIT_TYPES)[number]

const HEADER = new RegExp(`^(${COMMIT_TYPES.join('|')})(?:\\(([^()\\s][^()]*)\\))?(!)?: (\\S.*)$`)

export interface ParsedCommit {
  type: CommitType
  scope?: string
  breaking: boolean
  description: string
}

/** 解析一条提交（标题 + 可选正文）；不符合约定返回 null。 */
export function parseCommit(subject: string, body = ''): ParsedCommit | null {
  const m = HEADER.exec(subject)
  if (!m) return null
  const breaking = m[3] === '!' || /^BREAKING[ -]CHANGE: /m.test(body)
  const commit: ParsedCommit = {
    type: m[1] as CommitType,
    breaking,
    description: m[4] ?? '',
  }
  if (m[2] !== undefined) commit.scope = m[2]
  return commit
}

/** 合并提交和 fixup!/squash!/Revert "…" 这类自动生成的标题不要求符合约定。 */
export function isExemptSubject(subject: string): boolean {
  return /^(Merge |fixup! |squash! |amend! |Revert ")/.test(subject)
}

export function invalidSubjects(subjects: readonly string[]): string[] {
  return subjects.filter((s) => !isExemptSubject(s) && parseCommit(s) === null)
}

export const CONVENTION_HINT =
  `Use "<type>(<scope>)<!>: <description>", where type is one of ${COMMIT_TYPES.join(', ')} ` +
  `(e.g. "feat(storyboard): add JSON streaming parser"; add "!" or a "BREAKING CHANGE:" footer for incompatible changes).`

export type Suggestion = 'none' | 'patch' | 'minor' | 'major'

export interface CommitInput {
  subject: string
  body?: string
}

export interface BumpSuggestion {
  /** 建议升哪一位；1.0.0 之前的不兼容变更已经折算成 minor */
  level: Suggestion
  /** 有不兼容变更（用于提醒更新日志里要有“不兼容变更”一节） */
  breaking: boolean
  counts: Record<Suggestion | 'unconventional', number>
}

const RANK: Record<Suggestion, number> = { none: 0, patch: 1, minor: 2, major: 3 }

/**
 * 按提交类型建议升级的位：fix/perf → patch；feat → minor；不兼容 → major（1.0.0 之前折算成 minor）；
 * docs/test/ci/chore/refactor/style/build 不单独触发发版。一次发版取最高一级。
 */
export function suggestBump(commits: readonly CommitInput[], currentMajor: number): BumpSuggestion {
  let level: Suggestion = 'none'
  let breaking = false
  const counts: BumpSuggestion['counts'] = {
    none: 0,
    patch: 0,
    minor: 0,
    major: 0,
    unconventional: 0,
  }
  for (const c of commits) {
    if (isExemptSubject(c.subject)) continue
    const parsed = parseCommit(c.subject, c.body)
    if (!parsed) {
      counts.unconventional++
      continue
    }
    let one: Suggestion
    if (parsed.breaking) {
      breaking = true
      one = currentMajor === 0 ? 'minor' : 'major'
    } else if (parsed.type === 'feat') one = 'minor'
    else if (parsed.type === 'fix' || parsed.type === 'perf') one = 'patch'
    else one = 'none'
    counts[one]++
    if (RANK[one] > RANK[level]) level = one
  }
  return { level, breaking, counts }
}

/** `git log <range>`：用 NUL 分隔字段、RS 分隔提交，正文里可以有任何字符。 */
export function readCommits(root: string, range: string): CommitInput[] {
  const out = execFileSync('git', ['log', '--no-merges', '--format=%s%x00%b%x1e', range], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return out
    .split('\x1e')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [subject = '', body = ''] = record.split('\x00')
      return { subject: subject.trim(), body }
    })
}

const VERSION_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(beta|rc)\.[1-9]\d*)?$/

/** 仓库里已有的版本 tag（本地，只含符合 v<版本> 规则的，如 v0.5.0、v0.5.0-beta.1）。不在 git 仓库里或没有 git 时返回空。 */
export function readTags(root: string, options: { mergedInto?: string } = {}): string[] {
  try {
    const args = ['tag', '--list', 'v*']
    if (options.mergedInto) args.push('--merged', options.mergedInto)
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((tag) => VERSION_TAG.test(tag))
  } catch {
    return []
  }
}

/** 当前提交可达的、版本最高的版本 tag（用于 suggest 的起点）；没有返回 null。 */
export function latestTag(root: string): string | null {
  const tags = readTags(root, { mergedInto: 'HEAD' })
  if (tags.length === 0) return null
  return tags.reduce((best, tag) => (compareVersions(tag.slice(1), best.slice(1)) > 0 ? tag : best))
}
