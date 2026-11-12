# Changelog

All notable changes to dramai are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0-beta.1] - 2026-11-11

First beta of 0.5.0, a rewrite of dramai. It is **no longer a browser-only app**: the studio now runs
on a local server on your own machine, which is what removes the browser's limits (CORS, storage
quota, in-browser video encoding) and makes long-running work survive closing the tab.

**This is a beta. Everything in it was verified with automated tests and with the built-in mock
providers only. It has not been run against any real AI provider.** See "Known limitations".

### Incompatible changes

- **A local server is now required.** The workspace is no longer a static site that runs entirely in
  the browser. Start it from a checkout of the repository (`pnpm install`, `pnpm build`, `pnpm webui`)
  and open the printed address. Node.js 22.13 or newer is required, and the project now uses pnpm
  instead of npm.
- **Data from v0.4 does not appear automatically.** v0.4 kept projects in your browser's IndexedDB and
  provider settings in localStorage; the new version cannot read either. Before the old app goes away,
  open it and use Settings → export all as JSON. The new version imports that file in
  Settings → Data & backup.
- **GitHub Pages no longer serves a usable workspace.** The workspace cannot work without the local
  server, so the automatic Pages deployment has been turned off (it can only be run by hand), and a
  landing page will replace the app there in a later release. The last browser-only version is
  [v0.4.1](https://github.com/hyyyyyyz/dramai/releases/tag/v0.4.1).
- **API keys have moved.** They are no longer in the browser; the local server keeps them in
  `secrets.json` in the data directory (default `~/.dramai`), readable only by your operating system
  user and **not encrypted** in this beta. You need to enter your keys again.
- **Video composition uses the ffmpeg installed on your machine** instead of the in-browser
  ffmpeg.wasm. Install ffmpeg yourself; it is not bundled. Burned-in subtitles need an ffmpeg
  built with libass.
- **A different project structure.** A project is now project → episodes → scenes → shots, with a
  library of characters, locations, props and costumes that shots refer to, instead of one flat list
  of at most 12 shots.

### Upgrade notes

1. While you still can, open your existing v0.4 workspace and export a backup JSON; keep the file.
2. Install Node.js 22.13+, pnpm and ffmpeg, then run the steps above to start the server. Data lives
   in `~/.dramai` by default (`--data-dir` changes it).
3. Add your providers again in Settings → Providers and use "test connection".
4. To bring old projects over, open Settings → Data & backup → Import an old backup and choose the file
   (the API route is `POST /api/import/legacy`). Each old project becomes a new project with a single episode "第一集" and scene
   "导入的镜头"; the aspect ratio is set to 16:9 and narration to "added in post", because v0.4 had
   neither. Importing never changes existing projects, and importing the same old project twice is
   skipped unless you ask for it.

### Added

- **Local server** (`@dramai/server`, with the typed contract in `@dramai/api`): about 90 routes,
  live events over SSE, SQLite storage through Node's built-in `node:sqlite`, projects as folders
  on disk (images and videos are ordinary files), and a task queue that survives restarts. It only
  listens on `127.0.0.1` by default, checks the `Host` header, refuses cross-origin writes, locks
  the data directory so two instances cannot write at once, and refuses to listen on any other
  address without an access token.
- **`dramai` launcher** (`pnpm webui`): starts the server, serves the workspace and opens the
  browser. Options for port, host, data directory and token; `--version`; one-line startup errors.
- **A rewritten workspace** on top of the API, with Simplified Chinese, Traditional Chinese and English
  interfaces and light and dark themes: project list and creation, project overview, materials and
  episode planning with streamed output, a storyboard page grouped by scene, the asset library and
  asset detail pages, a confirmation page for candidates found in the text, a confirmation step before
  batch generation, and a task panel for queued, running and failed tasks. Pages load on demand, and
  non-default languages load only when chosen.
- **Compose and export pages**: a four-track timeline with a clip inspector, a list of issues that
  block rendering (each with an action that fixes it), a revision history you can roll back, narration
  voice generation, render options (subtitles soft, burned in or none), an in-browser preview, and an
  export page that shows whether each product is latest, out of date, missing or blocked and lets you
  download it. Transitions are hard cuts only, there is a single music track, and the preview leaves
  out subtitles, music, freeze frames and transitions.
- **Settings pages**: providers with connection tests, general (language, theme, default subtitles,
  optional currency conversion for cost estimates), access and security (shows whether a token is on
  and how to set it), data and backup (the data folder, importing v0.4 backups, and the trash), and
  about (version, runtime and what your ffmpeg can do).
- **Trash**: deleting a project moves it to the trash; it can be restored, or deleted for good, which
  removes its folder.
- **A story model that scales past one clip chain**: episodes, scenes and shots; characters,
  locations, props and costumes as reusable assets that shots reference; a style chosen at project
  creation (20 built-in style presets) and kept as a snapshot.
- **Generation pipeline**: storyboard breakdown, asset reference sheets, shot images generated from
  several reference images, and image-to-video. Every regeneration keeps the earlier versions
  instead of overwriting them. When something upstream changes, downstream results are marked
  outdated; nothing is regenerated automatically.
- **Checks before spending money**: shots that refer to an unregistered asset or one without a
  reference image are blocked, a batch either runs completely or not at all, a shot can have only
  one video task in flight, and a cost estimate is computed from the model's price table.
- **A task system built to avoid double charges**: separate lanes for text, image, video and audio
  work, classified failures, and recovery after a restart. A video task that already has an upstream
  task id resumes polling; one that does not is marked "submission unconfirmed" and is **never
  resubmitted automatically**. Cancelling only affects tasks that are still queued.
- **Provider protocols, run on the server so there is no CORS**: OpenAI-compatible chat, OpenAI
  Images, Gemini image, Alibaba DashScope video, Volcengine video, Kling video, a generic video
  protocol, and OpenAI-compatible text-to-speech. Adapters are pure functions that never touch the
  network, model capabilities and prices live in a data file, and a missing capability fails with
  an explanation instead of silently switching models. Prompts are data files too.
- **Composition and export on the server**: native ffmpeg rendering with
  the project's aspect ratio (9:16, 16:9 or 1:1), soft or burned-in subtitles, SRT and VTT, and an
  asset package (videos, images, subtitles and a manifest in a zip) for editing elsewhere. ffmpeg
  capabilities such as subtitle burn-in are detected rather than assumed.
- **Import of v0.4 backups**, from Settings → Data & backup or the API (see Upgrade notes).
- **Demo mode** (`pnpm demo`): a local mock of every provider type plus the server, with its own data
  directory (`~/.dramai-demo`). No account, no key and no cost; the generated content is
  placeholder content. Options simulate latency and failures.
- **Desktop app** (Electron, `apps/desktop`): the same local server and workspace in their own window,
  in three forms: run from source (`pnpm desktop:dev`), build and install on your own machine
  (`pnpm desktop:install`, `desktop:uninstall`; per-user, no administrator rights and no certificate
  needed) and installers built by the release workflow (`pnpm desktop:dist`: `.dmg` and `.zip` on macOS,
  `.exe` and `.zip` on Windows, `.AppImage` and `.tar.gz` on Linux). API keys are stored with the
  operating system's key store where one exists. The installers are **not signed** and there is no
  automatic update; the app only tells you when a newer release exists. ffmpeg is not bundled.
  **Where it has been run:** on macOS (Apple silicon) by hand. On Linux the app builds and the
  install, smoke-check and uninstall self-check passes in CI. On Windows it builds and installs and the
  installed app starts, but the post-install self-check does not fully pass yet and is being fixed.
  macOS Intel is built but has not been run, and nothing has been tried on a machine without an OS key
  store.
- **Browser end-to-end tests** (`pnpm e2e`, Playwright): they run in demo mode, so they cost nothing and
  need no key, and walk from creating a project to downloading the cut, resuming a failed upstream
  task, the English interface and keyboard-only use.
- **For contributors**: a pnpm monorepo (`apps/`, `packages/`, `tooling/`), shared TypeScript and ESLint
  configs, CI on Linux, macOS and Windows, one version number for every package with a tool to
  change it (`pnpm version:bump`), and the versioning rules in `docs/VERSIONING.md`.

### Changed

- The design system was redone (`@dramai/ui`): new brand marks, a light "storyboard paper" theme
  and a dark "editing room" theme, self-hosted fonts and a new set of components.
- Node.js engine range is now `>=22.13.0` (v0.4 refused Node 25).

### Removed

- The in-browser data layer (Dexie / IndexedDB), the in-browser ffmpeg.wasm, and the settings store
  that kept API keys in localStorage.

### In progress, not included in this version

Listed so nothing here is mistaken for finished work:

- Writing a real JianYing draft (today the export is an asset package).
- An npm package and a Docker image for the WebUI, and the landing page.

### Known limitations

- **No real provider has been used with this version.** Every check so far used automated tests and
  the mock providers. Request formats come from the providers' documentation and from what v0.4
  learned in May 2026.
- **The four presets are old data.** The DeepSeek, Seedream 5.0, Nano Banana and Wan2.2 Flash
  presets (the image and video ones reach their models through the 302.AI relay) carry model ids, endpoints and prices last checked in May
  2026; they may have changed. The other video models in the model data (Wan2.2 Plus, Wan2.5,
  Wan2.7, Seedance 2.0 Fast) are listed from documentation only, and details such as multi-image
  references and aspect ratios are marked unverified in the model data rather than assumed.
- **Cost figures are estimates** from those price tables. The README's per-drama cost (about ¥10
  versus ¥40–50) has still not been checked against a real run.
