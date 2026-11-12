# CI

The workflows live in `.github/workflows/`. See [RELEASING.md](RELEASING.md) for how to cut a release.

## Workflows

| Workflow              | When it runs                                                                                     | What it does                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`              | Pushes to `main` or `refactor/**`; every pull request; manually; called by `release-desktop.yml` | Everyday checks, see below                                                                                                                                       |
| `release-desktop.yml` | Pushing a `v*.*.*` tag; manually (dry run, no release)                                           | Builds installers on each system and creates a GitHub Release                                                                                                    |
| `deploy.yml`          | Manually only                                                                                    | The old Pages deployment. Automatic runs are off because the old workspace cannot run without the local server; it will be replaced once the landing page exists |

Dependabot (`.github/dependabot.yml`) opens weekly update pull requests for GitHub Actions and npm
dependencies.

## Jobs in ci.yml

| Job                     | What it does                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, lint, typecheck | Every package is at the same valid version (`pnpm version:check`), `pnpm format:check`, `pnpm lint`, `pnpm typecheck` (Linux). On pull requests it also checks that the version is not lower than the target branch's and that the PR title follows Conventional Commits (commits inside the branch only warn). Rules: [VERSIONING.md](VERSIONING.md) |
| Test                    | `pnpm test` on Linux (Node 24 and 22.13), macOS (arm64) and Windows. The job installs ffmpeg itself; on Linux the build must have libass so the subtitle burn-in test really runs                                                                                                                                                                     |
| Build                   | `pnpm build`                                                                                                                                                                                                                                                                                                                                          |
| Desktop                 | `pnpm desktop:build` on Linux, macOS and Windows; and, once `pnpm desktop:check-install` exists, an unattended install, verify and uninstall. Both skip with a notice while the root scripts are missing                                                                                                                                              |
| Lint workflows          | actionlint checks the syntax, expressions and inline shell in `.github/workflows/`                                                                                                                                                                                                                                                                    |
| E2E (browser)           | `pnpm e2e`: Playwright specs in demo mode (installs ffmpeg and Chromium; uploads `test-results/` as an artifact on failure)                                                                                                                                                                                                                           |
| CI passed               | Summarises all the jobs above. Branch protection only needs this one as a required check; skipped jobs do not count as failures                                                                                                                                                                                                                       |

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
4. Vitest output is in the `Test` step. When E2E fails, the report is an artifact (`e2e-report`) at the
   bottom of the run page.
5. A failure with no code change is most often an external service (apt, Homebrew or Chocolatey
   downloads) or a runner image update; re-run once and read the log if it keeps failing. Actions are
   pinned to commit SHAs, so they cannot change under you.
