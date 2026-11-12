# Versioning

Versions have three parts: `MAJOR.MINOR.PATCH`, for example `0.5.2`. **Every package in the repository
shares one version number**; no package is versioned on its own. The current version is in the root
`package.json`.

## Which part to bump

| Bump                                                        | When                                                                                                                                                                                   | Examples                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Patch** (third part) `0.5.1 → 0.5.2`                      | Only fixes problems or makes small improvements that do not change how things are used. Upgrading changes nothing else, and you can go back to the previous patch release at any time  | Bug fixes; updated model names, prices or capability data in provider presets; small prompt rewording; copy and translation fixes; UI polish; performance work; security updates of dependencies                                                         |
| **Minor** (second part) `0.5.2 → 0.6.0`, patch reset to 0   | Adds a feature, or changes a data format in a way that upgrades automatically. Old projects keep working after the upgrade, but upgraded data cannot be taken back to an older version | A new page or workflow step; a new provider protocol; a new export format; a new command-line option; a new field or route in the API; a data directory layout change with an automatic migration                                                        |
| **Major** (first part) `0.6.0 → 1.0.0`, last two reset to 0 | An incompatible change: users must do something by hand to keep going, or something that used to work no longer does                                                                   | Old projects cannot be upgraded automatically and must be exported and imported by hand; an existing API route or command-line option is removed or changed; a supported operating system is dropped; the minimum Node.js version is raised incompatibly |

- Commits that only touch **documentation, tests, CI or internal refactoring** do not trigger a release
  by themselves; they ship with the next release. If a release contains only such changes, bump the
  patch version.
- When a release contains **several kinds of change**, bump the highest level among them. The version is
  changed when a release is cut, not in every commit.

## Before 1.0.0

A major version of `0` means the product has not promised stability yet. While that holds:

- Incompatible changes bump the **minor** version, not the major one. The changelog must have a separate
  "Incompatible changes" section that says what users have to do.
- New features also bump the minor version; fixes bump the patch version. In other words, only the last
  two parts are used before 1.0.0.

Conditions for 1.0.0: all three desktop forms and the WebUI are verified on all three operating
systems; the whole workflow has been run with real providers; and we are willing to promise that from
then on data formats only change in ways that upgrade automatically. This is why the version tool
refuses to go from `0.x` to `1.0.0` casually: it needs an explicit confirmation (see below).

## Prereleases

A version given to people to try out before the stable release carries a suffix. Only these two forms
are allowed, and the number starts at 1:

- `0.5.0-beta.1`, `0.5.0-beta.2`: the features are mostly there, there may still be problems.
- `0.5.0-rc.1`: a release candidate; if no problem turns up it becomes `0.5.0` unchanged.

The order is `beta` → `rc` → stable, and you cannot go back. Prereleases are marked as prereleases on
GitHub and are never treated as the latest stable release. Other suffixes (such as `-alpha.1`) and build
metadata (such as `+build.5`) are not accepted.

## Commit messages and versions

The repository uses [Conventional Commits](https://www.conventionalcommits.org/). When a release is cut,
the commit types tell you which part to bump:

| Commit type                                                        | Maps to                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `fix:`, `perf:`                                                    | Patch                                                                           |
| `feat:`                                                            | Minor                                                                           |
| A `!` after the type, or `BREAKING CHANGE:` in the body            | Major (minor before 1.0.0, and add an "Incompatible changes" changelog section) |
| `docs:`, `test:`, `ci:`, `chore:`, `refactor:`, `style:`, `build:` | No release by themselves                                                        |

`pnpm version:suggest` reads the commits since the last version tag and suggests which part to bump. It
is only a suggestion; whoever cuts the release decides.

## Tags and published versions

- A tag is `v` plus the version: `v0.5.0`, `v0.5.0-beta.1`. **The tag must match the version in the
  repository**; the release workflow checks it.
- **A published version number is never reused and never changed.** If a published version has a problem,
  ship a new patch release to fix it; do not move or delete the old tag. The version tool refuses to use
  a version whose tag already exists.
- Versions only go up: the new version must be higher than the current one
  (`0.5.0-beta.2` < `0.5.0-rc.1` < `0.5.0`).

## Changelog

Every version has a section in `CHANGELOG.md`, for example `## [0.5.0] - 2026-12-20`, with Added, Changed
and Fixed parts. When there are incompatible changes, add "Incompatible changes" and "Upgrade notes"
sections. **Prereleases are no different: a version without its changelog section cannot be released**;
the release workflow fails when the section is missing.

## Where the version appears

The app's "About" page, the system information API, the command line's `--version`, and the installer
file names all take the version from the **same source**: the `version` field of the package's
`package.json`. Do not write another copy of the version as a constant in code.

A data format's version is a separate thing from the app version: data documents carry their own
`schemaVersion`, and the API contract has its own error code table. When either changes, bump at least
the minor version of the app.

## Changing the version with the tool

The tool lives in `tooling/release/`; run it from the repository root. Every command changes all the
`package.json` files at once, touching only the `version` line, and `--dry-run` previews without writing.

```bash
pnpm version:bump patch        # 0.5.1 → 0.5.2
pnpm version:bump minor        # 0.5.2 → 0.6.0 (patch reset to 0)
pnpm version:bump major        # 1.2.3 → 2.0.0 (last two reset to 0); refused on 0.x, see below
pnpm version:bump major --confirm-1.0   # 0.x → 1.0.0, only with explicit confirmation

pnpm version:bump preminor     # 0.5.2 → 0.6.0-beta.1, start a prerelease (prepatch / premajor likewise)
pnpm version:bump preminor --preid rc   # start directly at rc.1
pnpm version:bump prerelease   # 0.6.0-beta.1 → 0.6.0-beta.2, next number
pnpm version:bump prerelease --preid rc # 0.6.0-beta.2 → 0.6.0-rc.1, move from beta to rc
pnpm version:bump release      # 0.6.0-rc.1 → 0.6.0, promote a prerelease

pnpm version:set 0.6.0         # set it directly; the same rules apply
pnpm version:check             # every package is at the same, valid version
pnpm version:suggest           # suggest which part to bump from the commit types
```

The tool refuses, and explains why, when: the version is malformed (missing parts, `-alpha`, a number that
starts at 0, and so on); the new version is lower than the current one; the tag for that version already
exists; `patch`/`minor`/`major` is used on a prerelease (ambiguous, use `release` or `prerelease`);
`prerelease`/`release` is used on a stable version; going from `rc` back to `beta`; or going from `0.x`
straight to a new major version without confirmation.

## Automatic checks

| Check                                                                                                         | Where            |
| ------------------------------------------------------------------------------------------------------------- | ---------------- |
| All packages are at the same version and the version follows the rules (`pnpm version:check`)                 | Every CI run     |
| A pull request's version is not lower than the target branch's                                                | Pull request CI  |
| A pull request's title follows Conventional Commits (commits inside the branch only produce warnings)         | Pull request CI  |
| The tag matches the repository version, `CHANGELOG.md` has a section for it, a prerelease suffix → prerelease | Release workflow |

See [RELEASING.md](RELEASING.md) for the full release steps.
