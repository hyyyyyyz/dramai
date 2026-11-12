# Releasing

All of dramai uses **one version number**; the rules for changing it are in [VERSIONING.md](VERSIONING.md).
When you push a tag such as `v0.5.0`, GitHub Actions checks the version, runs CI again, builds the desktop
installers on macOS (Apple Silicon and Intel), Windows and Linux, generates checksums, then creates a
GitHub Release and uploads everything. The installers are **not code-signed** (see "No secrets needed").
The other two desktop forms (run from source, build and install locally) do not go through this
pipeline.

> The workflows described here are in `.github/workflows/`. They only run once pushed to GitHub. Before
> the first real release, run the "dry run" below.

## Workflows at a glance

| File                  | When it runs                                                                                    | What it does                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`              | Pushes to `main` or `refactor/**`; every pull request; manually; called by the release workflow | See [CI.md](CI.md)                                                                                                                             |
| `release-desktop.yml` | Pushing a `v*.*.*` tag; manually (build only, no release)                                       | Check the tag → run CI → build installers on four platforms → checksums → create the Release                                                   |
| `deploy.yml`          | Manually only                                                                                   | The old Pages deployment, automatic runs disabled (reason in the file header); replaced by the landing page deployment once `apps/site` exists |
| `dependabot.yml`      | Weekly                                                                                          | Updates GitHub Actions (pinned to SHAs) and npm dependencies; new versions wait 7 days                                                         |

The shared composite step is in `.github/actions/setup/` (installs pnpm and Node, caches the pnpm store,
installs dependencies).

## Cutting a stable release

1. **Decide the version and update every package** (on a branch from the latest `main`). Look at the
   suggestion first, then bump by the rules:

   ```bash
   pnpm version:suggest       # suggests which part to bump from the commit types since the last version
   pnpm version:bump minor    # bumps every package.json together: patch / minor / major; --dry-run previews
   ```

2. **Write the changelog**: in `CHANGELOG.md`, turn what is under `[Unreleased]` into a section such as
   `## [0.5.0] - 2026-12-20`, and add the link
   `[0.5.0]: https://github.com/hyyyyyyz/dramai/releases/tag/v0.5.0` at the bottom. This section becomes the
   Release description as it is; **a version without this section cannot be released and the workflow
   fails**. When there are incompatible changes, add "Incompatible changes" and "Upgrade notes"
   sections.
3. **Commit and merge to `main`** through a pull request, once `CI passed` is green:
   `chore(release): v0.5.0`.
4. **Tag and push** (on the merged `main`):

   ```bash
   git switch main && git pull
   pnpm version:check --tag v0.5.0     # check locally first
   git tag v0.5.0
   git push origin v0.5.0
   ```

5. Watch **Actions → Release desktop**. When everything passes, the Release has the installers and
   `SHA256SUMS.txt`, and its description has the changelog, the fixed text about opening unsigned
   installers, and how to verify the download.

The commit a stable tag points at must be on `main`; otherwise the workflow fails and says so.

## Cutting a prerelease

A tag with a suffix is a prerelease. The Release is marked Pre-release and never becomes "Latest":

```bash
pnpm version:bump preminor              # 0.4.1 → 0.5.0-beta.1 (start a prerelease; --preid rc starts at rc.1)
# for each further trial version:
pnpm version:bump prerelease            # 0.5.0-beta.1 → 0.5.0-beta.2
pnpm version:bump prerelease --preid rc # 0.5.0-beta.2 → 0.5.0-rc.1
pnpm version:bump release               # 0.5.0-rc.1 → 0.5.0, when it is good

git commit -am "chore(release): v0.5.0-beta.1"
git tag v0.5.0-beta.1 && git push origin HEAD v0.5.0-beta.1
```

- A prerelease tag can be created from any branch (for example to try a release from the refactor
  branch); it does not need to be on `main`.
- A prerelease also needs a section such as `## [0.5.0-beta.1] - 2026-12-01` in `CHANGELOG.md`, or the
  release fails.

## Dry run (no Release is created)

**Actions → Release desktop → Run workflow**, picking the branch to try. It checks the versions, runs CI
and builds every platform; the installers stay under Artifacts at the bottom of the run page (kept for 7
days) and **no Release is created**. Run it before the first release and after changing the packaging
configuration.

## The fixed text in the Release description

A Release description is the matching `CHANGELOG.md` section + a fixed text + how to verify. The fixed
text explains how to open unsigned installers on macOS, Windows and Linux and that you must install
ffmpeg yourself. It lives in **`apps/desktop/release-notes-footer.md`** (maintained with the desktop app;
the verify job of the release workflow carries it into the release). If the file does not exist, a short
default text is used (English first, then Chinese) and the log shows a notice.

## Minimum steps to verify the release pipeline for the first time

A release publicly creates a Release on GitHub, so the repository owner has to agree before it is tried.
The smallest, cleanable way to do it:

1. Do a **dry run** first: Actions → Release desktop → Run workflow (pick the branch). It creates no Release
   and only checks that building and packaging work.
2. When the dry run passes, push a **prerelease** tag from the branch you want to verify, for example:

   ```bash
   pnpm version:bump preminor --preid rc && git commit -am "chore(release): v0.5.0-rc.1"
   git tag v0.5.0-rc.1 && git push origin HEAD v0.5.0-rc.1
   ```

   A prerelease does not need to be on `main` and never becomes "Latest"; add the matching section to the
   changelog first.

3. Check that the Release has the installers for four platforms and `SHA256SUMS.txt`, and download one to
   verify its checksum.
4. Clean up afterwards: `gh release delete v0.5.0-rc.1 --cleanup-tag --yes && git tag -d v0.5.0-rc.1`,
   then put the version and the changelog back (`git revert` the version commit, or
   `pnpm version:set <previous version>`). Note: this clean-up is only for trial versions nobody has used;
   a version number that anyone has used must not be reused, see VERSIONING.md.

## When something goes wrong

| Situation                                                                  | What to do                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Tag … is version X, but the repository is at Y"                           | The tag and the package versions disagree. Either run `pnpm version:set X`, commit and re-tag, or delete the tag and use `vY`                                                             |
| `… is at "0.4.1", expected "0.5.0"` (a package.json has the wrong version) | A package drifted. `pnpm version:set <version>` aligns all of them                                                                                                                        |
| The changelog section is missing                                           | Add `## [<version>]`, commit, and tag again                                                                                                                                               |
| The build fails (no Release exists yet)                                    | After fixing, "Re-run failed jobs" in Actions works for the same commit; for a different commit, delete the tag and tag again (below)                                                     |
| An upload fails halfway                                                    | The Release is a **draft**, so users cannot see it. Re-running the workflow refreshes the files in the draft and then publishes it                                                        |
| A published release turns out to have a problem                            | Turn it back into a draft so it cannot be downloaded: `gh release edit v0.5.0 --draft`. Fix it and publish a new patch version (`0.5.1`)                                                  |
| Withdraw a version completely                                              | `gh release delete v0.5.0 --cleanup-tag --yes` (also deletes the remote tag), then `git tag -d v0.5.0` locally. Do not reuse a version number anyone downloaded; release the next version |
| Delete a tag and redo it (never made public)                               | `git push --delete origin v0.5.0 && git tag -d v0.5.0`; after the fix, `git tag` and `git push` again                                                                                     |

The workflow never overwrites a published Release: re-running for an already published tag fails, so
withdraw it first as in the table.

## What to configure on GitHub

In the order of "worth doing"; everything here is optional hardening and releases work without it.

### Repository settings

1. **Actions → General → Workflow permissions**: keep the default "Read repository contents". Every
   workflow declares its own permissions, and only the release job asks for `contents: write`.
2. **Actions → General → Actions permissions**: if you choose "Allow select actions", allow GitHub's own
   actions, `pnpm/action-setup@*`, and any other action Dependabot brings in.
3. **Rules → Rulesets (or Branches)**: protect `main`: require pull requests and require the status check
   **`CI passed`**. It is the job in `ci.yml` that summarises all the others, so it is the only one you
   need to mark as required; skipped jobs (for example E2E before it is wired up) do not count as failures.
4. **Rules → Rulesets**: add a rule for tags `v*` that only lets maintainers create, update or delete them,
   so a version tag cannot be pushed by mistake or tampered with after release.
5. **Code security**: turn on Dependabot alerts and security updates; `.github/dependabot.yml` drives the
   version updates.
6. **Pages**: keep the source set to "GitHub Actions" (the old deployment uses it when run by hand; the
   landing page keeps using it once it exists).
7. (Optional) **Environments**: create a `release` environment with required reviewers, then add
   `environment: release` to the `release` job of `release-desktop.yml`, so a person has to confirm before
   anything is published.

### No secrets needed

Releasing needs no secrets and no variables: there is no signing and no notarization. The workflow only
uses the built-in `GITHUB_TOKEN`.

To add signing later, map electron-builder's `CSC_LINK` / `CSC_KEY_PASSWORD` (`WIN_CSC_LINK` /
`WIN_CSC_KEY_PASSWORD` for Windows, and `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` for macOS
notarization) from secrets into `env` in the "Package desktop app" step of `release-desktop.yml`; nothing else
has to change.

## The version tool

It lives in `tooling/release/` (`@dramai/release-tools`), has no dependencies and only uses Node's built-in
modules. The everyday commands are in
[VERSIONING.md, "Changing the version with the tool"](VERSIONING.md): `version:bump`, `version:set`,
`version:check` and `version:suggest`.

- It only changes the top-level `"version"` line in each `package.json` and leaves the rest of the file alone.
- The version format, "never go down", "never reuse an existing tag" and the other rules are all checked by
  the tool, which refuses and explains when something is off.
- The `checks` job of CI runs `version:check` every time; pull requests also check that the version is not
  lower than the target branch's and that the title follows Conventional Commits; the release workflow
  checks again with the tag and requires the changelog section.
- Everywhere else the version appears (the version shown in the UI, the system information API, the
  command line's `--version`, installer file names) must read it from `package.json` rather than keeping
  its own constant.

## Conventions and assumptions

The release workflow relies on what the desktop app delivers. The conventions agreed for it:

- `pnpm desktop:dist` packages the current system, with output in `apps/desktop/release/`, and does not
  publish by itself (the workflow provides no `GH_TOKEN`).
- Installers are named `dramai-<version>-<os>-<arch>.<extension>`, for example `dramai-0.5.0-mac-arm64.dmg`
  and `dramai-0.5.0-beta.1-win-x64.exe`. For now the `<os>` part accepts `mac|macos|darwin`, `win|windows` and
  `linux`, and the extension accepts `dmg zip exe msi AppImage deb rpm tar.gz`; files that do not match are not
  uploaded and the log shows a warning.
- There is no automatic update, so the `latest*.yml` files and `.blockmap` files used by auto-update are
  **not uploaded** for now (the two macOS architectures would produce a `latest-mac.yml` with the same name
  and the merge has to be decided first). Extend `tooling/release/src/assets.ts` and `release-desktop.yml`
  when auto-update is built.

## What the desktop build produces

`pnpm desktop:dist` builds the frontend and the app itself (so the release job does not run a separate full build)
and writes these files to `apps/desktop/release/`:

| System  | Files                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------- |
| macOS   | `dramai-<version>-mac-arm64.dmg` and `.zip`; `dramai-<version>-mac-x64.dmg` and `.zip` on Intel |
| Windows | `dramai-<version>-win-x64.exe` (installer) and `.zip` (portable)                                |
| Linux   | `dramai-<version>-linux-x64.AppImage` and `.tar.gz`                                             |

The release job collects exactly these (and fails if a system produced none); `.blockmap`, `builder-debug.yml`,
`latest*.yml` and unpacked folders are ignored, and `SHA256SUMS.txt` is computed over the collected files. macOS Intel
is built natively on a `macos-15-intel` runner, so no architecture flag is needed (cross-building it on an arm64
runner would need `--arch x64`). No signing variables are passed.

**Not known yet:** whether the Linux `tar.gz` target makes electron-builder download an extra tool, which would
slow the job or fail it on a restricted network. Nobody has run `desktop:dist` on Linux yet. The dry run (Actions →
Release desktop → Run workflow) builds every system, Linux included, without creating a Release, so it will show this
before any tag is pushed; read the Linux job's log for download lines the first time.

## End-to-end tests

The `E2E (browser)` job in `ci.yml` runs the Playwright specs in `packages/workspace/e2e` with
`pnpm e2e` (it builds the frontend first, then Playwright starts the demo server itself). They walk the whole
path in demo mode, so they need no secrets and cost nothing. The job installs ffmpeg (the render step uses it),
installs Playwright's Chromium with its system dependencies (the browser download is cached by lockfile hash),
and, when something fails, uploads `test-results/` (screenshots and traces) as the `e2e-report` artifact.
Details of the specs are in `packages/workspace/e2e/README.md`.
