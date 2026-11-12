// 用法（仓库根目录）：
//   pnpm version:bump patch|minor|major            按规则升级（见 docs/VERSIONING.md）
//   pnpm version:bump prepatch|preminor|premajor   开始一个预发布（默认 -beta.1，--preid rc 改为 rc.1）
//   pnpm version:bump prerelease [--preid rc]      预发布序号加一；--preid rc 把 beta 推进到 rc.1
//   pnpm version:bump release                      把预发布转正（0.5.0-rc.1 -> 0.5.0）
//   pnpm version:set 0.5.0                         直接指定版本（同样要符合规则）
//   pnpm version:check [--tag v0.5.0] [--since origin/main]
//                                                  检查各包版本一致；可核对 tag、以及不低于某个分支上的版本
//   pnpm version:suggest [--since v0.4.1]          按提交类型建议该升哪一位
//   node tooling/release/src/cli.ts commits --base origin/main [--title "<PR 标题>"]
//                                                  检查 PR 标题 / 提交标题是否符合约定式提交
//   node tooling/release/src/cli.ts notes 0.5.0 [--out notes.md]
//                                                  提取 CHANGELOG 里 0.5.0 的小节
//   node tooling/release/src/cli.ts collect --dir apps/desktop/release --out staging \
//        --version 0.5.0 --family mac --arch arm64
//                                                  核对并取出该系统应有的安装包（缺任何一个或命名不对都失败）
//
// 公共选项：--dry-run（只预览）、--root <dir>（默认当前目录）。
// 在 GitHub Actions 里（设置了 GITHUB_OUTPUT）`check` 还会输出 version / tag / prerelease。
import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkVersions, isPrerelease, normalizeVersion, setVersion } from './versions.ts'
import { readChangelogSection } from './notes.ts'
import { collectAssets, CollectError, type Arch, type PlatformFamily } from './assets.ts'
import {
  BUMP_KINDS,
  bumpVersion,
  compareVersions,
  isBumpKind,
  parseVersion,
  validateTransition,
  type BumpOptions,
  type PreId,
} from './rules.ts'
import {
  CONVENTION_HINT,
  invalidSubjects,
  latestTag,
  parseCommit,
  readCommits,
  readTags,
  suggestBump,
} from './commits.ts'

const EXIT_MISSING_NOTES = 3

const VALUE_FLAGS = new Set([
  '--root',
  '--tag',
  '--since',
  '--out',
  '--changelog',
  '--preid',
  '--base',
  '--head',
  '--title',
])

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

/** 第一个不是选项、也不是选项取值的参数。 */
function positional(args: string[]): string | undefined {
  return args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1] ?? ''))
}

function currentVersion(root: string): string {
  const result = checkVersions(root)
  if (parseVersion(result.version) === null) {
    throw new Error(
      `The repository version "${result.version}" is not valid; fix package.json first (pnpm version:set <version>).`,
    )
  }
  return result.version
}

