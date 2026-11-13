# CI

The workflows live in `.github/workflows/`. See [RELEASING.md](RELEASING.md) for how to cut a release.

## Workflows

| Workflow              | When it runs                                                                                     | What it does                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`              | Pushes to `main` or `refactor/**`; every pull request; manually; called by `release-desktop.yml` | Everyday checks, see below                                                                                                   |
| `release-desktop.yml` | Pushing a `v*.*.*` tag; manually (dry run, no release)                                           | Builds installers on each system and creates a GitHub Release                                                                |
| `deploy-site.yml`     | Manually only (an automatic trigger for changes under `apps/site` is written and commented out)  | Builds `apps/site`, runs its tests and post-build checks, and deploys it to GitHub Pages. See [DEPLOYMENT.md](DEPLOYMENT.md) |

Dependabot (`.github/dependabot.yml`) opens weekly update pull requests for GitHub Actions and npm
dependencies.

## Jobs in ci.yml

| Job                     | What it does                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format, lint, typecheck | Every package is at the same valid version (`pnpm version:check`), `pnpm format:check`, `pnpm lint`, `pnpm typecheck` (Linux). On pull requests it also checks that the version is not lower than the target branch's and that the PR title follows Conventional Commits (commits inside the branch only warn). Rules: [VERSIONING.md](VERSIONING.md)                                |
| Test                    | `pnpm test` on Linux (Node 24 and 22.22.2, the minimum supported version), macOS (arm64) and Windows. It runs **every** package's tests even when one fails and then lists the failing packages in the job summary, so one run shows the whole picture per system. The job installs ffmpeg itself; on Linux the build must have libass so the subtitle burn-in test really runs      |
| Build                   | `pnpm build`                                                                                                                                                                                                                                                                                                                                                                         |
| Desktop                 | `pnpm desktop:build` (builds the frontend, bundles the app and runs electron-builder into `apps/desktop/release/`), then `pnpm desktop:check-install --skip-build` (an unattended install into a temporary folder, a smoke check of the installed app, uninstall, and purging the data), on Linux, macOS and Windows. Electron and electron-builder downloads are cached (see below) |
| Lint workflows          | actionlint checks the syntax, expressions and inline shell in `.github/workflows/`                                                                                                                                                                                                                                                                                                   |
| E2E (browser)           | `pnpm e2e`: Playwright specs in demo mode (installs ffmpeg and Chromium; uploads `test-results/` as an artifact on failure)                                                                                                                                                                                                                                                          |
| CI passed               | Summarises all the jobs above in a table. Branch protection only needs this one as a required check; skipped jobs do not count as failures, but anything that did not actually run is listed under "Not run" in the summary                                                                                                                                                          |

When a branch or pull request gets a new commit, the older run is cancelled (never on `main`).

## When a run fails

1. Open the pull request's Checks tab, or the repository's **Actions** page, find the red job and expand
   the failing step.
2. The same commands run locally. Reproduce from the repository root first:

   | Failing step                                          | Local command                                                                                                                                                                            |
   | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Check package versions / the version does not go down | `pnpm version:check`; if packages disagree, `pnpm version:set <version>`; if the version was lowered, put it back                                                                        |
   | Check Conventional Commits                            | Rename the PR to `<type>(<scope>): <description>` (types in [VERSIONING.md](VERSIONING.md)). Local check: `node tooling/release/src/cli.ts commits --base origin/main --title "<title>"` |
   | Format check                                          | `pnpm format:check`; fix automatically with `pnpm format`                                                                                                                                |
   | Lint / Typecheck                                      | `pnpm lint` (`pnpm lint:fix`), `pnpm typecheck`                                                                                                                                          |
   | Test                                                  | `pnpm test`; a single package: `pnpm --filter <package> test`                                                                                                                            |
   | Build desktop app                                     | `pnpm desktop:build`                                                                                                                                                                     |
   | Lint workflows                                        | Install [actionlint](https://github.com/rhysd/actionlint) and run `actionlint` in the repository root                                                                                    |

3. **A failure on one operating system only** (say, only Windows is red): the job name contains the
   system. Usual causes are path separators, line endings (the repository forces LF through
   `.gitattributes`), files held open, and differences between ffmpeg builds. The Homebrew ffmpeg on
   macOS and the Chocolatey one on Windows may lack libass; there the subtitle burn-in test falls back to
   the capability-error check (a warning appears in the log). On Linux libass is required.
4. A failing `Test` job's summary lists the failing packages; the Vitest output of each is in the `Test` step. Locally `pnpm test` behaves the same way (it runs all packages, then prints `Summary: N fails, M passes`). When E2E fails, the report is an artifact (`e2e-report`) at the
   bottom of the run page.
5. **A green job is not always a job that ran.** Open the run's summary page: jobs that cannot run yet (for example the desktop steps before the root `desktop:*` scripts exist) are marked NOT RUN there and in the `CI passed` table.
6. A failure with no code change is most often an external service (apt, Homebrew or Chocolatey
   downloads) or a runner image update; re-run once and read the log if it keeps failing. Actions are
   pinned to commit SHAs, so they cannot change under you.

## Reading the desktop install self-check

`pnpm desktop:check-install` prints one line per step, each starting with `✓` or `✗`:

1. `install` / `app installed`: the app was installed into a temporary home (nothing outside that folder is touched).
2. The smoke check starts the installed app and drives it over Chromium's remote debugging port. It checks that the
   server is healthy, the first screen renders, the security boundaries hold (no token or a wrong token gives 401, a
   forged `Host` gives 403, the page cannot reach Node), and that the app **exits cleanly on SIGTERM and releases the
   data directory lock**. A failure ends with `SMOKE FAILED` and the tail of the app's output, which is where to look first.
3. `uninstall` / `app removed` / `user data kept by default`: uninstalling removes the app but keeps projects and keys.
4. `--purge-data` refuses without `--yes` and deletes the data with it.

The run ends with `SELFTEST FAILED` if any `✗` appeared. On Linux the script re-runs itself under `xvfb-run` when there
is no display and adds `--no-sandbox` when the runner blocks unprivileged user namespaces; a note says so in the log.
Locally, run `pnpm desktop:build` first and then `pnpm desktop:check-install --skip-build`.

## Download caches

The desktop jobs set `ELECTRON_CACHE` and `ELECTRON_BUILDER_CACHE` to `electron-cache` and `electron-builder-cache`
inside the runner's temp directory (before dependencies are installed, because Electron's postinstall downloads its
binary there) and cache both with `actions/cache`, keyed on the OS, architecture and `pnpm-lock.yaml`. Without the
variables the defaults would be `~/Library/Caches/electron` and `~/Library/Caches/electron-builder` (macOS),
`~/.cache/electron` and `~/.cache/electron-builder` (Linux), and `%LOCALAPPDATA%\electron\Cache` and
`%LOCALAPPDATA%\electron-builder\Cache` (Windows).