- **Character consistency is not proven.** The multi-reference approach is implemented but has not been
  compared with the old "locked reference image" on a real image service.
- Only run on macOS during development. The automated tests and the browser end-to-end tests are set up
  to run on Linux, macOS and Windows (end-to-end on Linux), but that has not been exercised yet.
- The end-to-end tests run against the mock providers only, so they prove the application flow, not
  that any real provider accepts the requests.
- Installers are unsigned: macOS and Windows warn on first launch (the release notes explain how to open
  them), and building locally with `pnpm desktop:install` avoids the warnings.

## [0.4.1] - 2026-05-04

Hot patch surfaced by a real test: 302.AI exposes Nano Banana
(gemini-2.5-flash-image) under Google's native generateContent
protocol, not the OpenAI Images API. The dramai text2image client
only spoke OpenAI Images, so calls returned `503 -10008 当前无可用
模型`.

### Added

- `ApiFlavor` enum gains `'gemini'`.
- `src/core/image/gemini-client.ts`: full
  `POST /v1beta/models/{model}:generateContent` client; sends both
  `Authorization: Bearer` and `x-goog-api-key` headers for
  cross-platform compatibility (302 / Google AI Studio / Vertex AI).
  Reference images via `inline_data` parts; decodes returned
  `inline_data` into Blobs (snake_case + camelCase tolerant).
