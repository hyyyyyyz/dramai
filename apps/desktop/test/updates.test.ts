import { describe, expect, it } from 'vitest'
import { checkForUpdate, compareSemver, parseSemver, repoSlug } from '../src/main/updates.ts'

const cmp = (a: string, b: string) => compareSemver(parseSemver(a)!, parseSemver(b)!)

describe('semver', () => {
  it('orders versions, with pre-releases below their release', () => {
    expect(cmp('0.5.0', '0.4.1')).toBe(1)
    expect(cmp('v0.4.1', '0.4.1')).toBe(0)
    expect(cmp('0.5.0-beta.1', '0.5.0')).toBe(-1)
    expect(cmp('0.5.0-beta.2', '0.5.0-beta.10')).toBe(-1)
    expect(cmp('0.5.0-alpha', '0.5.0-beta')).toBe(-1)
    expect(cmp('0.5.0-1', '0.5.0-alpha')).toBe(-1)
    expect(cmp('1.0.0', '0.99.99')).toBe(1)
  })
  it('rejects junk', () => {
    expect(parseSemver('latest')).toBeUndefined()
    expect(parseSemver('1.2')).toBeUndefined()
  })
  it('extracts the repo slug', () => {
    expect(repoSlug('git+https://github.com/hyyyyyyz/dramai.git')).toBe('hyyyyyyz/dramai')
    expect(repoSlug('https://github.com/a/b')).toBe('a/b')
    expect(repoSlug('https://example.com/x')).toBeUndefined()
  })
})

const REPO = 'hyyyyyyz/dramai'
const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/${REPO}/releases/tag/${tag}`,
  draft: false,
  prerelease: tag.includes('-'),
  ...extra,
})

function feed(releases: unknown, init: { status?: number } = {}): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(releases), {
      status: init.status ?? 200,
    })) as unknown as typeof fetch
}

describe('update check against a fake release feed', () => {
  it('reports a newer stable release with a link to its page', async () => {
    const r = await checkForUpdate({
      currentVersion: '0.4.1',
      repo: REPO,
      fetch: feed([rel('v0.5.0'), rel('v0.4.1'), rel('v0.5.1-beta.1')]),
    })
    expect(r).toMatchObject({
      status: 'available',
      release: { version: '0.5.0', url: `https://github.com/${REPO}/releases/tag/v0.5.0` },
    })
  })

  it('says up to date when nothing is newer', async () => {
    const r = await checkForUpdate({
      currentVersion: '0.5.0',
      repo: REPO,
      fetch: feed([rel('v0.5.0'), rel('v0.4.1')]),
    })
    expect(r.status).toBe('up-to-date')
  })

  it('stable users are not offered pre-releases or drafts', async () => {
    const r = await checkForUpdate({
      currentVersion: '0.4.1',
      repo: REPO,
      fetch: feed([rel('v0.6.0-beta.1'), rel('v0.5.0', { draft: true })]),
    })
    expect(r.status).toBe('up-to-date')
  })

  it('pre-release users also see newer pre-releases, and the final release beats its beta', async () => {
    const beta = await checkForUpdate({
      currentVersion: '0.5.0-beta.1',
      repo: REPO,
      fetch: feed([rel('v0.5.0-beta.2'), rel('v0.5.0-beta.1')]),
    })
    expect(beta).toMatchObject({
      status: 'available',
      release: { version: '0.5.0-beta.2', prerelease: true },
    })
    const final = await checkForUpdate({
      currentVersion: '0.5.0-beta.2',
      repo: REPO,
      fetch: feed([rel('v0.5.0'), rel('v0.5.0-beta.2')]),
    })
    expect(final).toMatchObject({ status: 'available', release: { version: '0.5.0' } })
  })

  it('ignores releases whose page link does not point at this repository', async () => {
    const r = await checkForUpdate({
      currentVersion: '0.4.1',
      repo: REPO,
      fetch: feed([rel('v9.9.9', { html_url: 'https://evil.example/download' })]),
    })
    expect(r.status).toBe('up-to-date')
  })

  it('reports errors instead of throwing', async () => {
    expect(
      (
        await checkForUpdate({
          currentVersion: '0.4.1',
          repo: REPO,
          fetch: feed([], { status: 403 }),
        })
      ).status,
    ).toBe('error')
    expect(
      (
        await checkForUpdate({
          currentVersion: '0.4.1',
          repo: REPO,
          fetch: (async () => {
            throw new Error('offline')
          }) as unknown as typeof fetch,
        })
      ).status,
    ).toBe('error')
    expect(
      (
        await checkForUpdate({
          currentVersion: '0.4.1',
          repo: REPO,
          fetch: feed({ message: 'nope' }),
        })
      ).status,
    ).toBe('error')
    expect(
      (await checkForUpdate({ currentVersion: 'dev', repo: REPO, fetch: feed([]) })).status,
    ).toBe('error')
  })

  it('sends a plain GitHub API request with no personal data', async () => {
    let seen: { url: string; headers: Record<string, string> } | undefined
    await checkForUpdate({
      currentVersion: '0.4.1',
      repo: REPO,
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url, headers: init.headers as Record<string, string> }
        return new Response('[]')
      }) as unknown as typeof fetch,
    })
    expect(seen?.url).toBe(`https://api.github.com/repos/${REPO}/releases?per_page=20`)
    expect(Object.keys(seen!.headers).sort()).toEqual([
      'Accept',
      'User-Agent',
      'X-GitHub-Api-Version',
    ])
    expect(seen!.headers['User-Agent']).toBe('dramai-desktop/0.4.1')
  })
})
