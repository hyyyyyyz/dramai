# End-to-end tests (Playwright)

Real-browser tests that walk the whole path in **demo mode**: providers are the local mock services, so nothing is
charged, no API key is needed, and results are repeatable.

## Running

```bash
pnpm e2e                          # from the repo root; builds the frontend, starts the demo server, runs the specs
PW_CHANNEL=chrome pnpm e2e        # use an installed Chrome instead of Playwright's chromium
pnpm --filter @dramai/workspace exec playwright test -c e2e/playwright.config.ts failure   # only specs matching "failure"
```

First time on a new machine, **and after every Playwright upgrade** (a new lockfile version needs a new browser build):
`pnpm exec playwright install chromium` (add `--with-deps` on Linux CI). Without it every spec fails with
"Executable doesn't exist"; `pnpm e2e` now stops up front with a message saying so.

Playwright starts the server itself: `pnpm demo --fresh --port 4801 --mock-port 4802 --data-dir <tmp> --static-dir packages/workspace/dist`.
Override the ports with `E2E_PORT` / `E2E_MOCK_PORT`. The data directory is created fresh under the system temp dir on
every run.

## Coverage

| Spec             | What it covers                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `happy-path`     | Chinese. New project → upload text → plan episodes → break into shots → fill prompts → batch images → batch videos → compose (narration voice, render) → **download the cut** from the export page, without leaving the UI                                                                                                                         |
| `failure-resume` | Chinese. The upstream poll fails after submission: the shot card and the task panel both offer "resume the original task" and "regenerate (may charge again)"; once the upstream recovers, resuming completes the task                                                                                                                             |
| `english`        | English. Create project, upload, plan; compose blocks rendering while clips have no video and says transitions are hard cuts only; the material package is blocked with a way to fix it; delete → trash → restore; language and theme switch at once; no horizontal scroll at 375px in the light theme on every settings page and the project list |
| `keyboard`       | Keyboard only: pick a clip on the timeline, change its volume, close a dialog with Esc and get focus back on the trigger                                                                                                                                                                                                                           |

## Notes

- Specs run in order in a single worker (one server, one data directory). Each spec creates its own project, so they do
  not depend on each other.
- Elements are found by role and accessible name, never by CSS selector. The UI language is pinned through
  `localStorage['dramai.locale']` before the page loads.
- The mock provider control plane (`/__mock/config`, `/__mock/rules`, `/__mock/heal`) is wrapped in `helpers.ts`.
- On failure a screenshot and a trace are kept in `test-results/` (git-ignored): `pnpm exec playwright show-trace <trace.zip>`.

## What CI needs

- Node >= 22.22.2 and pnpm 9 (same as the repo); `pnpm install --frozen-lockfile`.
- `pnpm exec playwright install --with-deps chromium` (about 150 MB; cache `~/.cache/ms-playwright` keyed on the
  Playwright version).
- ffmpeg on the machine: the render step uses it (without it the compose page says what is missing and the specs fail).
- About 3 minutes for the whole suite (the happy path takes about 1.5 minutes). No network, no secrets.
- `.github/` is untouched. To wire it in, add a step running `pnpm e2e` and upload `packages/workspace/test-results/`
  on failure.
