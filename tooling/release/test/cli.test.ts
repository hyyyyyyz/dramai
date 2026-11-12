import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
let root: string

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--disable-warning=ExperimentalWarning',
      CLI,
      ...args,
      '--root',
      root,
    ],
    { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', ...env } },
  )
  return { code: r.status, out: r.stdout, err: r.stderr }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dramai-release-cli-'))
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
  writeFileSync(
    join(root, 'package.json'),
    '{\n  "name": "root",\n  "version": "0.5.0-beta.1"\n}\n',
  )
  mkdirSync(join(root, 'packages/a'), { recursive: true })
  writeFileSync(
    join(root, 'packages/a/package.json'),
    '{\n  "name": "a",\n  "version": "0.5.0-beta.1"\n}\n',
  )
  writeFileSync(
    join(root, 'CHANGELOG.md'),
    '## [Unreleased]\n\n## [0.5.0-beta.1] - 2026-12-01\n\n- Beta\n',
  )
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('cli', () => {
  it('check passes and exports version / tag / prerelease for GitHub Actions', () => {
    const outFile = join(root, 'gh-output')
    const r = run(['check', '--tag', 'v0.5.0-beta.1'], { GITHUB_OUTPUT: outFile })
    expect(r.code).toBe(0)
    expect(readFileSync(outFile, 'utf8')).toBe(
      'version=0.5.0-beta.1\ntag=v0.5.0-beta.1\nprerelease=true\n',
    )
  })

  it('check fails on a tag mismatch with a ::error:: annotation', () => {
    const r = run(['check', '--tag', 'v0.5.0'])
    expect(r.code).toBe(1)
    expect(r.err).toContain(
      '::error::Tag "v0.5.0" is version 0.5.0, but the repository is at 0.5.0-beta.1',
    )
  })

  it('set then check round-trips', () => {
    expect(run(['set', '0.5.0']).code).toBe(0)
    const r = run(['check', '--tag', 'v0.5.0'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('All 2 packages are at 0.5.0 (matches tag v0.5.0)')
  })

  it('set --dry-run leaves the files alone', () => {
    const r = run(['set', '--dry-run', '0.6.0'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('[dry-run] package.json: 0.5.0-beta.1 -> 0.6.0')
    expect(run(['check']).code).toBe(0)
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('0.5.0-beta.1')
  })

  it('set rejects a bad version with a non-zero exit', () => {
    const r = run(['set', 'banana'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('not a valid version')
  })

  it('notes prints the section, writes --out, and exits 3 when the section is missing', () => {
    expect(run(['notes', '0.5.0-beta.1']).out.trim()).toBe('- Beta')
    const outFile = join(root, 'notes.md')
    expect(run(['notes', '0.5.0-beta.1', '--out', outFile]).code).toBe(0)
    expect(readFileSync(outFile, 'utf8')).toBe('- Beta\n')
    expect(run(['notes', '1.0.0']).code).toBe(3)
  })

  it('collect copies the installers for one platform and warns about stray files', () => {
    mkdirSync(join(root, 'release'))
    writeFileSync(join(root, 'release/dramai-0.5.0-beta.1-win-x64.exe'), 'x')
    writeFileSync(join(root, 'release/dramai-setup.exe'), 'x')
    const r = run([
      'collect',
      '--dir',
      'release',
      '--out',
      'staging',
      '--version',
      '0.5.0-beta.1',
      '--family',
      'win',
      '--arch',
      'x64',
    ])
    expect(r.code).toBe(0)
    expect(r.out).toContain('asset: dramai-0.5.0-beta.1-win-x64.exe')
    expect(r.out).toContain('::warning::Ignoring dramai-setup.exe')
    expect(readFileSync(join(root, 'staging/dramai-0.5.0-beta.1-win-x64.exe'), 'utf8')).toBe('x')
  })

  it('collect fails when the platform produced nothing usable', () => {
    mkdirSync(join(root, 'release'))
    const r = run([
      'collect',
      '--dir',
      'release',
      '--out',
      'staging',
      '--version',
      '0.5.0-beta.1',
      '--family',
      'mac',
      '--arch',
      'arm64',
    ])
    expect(r.code).toBe(1)
    expect(r.err).toContain('::error::No installer named')
  })

  describe('bump', () => {
    it('bumps by rule across every package and prints the transition', () => {
      const r = run(['bump', 'preminor'])
      expect(r.code).toBe(1) // 0.5.0-beta.1 已经是预发布
      expect(r.err).toContain('already a prerelease')
      expect(run(['bump', 'prerelease']).code).toBe(0)
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain(
        '"version": "0.5.0-beta.2"',
      )
      expect(readFileSync(join(root, 'packages/a/package.json'), 'utf8')).toContain(
        '"version": "0.5.0-beta.2"',
      )
      expect(run(['bump', 'prerelease', '--preid', 'rc']).out).toContain(
        '0.5.0-beta.2 -> 0.5.0-rc.1',
      )
      expect(run(['bump', 'release']).out).toContain('0.5.0-rc.1 -> 0.5.0')
      expect(run(['bump', 'minor']).out).toContain('0.5.0 -> 0.6.0')
      expect(run(['bump', 'patch']).out).toContain('0.6.0 -> 0.6.1')
    })

    it('--dry-run changes nothing', () => {
      expect(run(['bump', 'release', '--dry-run']).out).toContain(
        '[dry-run] package.json: 0.5.0-beta.1 -> 0.5.0',
      )
      expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('0.5.0-beta.1')
    })

    it('rejects unknown kinds, bad --preid and 0.x -> 1.0.0', () => {
      expect(run(['bump', 'huge']).code).toBe(2)
      expect(run(['bump', 'prerelease', '--preid', 'alpha']).err).toContain('--preid must be')
      run(['bump', 'release'])
      const r = run(['bump', 'major'])
      expect(r.code).toBe(1)
      expect(r.err).toContain('Before 1.0.0')
      expect(run(['bump', 'major', '--confirm-1.0']).out).toContain('0.5.0 -> 1.0.0')
    })

    it('refuses a version whose tag already exists, and a lower version', () => {
      const git = (...a: string[]) =>
        spawnSync(
          'git',
          [
            '-c',
            'user.name=t',
            '-c',
            'user.email=t@example.com',
            '-c',
            'commit.gpgsign=false',
            ...a,
          ],
          {
            cwd: root,
            encoding: 'utf8',
          },
        )
      git('init', '-q')
      git('add', '.')
      git('commit', '-q', '-m', 'chore: init')
      git('tag', 'v0.5.0')
      const dup = run(['bump', 'release'])
      expect(dup.code).toBe(1)
      expect(dup.err).toContain('Tag v0.5.0 already exists')
      const lower = run(['set', '0.4.0'])
      expect(lower.code).toBe(1)
      expect(lower.err).toContain('lower than the current version 0.5.0-beta.1')
    })
  })

  it('check --since fails when the version went down relative to a git ref', () => {
    const git = (...a: string[]) =>
      spawnSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a],
        {
          cwd: root,
          encoding: 'utf8',
        },
      )
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'chore: init')
    expect(run(['check', '--since', 'main']).code).toBe(0)
    writeFileSync(join(root, 'package.json'), '{\n  "name": "root",\n  "version": "0.4.0"\n}\n')
    writeFileSync(
      join(root, 'packages/a/package.json'),
      '{\n  "name": "a",\n  "version": "0.4.0"\n}\n',
    )
    const r = run(['check', '--since', 'main'])
    expect(r.code).toBe(1)
    expect(r.err).toContain('lower than 0.5.0-beta.1 on main')
    expect(run(['check', '--since', 'no-such-ref']).out).toContain('Could not read the version')
  })

  it('commits checks the PR title and warns (or with --strict-commits fails) on commit subjects', () => {
    const git = (...a: string[]) =>
      spawnSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a],
        {
          cwd: root,
          encoding: 'utf8',
        },
      )
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'chore: init')
    git('checkout', '-q', '-b', 'topic')
    writeFileSync(join(root, 'x.txt'), '1')
    git('add', '.')
    git('commit', '-q', '-m', 'wip stuff')
    writeFileSync(join(root, 'x.txt'), '2')
    git('add', '.')
    git('commit', '-q', '-m', 'fix(core): real')

    const ok = run(['commits', '--base', 'main', '--title', 'feat(ui): nice'])
    expect(ok.code).toBe(0)
    expect(ok.out).toContain('::warning::Commit "wip stuff" does not follow Conventional Commits')
    expect(ok.out).toContain('Checked 2 commit(s): 1 not conventional.')

    const badTitle = run(['commits', '--title', 'Update things'])
    expect(badTitle.code).toBe(1)
    expect(badTitle.err).toContain('PR title "Update things" does not follow Conventional Commits')

    expect(run(['commits', '--base', 'main', '--strict-commits']).code).toBe(1)
  })

  it('suggest reads the commits since a ref', () => {
    const git = (...a: string[]) =>
      spawnSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a],
        {
          cwd: root,
          encoding: 'utf8',
        },
      )
    git('init', '-q', '-b', 'main')
    git('add', '.')
    git('commit', '-q', '-m', 'chore: init')
    git('tag', 'v0.4.0')
    run(['bump', 'release']) // 0.5.0
    writeFileSync(join(root, 'y.txt'), '1')
    git('add', '.')
    git('commit', '-q', '-m', 'feat(ui)!: redo it')
    const r = run(['suggest', '--since', 'v0.4.0'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('Suggestion: minor -> 0.6.0') // 0.x 的不兼容变更折算成次版本
    expect(r.out).toContain('不兼容变更')
  })
})
