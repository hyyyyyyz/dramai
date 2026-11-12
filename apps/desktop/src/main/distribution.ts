export type Distribution = 'source' | 'local' | 'package'

/**
 * How this copy of the app got here, from the `dramai.distribution` field the build bakes into package.json:
 * `local` = built and installed on this machine (pnpm desktop:install), `package` = a downloaded installer.
 * Anything unreadable counts as `package` (the safest wording for the update notice).
 */
export function readDistribution(readPackageJson: () => string): Distribution {
  try {
    const value = (JSON.parse(readPackageJson()) as { dramai?: { distribution?: unknown } }).dramai
      ?.distribution
    return value === 'local' ? 'local' : 'package'
  } catch {
    return 'package'
  }
}