- `src/core/image/factory.ts`: dispatches on `Provider.apiFlavor`.
- `ProviderForm` now exposes the API-flavor selector for `text2image`
  too. Per-kind filtering keeps the menu short.
- `PROVIDER_PRESETS` adds 302.AI presets for Nano Banana (Gemini),
  Flux + GPT Image 1 (OpenAI-compat), Kling (native) + generic i2v
  fallback. Each preset can pin its `apiFlavor` and the form
  auto-applies on click.
- Preset notes call out the gotcha: Gemini-flavor base URL must NOT
  include `/v1` — the protocol path is `/v1beta/models/...`.

### Changed

- `src/core/pipeline/image-shot.ts` switched from the OpenAI-compat
  client to the new factory.

## [0.4.0] - 2026-05-04

End-to-end pipeline closed: storyboard → image → video → composed cut +
subtitles + 剪映/CapCut draft package. Browser-side, no backend.

### Added (v0.2 → v0.4 condensed)

**v0.2 — Character cards + text-to-image**

- Character CRUD with per-character reference image binding and a
  `locked` toggle. Locked characters' reference Blobs are forwarded as
  `image` / `image_url` / `reference_images` fields when generating
  that shot's frame, giving the model a consistency hint across
  providers (OpenAI Images, Flux, Nano Banana, SDXL, etc.).
- OpenAI-compatible `/v1/images/generations` client with `b64_json`
  response default + URL fallback download.
- Per-shot and batch "generate image" buttons with abort, inline
  error surfacing, and live thumbnails in the storyboard list.

**v0.3 — Image-to-video + camera movement**

- `Provider.apiFlavor` selector ('openai-compatible' | 'kling' |
  'runway') exposed in Settings for image2video providers.
- Two-protocol video stack: full Kling submit/poll
  (`/v1/videos/image2video`), plus a generic OpenAI-compatible path
  (`/videos/generations`) with multi-field task-id and video-url
  extraction. Runway falls back to the generic path until its native
  client lands.
- 11 `CameraMovement` types (static / pan / tilt / zoom / orbit /
  dolly) × 3 speeds; per-shot inline select; mapped to English
  instructions injected into the video prompt.
- Storyboard rows now play the generated mp4 inline; per-shot and
  batch "generate video" buttons with abort and 10-min timeout.
- Async task handle persisted on the Storyboard row so a refresh
  doesn't lose the in-flight task (resume UI lands later).

**v0.4 — Composition + subtitles + 剪映/CapCut export**

- FFmpeg.wasm single-thread loader as a dynamic import; ~30MB core is
  fetched from jsdelivr only on the first compose click. GitHub Pages
  doesn't allow COOP/COEP so we deliberately use the single-thread
  build (slower, but works everywhere).
- `concatVideos`: per-clip transcode to a uniform H.264 / 720p / 24
  fps with letterbox padding, then concat-demuxer + copy. The composed
  mp4 is persisted as a project asset; "重新合成" cleans up the old
  one.
- SRT and VTT exporters: time axis built from each shot's
  `durationSec`, sourced from the LLM-emitted `narration`.
