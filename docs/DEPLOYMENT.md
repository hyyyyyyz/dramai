# Deployment

dramai is an application you run on your own computer, so there is nothing to host for it. What is deployed is the
**landing page** (`apps/site`), a static Astro site published to GitHub Pages at
`https://hyyyyyyz.github.io/dramai/`: Chinese at `/dramai/`, English at `/dramai/en/`.

| What                        | Where it lives                       | How people get it                                                                                                                                                                 |
| --------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The app (WebUI and desktop) | Your computer                        | Run from a checkout, build and install locally, or download an installer from a release. See the [README](../README.md) and [`apps/desktop/README.md`](../apps/desktop/README.md) |
| The landing page            | GitHub Pages, built from `apps/site` | Visit the site                                                                                                                                                                    |

GitHub Pages cannot run the app: it needs the local server (`@dramai/server`) behind it. The previous browser-only
version (v0.4.1) is no longer published on Pages and is not kept anywhere on the site.

## Deploying the landing page

The workflow is `.github/workflows/deploy-site.yml` ("Deploy site to GitHub Pages"). It runs in two jobs:

1. **Build and check**: `pnpm build:site` builds `apps/site` into `apps/site/dist`, then `pnpm --filter @dramai/site test`
   runs the unit tests and the post-build checks in `apps/site/scripts/check-dist.mjs`: every internal link and anchor
   resolves, both languages have the same sections and amount of content, nothing in the output requests a third-party
   host, and hreflang, canonical, Open Graph and the sitemap are consistent. If any of this fails, nothing is deployed.
   The checked output is uploaded as the Pages artifact.
2. **Deploy**: publishes the artifact with `actions/deploy-pages`. Only this job has `pages: write` and `id-token: write`;
   the rest of the workflow has read-only access.

Actions are pinned to commit SHAs, like every other workflow in the repository (Dependabot keeps them current).

### One-time repository setup

1. **Settings → Pages → Build and deployment → Source** must be **GitHub Actions** (it already is if Pages was used
   before; no other Pages setting is needed).
2. **Settings → Environments → github-pages**: by default only the default branch may deploy to this environment. Run the
   workflow from `main`, or add the branch you want under "Deployment branches and tags".

### Deploying

The workflow is manual for now: **Actions → Deploy site to GitHub Pages → Run workflow**, choosing `main`. The first
deployment **replaces whatever Pages serves today**, which at the time of writing is the old v0.4.1 workspace.

To deploy automatically whenever `apps/site` changes on `main`, uncomment the `push:` block at the top of the workflow
(it is written and commented out); keep `workflow_dispatch` so a deployment can still be re-run by hand.

### What visitors see after the switch

- `/dramai/` and `/dramai/en/` are the landing page.
- Links into the old app (`/dramai/projects`, `/dramai/settings`, and so on) land on the landing page's own 404 page;
  there is no redirect and no copy of the old app.
- Data that someone's browser stored for v0.4.1 stays in that browser but nothing on the site can open it any more.
  Anyone who still needs it can run v0.4.1 from the `v0.4.1` tag and export a backup; the 0.5.0 app imports those backups
  (Settings → Data & backup).

### Checking a deployment

Open `https://hyyyyyyz.github.io/dramai/` and `https://hyyyyyyz.github.io/dramai/en/`, check that the page shows the
current version, that the language switch works, and that an unknown path such as `/dramai/nope/` shows the 404 page.

### Rolling back

Run the workflow again from an earlier commit or tag of `apps/site` (choose it under "Use workflow from"). There is no
previous artifact to restore: each deployment is built from the ref you pick.

### Custom domain

If the site moves to its own domain, put the domain in `apps/site/public/CNAME`, set it under Settings → Pages, and change
`site` and `base` in `apps/site/astro.config.mjs` (`base: '/'` for a root domain). The post-build check assumes the current
origin and base, so update `scripts/check-dist.mjs` as well.
