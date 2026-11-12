import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  invalidSubjects,
  isExemptSubject,
  latestTag,
  parseCommit,
  readCommits,
  readTags,
  suggestBump,
} from '../src/commits.ts'

describe('parseCommit', () => {
  it('parses type, scope, breaking marker and description', () => {
    expect(parseCommit('feat(storyboard): add JSON streaming parser')).toEqual({
      type: 'feat',
      scope: 'storyboard',
      breaking: false,
      description: 'add JSON streaming parser',
    })
    expect(parseCommit('fix: handle empty reply')).toMatchObject({ type: 'fix', breaking: false })
    expect(parseCommit('feat(server,core)!: drop the old route')).toMatchObject({
      scope: 'server,core',
      breaking: true,
    })
  })

  it('sees a BREAKING CHANGE footer in the body', () => {
    expect(
      parseCommit('refactor: rework storage', 'text\n\nBREAKING CHANGE: data dir moved')?.breaking,
    ).toBe(true)
    expect(parseCommit('refactor: rework storage', 'BREAKING-CHANGE: x')?.breaking).toBe(true)
    expect(
      parseCommit('refactor: rework storage', 'mentions BREAKING CHANGE: inline')?.breaking,
    ).toBe(false)
  })

  it('rejects titles that are not conventional', () => {
    for (const s of [
      'update stuff',
      'Fix: capital',
      'feat add thing',
      'feat:no space',
      'feat(): empty',
      'wip',
      'feature: x',
      '',
    ]) {
      expect(parseCommit(s), s).toBeNull()
    }
  })
})

describe('invalidSubjects', () => {
  it('lists the bad ones and exempts merges and fixups', () => {
    expect(
      invalidSubjects([
        'feat: ok',
        'Merge branch "x" into y',
        'fixup! feat: ok',
        'Revert "feat: ok"',
        'oops',
        'Update README',
      ]),
    ).toEqual(['oops', 'Update README'])
    expect(isExemptSubject('squash! fix: a')).toBe(true)
  })
})

describe('suggestBump', () => {
  const s = (subject: string, body = '') => ({ subject, body })

  it('maps types to levels and takes the highest', () => {
    expect(suggestBump([s('fix: a'), s('perf: b')], 0).level).toBe('patch')
    expect(suggestBump([s('fix: a'), s('feat: b')], 0).level).toBe('minor')
    expect(
      suggestBump(
        [s('docs: a'), s('ci: b'), s('chore: c'), s('refactor: d'), s('style: e'), s('test: f')],
        0,
      ).level,
    ).toBe('none')
  })

  it('maps breaking changes to major, but to minor before 1.0.0', () => {
    expect(suggestBump([s('feat!: x')], 1)).toMatchObject({ level: 'major', breaking: true })
    expect(suggestBump([s('feat!: x')], 0)).toMatchObject({ level: 'minor', breaking: true })
    expect(suggestBump([s('fix: x', 'BREAKING CHANGE: y')], 2).level).toBe('major')
  })

  it('counts unconventional commits and skips merges', () => {
    const r = suggestBump([s('whatever'), s('Merge pull request #1'), s('fix: a')], 0)
    expect(r.counts).toMatchObject({ unconventional: 1, patch: 1 })
    expect(r.level).toBe('patch')
  })

  it('suggests nothing for an empty range', () => {
    expect(suggestBump([], 0)).toMatchObject({ level: 'none', breaking: false })
  })
})

describe('git helpers', () => {
  let repo: string
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      {
        cwd: repo,
        encoding: 'utf8',
      },
    )
  const commit = (message: string) => {
    writeFileSync(join(repo, 'f.txt'), `${Math.random()}`)
    git('add', '.')
    git('commit', '-q', '-m', message)
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'dramai-git-'))
    git('init', '-q')
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('reads commit subjects and bodies, newest first, with multi-line bodies intact', () => {
    commit('feat: first')
    commit('fix(core): second\n\nBREAKING CHANGE: x\nmore text')
    const commits = readCommits(repo, 'HEAD')
    expect(commits.map((c) => c.subject)).toEqual(['fix(core): second', 'feat: first'])
    expect(commits[0]?.body).toContain('BREAKING CHANGE: x')
    expect(commits[0]?.body).toContain('more text')
  })

  it('reads a range, tags and the latest tag', () => {
    commit('feat: one')
    git('tag', 'v0.1.0')
    commit('fix: two')
    commit('feat: three')
    expect(readTags(repo)).toEqual(['v0.1.0'])
    expect(latestTag(repo)).toBe('v0.1.0')
    expect(readCommits(repo, 'v0.1.0..HEAD').map((c) => c.subject)).toEqual([
      'feat: three',
      'fix: two',
    ])
  })

  it('ignores tags that are not version tags and picks the highest reachable version', () => {
    commit('feat: one')
    git('tag', 'v0.4.1-legacy')
    git('tag', 'v0.4.1')
    git('tag', 'nightly')
    commit('feat: two')
    git('tag', 'v0.5.0-beta.1')
    git('tag', 'v0.5.0-beta.10')
    git('tag', 'v0.5.0-beta.2')
    expect(readTags(repo).sort()).toEqual([
      'v0.4.1',
      'v0.5.0-beta.1',
      'v0.5.0-beta.10',
      'v0.5.0-beta.2',
    ])
    expect(latestTag(repo)).toBe('v0.5.0-beta.10')
  })

  it('returns nothing outside a repository', () => {
    const plain = mkdtempSync(join(tmpdir(), 'dramai-nogit-'))
    try {
      expect(readTags(plain)).toEqual([])
      expect(latestTag(plain)).toBeNull()
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})
