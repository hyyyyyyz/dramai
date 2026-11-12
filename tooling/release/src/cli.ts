// 用法（仓库根目录）：
//   pnpm version:set 0.5.0            把所有包的版本改成 0.5.0（--dry-run 只预览）
//   pnpm version:check                检查所有包版本一致
//   pnpm version:check --tag v0.5.0   同时核对 tag 与仓库版本
//   node tooling/release/src/cli.ts notes 0.5.0 [--out notes.md]
//                                      提取 CHANGELOG 里 0.5.0 的小节
//   node tooling/release/src/cli.ts collect --dir apps/desktop/release --out staging \
//        --version 0.5.0 --family mac --arch arm64
//                                      挑出符合 dramai-<版本>-<系统>-<架构>.<扩展名> 的安装包
//
// 在 GitHub Actions 里（设置了 GITHUB_OUTPUT）`check` 还会输出 version / tag / prerelease。
import { appendFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkVersions, isPrerelease, normalizeVersion, setVersion } from './versions.ts'
import { readChangelogSection } from './notes.ts'
import { collectAssets, type Arch, type PlatformFamily } from './assets.ts'

const EXIT_MISSING_NOTES = 3

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

function main(argv: string[]): number {
  const [command, ...args] = argv
  const root = resolve(flag(args, '--root') ?? process.cwd())

  switch (command) {
    case 'set': {
      const target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--root')
      if (!target) {
        console.error('Usage: version:set <version> [--dry-run]')
        return 2
      }
      const dryRun = args.includes('--dry-run')
      const { version, changed } = setVersion(root, target, { dryRun })
      for (const c of changed)
        console.log(`${dryRun ? '[dry-run] ' : ''}${c.file}: ${c.version} -> ${version}`)
      console.log(
        changed.length === 0
          ? `Every package is already at ${version}.`
          : `${dryRun ? 'Would update' : 'Updated'} ${changed.length} package.json file(s) to ${version}.`,
      )
      if (!dryRun && changed.length > 0) {
        console.log(
          'Next: add a "## [' +
            version +
            ']" section to CHANGELOG.md, commit, then tag v' +
            version +
            '.',
        )
      }
      return 0
    }

    case 'check': {
      const tag = flag(args, '--tag')
      const result = checkVersions(root, tag === undefined ? {} : { tag })
      if (!result.ok) {
        for (const p of result.problems) console.error(`::error::${p}`)
        return 1
      }
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

    case 'notes': {
      const version = normalizeVersion(
        args.find(
          (a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--root',
        ) ?? '',
      )
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
      const { collected, ignored } = collectAssets({
        dir: resolve(root, dir),
        out: resolve(root, out),
        version: normalizeVersion(version),
        family: family as PlatformFamily,
        arch: arch as Arch,
      })
      for (const name of collected) console.log(`asset: ${name}`)
      for (const name of ignored) {
        console.log(
          `::warning::Ignoring ${name}: it does not follow dramai-<version>-<os>-<arch>.<ext> and will not be uploaded`,
        )
      }
      return 0
    }

    default:
      console.error('Usage: cli.ts <set|check|notes|collect> ...')
      return 2
  }
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (error) {
  console.error(`::error::${(error as Error).message}`)
  process.exitCode = 1
}