function versionAtRef(root: string, ref: string): string | null {
  try {
    const text = execFileSync('git', ['show', `${ref}:package.json`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return (JSON.parse(text) as { version?: string }).version ?? null
  } catch {
    return null
  }
}

function apply(root: string, next: string, dryRun: boolean): number {
  const { version, changed } = setVersion(root, next, { dryRun })
  for (const c of changed) {
    console.log(`${dryRun ? '[dry-run] ' : ''}${c.file}: ${c.version} -> ${version}`)
  }
  console.log(
    changed.length === 0
      ? `Every package is already at ${version}.`
      : `${dryRun ? 'Would update' : 'Updated'} ${changed.length} package.json file(s) to ${version}.`,
  )
  if (!dryRun && changed.length > 0) {
    console.log(
      `Next: add a "## [${version}]" section to CHANGELOG.md, commit, then tag v${version}.`,
    )
  }
  return 0
}

function fail(problems: string[]): number {
  for (const p of problems) console.error(`::error::${p}`)
  return 1
}

function main(argv: string[]): number {
  const [command, ...args] = argv
  const root = resolve(flag(args, '--root') ?? process.cwd())
  const dryRun = args.includes('--dry-run')

  switch (command) {
    case 'set': {
      const target = positional(args)
      if (!target) {
        console.error('Usage: version:set <version> [--dry-run]')
        return 2
      }
      const next = normalizeVersion(target)
      const problems = validateTransition(currentVersion(root), next, readTags(root))
      if (problems.length > 0) return fail(problems)
      return apply(root, next, dryRun)
    }

    case 'bump': {
      const kind = positional(args)
      if (!kind || !isBumpKind(kind)) {
        console.error(
          `Usage: version:bump <${BUMP_KINDS.join('|')}> [--preid beta|rc] [--confirm-1.0] [--dry-run]`,
        )
        return 2
      }
      const preid = flag(args, '--preid')
      if (preid !== undefined && preid !== 'beta' && preid !== 'rc') {
        return fail([`--preid must be "beta" or "rc" (got "${preid}")`])
      }
      const options: BumpOptions = { confirmMajorOne: args.includes('--confirm-1.0') }
      if (preid !== undefined) options.preid = preid as PreId
      const current = currentVersion(root)
      const next = bumpVersion(current, kind, options)
      const problems = validateTransition(current, next, readTags(root))
      if (problems.length > 0) return fail(problems)
      console.log(`${current} -> ${next} (${kind})`)
      return apply(root, next, dryRun)
    }

    case 'check': {
      const tag = flag(args, '--tag')
      const since = flag(args, '--since')
      const result = checkVersions(root, tag === undefined ? {} : { tag })
      const problems = [...result.problems]
      if (since !== undefined && parseVersion(result.version) !== null) {
        const base = versionAtRef(root, since)
        if (base === null) {
          console.log(
            `::notice::Could not read the version at ${since}; skipping the "version must not go down" check.`,
          )
        } else if (parseVersion(base) !== null && compareVersions(result.version, base) < 0) {
          problems.push(
            `The version ${result.version} is lower than ${base} on ${since}; versions only go up.`,
          )
        }
      }
      if (problems.length > 0) return fail(problems)
      console.log(
        `All ${result.packages.length} packages are at ${result.version}${tag ? ` (matches tag ${tag})` : ''}.`,
      )
      const out = process.env.GITHUB_OUTPUT
      if (out) {
        appendFileSync(
          out,
          `version=${result.version}\ntag=v${result.version}\nprerelease=${isPrerelease(result.version)}\n`,
        )
      }
      return 0
    }

    case 'suggest': {
      const current = currentVersion(root)
      const since = flag(args, '--since') ?? latestTag(root)
      const commits = readCommits(root, since ? `${since}..HEAD` : 'HEAD')
      const s = suggestBump(commits, parseVersion(current)?.major ?? 0)
      console.log(`Commits since ${since ?? 'the beginning'}: ${commits.length}`)
      console.log(
        `  patch-level: ${s.counts.patch}, minor-level: ${s.counts.minor}, no release by themselves: ${s.counts.none}, not conventional: ${s.counts.unconventional}`,
      )
      if (s.level === 'none') {
        console.log(
          'Suggestion: nothing here triggers a release by itself; if you release anyway, bump the patch version.',
        )
      } else {
        let next: string
        try {
          next = bumpVersion(current, s.level)
        } catch {
          next = `(${current} is a prerelease: use "prerelease" or "release")`
        }
        console.log(`Suggestion: ${s.level} -> ${next}`)
      }
      if (s.breaking) {
        console.log(
          'There are incompatible changes: the CHANGELOG needs an "Incompatible changes" section (and "Upgrade notes") that says what users must do.',
        )
      }
      if (s.counts.unconventional > 0) {
        console.log(
          `::warning::${s.counts.unconventional} commit(s) do not follow Conventional Commits and were ignored.`,
        )
      }
      return 0
    }

    case 'commits': {
      const problems: string[] = []
      const title = flag(args, '--title')
      if (title !== undefined && parseCommit(title) === null) {
        problems.push(
          `PR title "${title}" does not follow Conventional Commits. ${CONVENTION_HINT}`,
        )
      }
      const base = flag(args, '--base')
      if (base !== undefined) {
        const subjects = readCommits(root, `${base}..${flag(args, '--head') ?? 'HEAD'}`).map(
          (c) => c.subject,
        )
        const bad = invalidSubjects(subjects)
        for (const subject of bad) {
          const message = `Commit "${subject}" does not follow Conventional Commits. ${CONVENTION_HINT}`
          if (args.includes('--strict-commits')) problems.push(message)
          else console.log(`::warning::${message}`)
        }
        console.log(`Checked ${subjects.length} commit(s): ${bad.length} not conventional.`)
      }
      if (problems.length > 0) return fail(problems)
      console.log('Conventional Commits check passed.')
      return 0
    }

    case 'notes': {
      const version = normalizeVersion(positional(args) ?? '')
      const section = readChangelogSection(
        join(root, flag(args, '--changelog') ?? 'CHANGELOG.md'),
        version,
      )
      if (section === null) {
        console.error(`CHANGELOG.md has no non-empty "## [${version}]" section.`)
        return EXIT_MISSING_NOTES
      }
      const outFile = flag(args, '--out')
      if (outFile) writeFileSync(outFile, `${section}\n`)
      else console.log(section)
      return 0
    }

    case 'collect': {
      const dir = flag(args, '--dir')
      const out = flag(args, '--out')
      const version = flag(args, '--version')
      const family = flag(args, '--family')
      const arch = flag(args, '--arch')
      if (!dir || !out || !version || !family || !arch) {
        console.error(
          'Usage: cli.ts collect --dir <dir> --out <dir> --version <v> --family <mac|win|linux> --arch <arm64|x64>',
        )
        return 2
      }
      if (!['mac', 'win', 'linux'].includes(family) || !['arm64', 'x64'].includes(arch)) {
        console.error(`Unsupported --family "${family}" or --arch "${arch}"`)
        return 2
      }
      let result
      try {
        result = collectAssets({
          dir: resolve(root, dir),
          out: resolve(root, out),
          version: normalizeVersion(version),
          family: family as PlatformFamily,
          arch: arch as Arch,
        })
      } catch (error) {
        if (error instanceof CollectError) return fail(error.problems)
        throw error
      }
      const { collected, ignored } = result
      for (const name of collected) console.log(`asset: ${name}`)
      for (const name of ignored) {
        console.log(`::warning::Ignoring ${name}: it is not an installer and will not be uploaded`)
      }
      return 0
    }

    default:
      console.error('Usage: cli.ts <set|bump|check|suggest|commits|notes|collect> ...')
      return 2
  }
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  console.error(`::error::${(error as Error).message}`)
  process.exitCode = 1
}
