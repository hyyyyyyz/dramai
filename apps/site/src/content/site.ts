import pkg from '../../package.json'

/** The repo-wide version, read from this package, which `pnpm version:bump` keeps in step with the rest. */
export const VERSION: string = pkg.version

/**
 * The newest version that is published on GitHub Releases (the installers on the page). It stays behind
 * VERSION while the repository moves on, and it is the version the installer file names carry.
 * Change it when a new release is published; tests/facts.test.mjs checks that the changelog has it.
 */
export const PUBLISHED_VERSION = '0.5.0-beta.1'

export const REPO = 'https://github.com/hyyyyyyz/dramai'
export const RELEASES = `${REPO}/releases`
export const RELEASE_TAG = `${REPO}/releases/tag/v${PUBLISHED_VERSION}`
export const ISSUES = `${REPO}/issues`

export const SITE_ORIGIN = 'https://hyyyyyyz.github.io'

/** `import.meta.env.BASE_URL` without trailing slash, e.g. "/dramai". */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

/** Absolute (host-relative) URL for a path inside the site: url('en/') -> "/dramai/en/". */
export function url(path = ''): string {
  return `${BASE}/${path.replace(/^\//, '')}`
}

export function absoluteUrl(path = ''): string {
  return `${SITE_ORIGIN}${url(path)}`
}

/** Replace {version} in release file name patterns. */
export function fileName(pattern: string): string {
  return pattern.replace('{version}', PUBLISHED_VERSION)
}
