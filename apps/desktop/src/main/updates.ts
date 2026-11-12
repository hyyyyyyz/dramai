/**
 * 检查更新：问 GitHub Releases 有没有比当前更新的版本，有就告诉用户并给出发布页链接。
 *
 * 这里只做“通知”。真正的自动更新（下载、替换、重启）在 macOS 上要求应用已签名并公证，第一版没有签名，
 * 所以先不做；等签名就绪后改用 electron-updater，见 apps/desktop/README.md。
 */

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export interface Semver {
  major: number
  minor: number
  patch: number
  pre: string[]
}

export function parseSemver(text: string): Semver | undefined {
  const m = SEMVER.exec(text.trim())
  if (!m) return undefined
  return { major: +m[1]!, minor: +m[2]!, patch: +m[3]!, pre: m[4] ? m[4].split('.') : [] }
}

/** 按 semver 规则比较：正式版大于同号预发布版；预发布标识逐段比较（数字段按数值，数字小于字母）。 */
export function compareSemver(a: Semver, b: Semver): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0
  if (a.pre.length === 0) return 1
  if (b.pre.length === 0) return -1
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return +x < +y ? -1 : 1
    if (xn) return -1
    if (yn) return 1
    return x < y ? -1 : 1
  }
  return 0
}

export interface ReleaseInfo {
  version: string
  tag: string
  url: string
  prerelease: boolean
  name?: string
  publishedAt?: string
}

export type UpdateCheck =
  | { status: 'up-to-date'; latest?: ReleaseInfo }
  | { status: 'available'; release: ReleaseInfo }
  | { status: 'error'; message: string }

interface GithubRelease {
  tag_name?: unknown
  html_url?: unknown
  draft?: unknown
  prerelease?: unknown
  name?: unknown
  published_at?: unknown
}

export interface CheckOptions {
  currentVersion: string
  /** `owner/name`。 */
  repo: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export async function checkForUpdate(options: CheckOptions): Promise<UpdateCheck> {
  const current = parseSemver(options.currentVersion)
  if (!current)
    return { status: 'error', message: `unrecognised current version "${options.currentVersion}"` }
  const doFetch = options.fetch ?? fetch
  let releases: unknown
  try {
    const res = await doFetch(`https://api.github.com/repos/${options.repo}/releases?per_page=20`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `dramai-desktop/${options.currentVersion}`,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    })
    if (!res.ok) return { status: 'error', message: `GitHub answered ${res.status}` }
    releases = await res.json()
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
  if (!Array.isArray(releases))
    return { status: 'error', message: 'unexpected response from GitHub' }

  // 用的是预发布版的人，也看预发布；用正式版的人只看正式版。
  const wantPrerelease = current.pre.length > 0
  const pagePrefix = `https://github.com/${options.repo}/releases/`
  let best: { release: ReleaseInfo; semver: Semver } | undefined
  for (const raw of releases as GithubRelease[]) {
    if (typeof raw.tag_name !== 'string' || typeof raw.html_url !== 'string') continue
    if (raw.draft === true) continue
    const semver = parseSemver(raw.tag_name)
    if (!semver) continue
    const prerelease = raw.prerelease === true || semver.pre.length > 0
    if (prerelease && !wantPrerelease) continue
    // 只接受指回本仓库发布页的链接，不信任接口里别的地址。
    if (!raw.html_url.startsWith(pagePrefix)) continue
    if (!best || compareSemver(semver, best.semver) > 0) {
      best = {
        semver,
        release: {
          version: raw.tag_name.replace(/^v/, ''),
          tag: raw.tag_name,
          url: raw.html_url,
          prerelease,
          name: typeof raw.name === 'string' ? raw.name : undefined,
          publishedAt: typeof raw.published_at === 'string' ? raw.published_at : undefined,
        },
      }
    }
  }
  if (best && compareSemver(best.semver, current) > 0)
    return { status: 'available', release: best.release }
  return { status: 'up-to-date', latest: best?.release }
}

/** 从 package.json 的 repository.url 取出 `owner/name`。 */
export function repoSlug(url: string | undefined): string | undefined {
  const m = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?\/?$/.exec(url ?? '')
  return m?.[1]
}