- 剪映/CapCut draft package (alpha): a single ZIP with `assets/`
  (per-shot mp4 / image), `subtitles.srt`, `manifest.json`, and a
  plain README guiding manual import. Direct .draft_content support is
  on the v0.5+ list.

### Changed

- `Provider` schema gains optional `apiFlavor`.
- `Storyboard` schema gains optional `cameraParams` and
  `pendingVideoTask`. No DB version bump needed (both are optional
  fields on existing index spec).
- Initial JS bundle 685 kB / 219 kB gzip (FFmpeg + jszip lazy
  chunked).

## [0.1.0] - 2026-05-04

The first usable end-to-end milestone: drop in your raw material, write
a one-line prompt, and get a structured storyboard generated by your
own OpenAI-compatible LLM — all in the browser.

### Added

- **Provider settings.** Add / edit / delete OpenAI-compatible
  providers grouped by kind (LLM / Text2Image / Image2Video / ImageEdit).
  Six one-click presets (OpenRouter, 302.AI, ciyuan, OpenAI, image
  variants). Test-connection probe with last-verified timestamp.
- **Project CRUD on IndexedDB.** Live-query list and detail pages;
  cascade delete also drops materials, storyboards, characters, assets,
  and generations.
- **Material upload.** Drag-and-drop or file picker for `.docx` /
  `.txt` / `.md` / images; per-file 20 MB cap, mammoth dynamically
  imported only when a docx actually arrives. Image previews via cached
  `URL.createObjectURL`.
- **Storyboard pipeline.** Streaming OpenAI-compatible chat completions
  (custom SSE parser handling `\n\n` / `\r\n\r\n`, multi-line `data:`
  fields, `[DONE]`, comments, tail residue). Pipeline emits
  starting / streaming / parsing / persisting / done / error events,
  abortable mid-flight. Fault-tolerant JSON parse handles `\`\`\`fence`
  wrapping and outermost-braces extraction. Character-name → id mapping
  on persist.
- **Storyboard list UI.** Live updates via dexie-react-hooks
  `useLiveQuery`; per-shot delete; status badge; image-prompt and
  duration display.
- **Backup / restore.** Export the entire local database (including
  Blob assets serialized as base64) into a single JSON, and import in
  either `merge` (id-keyed upsert) or `replace` (clear-then-write) mode.
- **i18n.** Initial Chinese / English translations for the
  marketing-facing pages (Home, About, NotFound) and chrome (header,
  footer). Locale switcher persists to `localStorage`.
- **shadcn-style design system.** Button / Card / Badge / Input /
  Textarea / Label / Select / Modal primitives, Tailwind v4 with OKLCH
  dark theme, custom GithubIcon (lucide 1.x dropped brand icons).
- **Routing & layout.** React Router v7 with `basename` derived from
  Vite `BASE_URL`, sticky header with nav, footer, brand mark.
- **Resilience fixes.** SSE parser now `await reader.cancel()` on
  consumer break to release the underlying response body. CI uses
  `npm install --prefer-offline --no-audit --no-fund` so the
  intermittent npm 11 lock-completeness drift around `@emnapi/*` no
  longer kills the workflow.

### Changed

- Node target moved to 24 in `.nvmrc` to match the local development
  environment; `engines.node` widened to `>=20.0.0 <25.0.0`.
- `vite.config.ts` enables `@tailwindcss/vite` and the `@/*` path alias.
- Bundle split: mammoth lazy-loaded into its own chunk so the initial
  download stays under 500 kB / 154 kB gzip.

## [0.0.1] - 2026-05-04

### Added

- Initial Vite + React 19 + TypeScript 6 project skeleton.
- Path alias `@/*` → `src/*`.
- Apache 2.0 license, NOTICE, README (中/EN), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.
- GitHub Actions CI workflow (lint, typecheck, build).
- GitHub Actions deploy workflow → GitHub Pages.
- Issue templates (bug / feature) and PR template.
- `vite.config.ts` configured with `base = "/dramai/"` for GitHub Pages.
- Initial documentation: ARCHITECTURE.md, DEPLOYMENT.md, PROVIDERS.md, ROADMAP.md.

[Unreleased]: https://github.com/hyyyyyyz/dramai/compare/v0.5.0-beta.1...HEAD
[0.5.0-beta.1]: https://github.com/hyyyyyyz/dramai/releases/tag/v0.5.0-beta.1
[0.4.1]: https://github.com/hyyyyyyz/dramai/releases/tag/v0.4.1
[0.4.0]: https://github.com/hyyyyyyz/dramai/releases/tag/v0.4.0
[0.1.0]: https://github.com/hyyyyyyz/dramai/releases/tag/v0.1.0
[0.0.1]: https://github.com/hyyyyyyz/dramai/releases/tag/v0.0.1
