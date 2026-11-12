<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./packages/ui/src/brand/banner-ink.svg" />
  <img src="./packages/ui/src/brand/banner-paper.svg" alt="dramai, an open-source AI short-drama studio that runs on your own computer" width="720" />
</picture>

**English** · [简体中文](./README_CN.md)

[![License](https://img.shields.io/github/license/hyyyyyyz/dramai?color=DF500C)](./LICENSE) [![Version](https://img.shields.io/github/package-json/v/hyyyyyyz/dramai?color=DF500C&label=version)](./CHANGELOG.md)

</div>

dramai is an open-source AI short-drama studio that runs on your own computer. Give it a novel or a script and it plans episodes, scenes and shots, generates images and video through the AI providers you choose, and composes a finished cut with narration and subtitles.

It is for people who make serialised short dramas and want to keep control of the work. Projects are ordinary folders on your disk, API keys stay on your machine, and nothing passes through a service we run.

> [!IMPORTANT]
> **This is `0.5.0-beta.1`, a beta.** It has been verified with automated tests and built-in mock providers only, and has **not yet been run against a real AI provider**. The desktop app has only been run on macOS. No release is published yet: there are no installers, npm package or Docker image to download. See [Status](#status).

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/en/storyboard-dark.webp" />
    <img src="./docs/assets/readme/en/storyboard-light.webp" alt="The storyboard page: shots grouped by scene, each with its image, video, narration, prompt and the assets it uses" width="100%" />
  </picture>
  <br />
  <sub>The storyboard of a small demo project. The pictures are placeholder sketches made by demo mode, not generated art.</sub>
</p>

## Try it in a minute, with no API key

Demo mode runs the whole studio against simulated providers on your machine: no account, no key, no cost. What it generates is placeholder content: storyboard-style sketches of a figure in a frame, marked DEMO, and short clips built from them. It shows how the workflow behaves, not what real models produce.

You need [Node.js](https://nodejs.org) 22.22.2 or newer, [pnpm](https://pnpm.io) 9 and [ffmpeg](https://ffmpeg.org) on your `PATH`.

```bash
git clone https://github.com/hyyyyyyz/dramai.git
cd dramai
pnpm install
pnpm build
pnpm demo
```

Open <http://127.0.0.1:8787>. Create a project, upload a short story, plan episodes, break them into shots, confirm the characters and locations, then generate images and video and compose the cut. The simulated language model only understands Chinese text, so use a Chinese story. Demo data lives in `~/.dramai-demo`, separate from your real data; add `--fresh` to start over.

## What is different

- **Local, with your keys.** A server on `127.0.0.1` does all the work. Projects are folders of ordinary files plus a SQLite database. Provider requests are made by that server, so there is no CORS limit and no relay in between.
- **Long texts and serials.** A project holds episodes, episodes hold scenes, scenes hold shots. Long texts are split into episodes by chapter.
- **A reusable library.** Characters, locations, props and costumes are assets that shots refer to. Each asset has one reference sheet that every shot using it is generated from. The visual style is chosen once, when the project is created.
- **Checks before paid generation.** Shots that refer to an unregistered asset, or one without a reference image, are blocked. A batch runs completely or not at all, a shot has at most one video task in flight, and a cost estimate from the model's price table is shown before you confirm.
- **A task queue that survives restarts.** Closing the browser does not stop work. After a restart, a video task that has an upstream task id resumes polling. One without it is marked "submission unconfirmed" and is never resubmitted automatically. Cancelling only affects tasks that are still queued.
- **Versions kept.** Regenerating adds a version and does not overwrite the previous one. When something upstream changes, what depends on it is marked out of date, and nothing is regenerated on its own.
- **Native ffmpeg composition.** The cut is rendered with the ffmpeg installed on your machine, in 9:16, 16:9 or 1:1, with narration voice, soft or burned-in subtitles, SRT and VTT, and an asset package for editing elsewhere.

The workspace speaks English, Simplified Chinese and Traditional Chinese, in a light and a dark theme.

## How a project moves

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/pipeline-en-dark.svg" />
    <img src="./docs/assets/readme/pipeline-en-light.svg" alt="Source text, episodes, scenes and shots are planned first. Shot images, shot videos, narration, the cut and the export follow. Checks run before any paid job; versions are kept; the task queue survives restarts." width="100%" />
  </picture>
</p>

In words: source text → episodes → scenes → shots → shot images → shot videos → narration → composed cut with subtitles → export.

<details>
<summary><strong>More screens</strong>: project overview, asset library, checks before generating, compose timeline, task panel</summary>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/en/overview-dark.webp" />
  <img src="./docs/assets/readme/en/overview-light.webp" alt="Project overview with the next steps of the current episode, the episode list and project settings" width="100%" />
</picture>

**Project overview.** The next steps for the current episode, and the state of every episode.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/en/assets-dark.webp" />
  <img src="./docs/assets/readme/en/assets-light.webp" alt="The asset library with character reference sheets" width="100%" />
</picture>

**Asset library.** Characters, locations, props and costumes. The three-view sheets shown here are placeholder sketches from demo mode.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/en/confirm-dark.webp" />
  <img src="./docs/assets/readme/en/confirm-light.webp" alt="The confirmation dialog before a batch video job, with the model, aspect ratio, estimated cost and warnings" width="100%" />
</picture>

**Checks before generating.** Nothing is ordered from a provider until you confirm. The amount is in the demo's fictional currency.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/en/compose-dark.webp" />
  <img src="./docs/assets/readme/en/compose-light.webp" alt="The compose page with a timeline of picture, narration and subtitle tracks and a list of issues" width="100%" />
</picture>

**Compose.** A timeline of picture, narration, subtitles and music, with a list of issues that would block rendering.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/en/tasks-dark.webp" />
  <img src="./docs/assets/readme/en/tasks-light.webp" alt="The storyboard with the task panel open: one task needing action, three running and three queued" width="100%" />
</picture>

**Task panel.** Tasks that need action, running tasks and the queue, with the storyboard updating beside it. The task at the top was cut off before the provider confirmed it: dramai says so, asks you to check the provider's dashboard, and never resubmits it on its own. Tasks already submitted to a provider cannot be cancelled and are billed as usual.

</details>

## Run it

- **WebUI**: `pnpm webui`. Starts the server, serves the workspace and opens your browser.
- **Desktop, run from source**: `pnpm desktop:dev`. An Electron window around the same server and workspace.
- **Desktop, build and install on your machine**: `pnpm desktop:install`. Builds the app locally and installs it for the current user. No certificate and no download warnings, because the app is made on your machine. `pnpm desktop:uninstall` removes it and keeps your data.
- **Desktop, installer**: no installer yet. Installers for macOS, Windows and Linux are built by the release workflow and will be attached to a GitHub release once the first beta is published. They are unsigned.

Everything starts from a checkout, with Node.js 22.22.2+, pnpm 9 and ffmpeg:

```bash
git clone https://github.com/hyyyyyyz/dramai.git
cd dramai
pnpm install
pnpm build          # needed for the WebUI
pnpm webui          # or: pnpm desktop:install
```

ffmpeg is not bundled in any form. Install it with `brew install ffmpeg` (macOS), `winget install Gyan.FFmpeg` (Windows) or your package manager (`apt install ffmpeg`). Burning subtitles into the picture needs a build with libass; Settings → About shows what your ffmpeg can do.

<details>
<summary><strong>WebUI options and where data lives</strong></summary>

<br />

```bash
pnpm webui --port 9000 --data-dir ~/dramai-data --no-open
```

The default address is `http://127.0.0.1:8787` and the default data directory is `~/.dramai`. The server only listens on `127.0.0.1`; to reach it from another device you must pass `--host` together with an access token. In the WebUI, API keys are kept in `secrets.json` in the data directory, readable only by your operating system user and not encrypted. See [apps/webui](./apps/webui/README.md).

</details>

<details>
<summary><strong>Desktop app details</strong></summary>

<br />

The desktop app keeps your data in your user folder (for example `~/Library/Application Support/Dramai/data` on macOS) and stores API keys with the operating system's key store where one exists. Installers are unsigned, so macOS and Windows will warn the first time you open one; the steps are in [apps/desktop](./apps/desktop/README.md), along with the build, install and uninstall details.

</details>

## Status

**Works today**

- The whole workflow runs end to end in demo mode: upload a text, plan episodes, break down shots, confirm characters and locations, generate images and video, compose, export.
- Browser tests (Playwright) cover that path, a failed task being resumed, the English interface and keyboard-only use.
- The desktop app has been run on macOS.

**Not verified**

- Any real AI provider. The four provider presets carry model ids and prices last checked in May 2026.
- The desktop app on Windows and Linux. CI builds it and runs an install self-check on both, but nobody has used it on a real Linux or Windows desktop yet.
- CI runs on Linux, macOS and Windows; it was not yet fully green when this was written.
- API keys are not encrypted in the WebUI.

**Not released**

- Installers, an npm package, a Docker image and a landing page. GitHub Pages no longer serves a workspace.

Known limits: transitions are hard cuts, there is a single music track, and the in-browser preview leaves out subtitles, music and transitions. Setting up providers (language model, image, video and voice) will be documented separately; until then, Settings → Providers in the app lists the presets and can test a connection. The full list is in the [changelog](./CHANGELOG.md).

## Coming from v0.4

v0.4 was a browser-only app and kept its data inside the browser, so the new version cannot see it. Export a JSON backup from the old app while you still can, then import it in Settings → Data & backup. [CHANGELOG.md](./CHANGELOG.md) has the upgrade steps. The last browser-only version is [v0.4.1](https://github.com/hyyyyyyz/dramai/releases/tag/v0.4.1).

## Documentation

- [CHANGELOG.md](./CHANGELOG.md): What `0.5.0-beta.1` contains, incompatible changes and upgrade notes
- [apps/webui](./apps/webui/README.md) · [apps/desktop](./apps/desktop/README.md): Starting the server, and the three desktop forms
- [packages/mock-providers](./packages/mock-providers/README.md): Demo mode and the simulated providers
- [packages/server](./packages/server/README.md) · [packages/api](./packages/api/README.md) · [packages/core](./packages/core/README.md) · [packages/workspace](./packages/workspace/README.md): The local server, its typed API, the engine and the workspace
- [docs/VERSIONING.md](./docs/VERSIONING.md) · [docs/RELEASING.md](./docs/RELEASING.md) · [docs/CI.md](./docs/CI.md): Version numbers, releasing, continuous integration

The architecture, provider and deployment guides in `docs/` still describe v0.4 and are being rewritten.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](./CONTRIBUTING.md). Commits follow Conventional Commits, and `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm format:check` should pass before you open a pull request.

## Versioning

One version number covers every package. While the major version is 0, new features and incompatible changes raise the minor number and fixes raise the patch number; incompatible changes are always called out in the changelog. Pre-release versions such as `0.5.0-beta.1` are marked as pre-releases on GitHub. The rules are in [docs/VERSIONING.md](./docs/VERSIONING.md).

## License

[Apache License 2.0](./LICENSE) © 2026 hyyyyyyz and dramai contributors.

## Acknowledgements

dramai draws on two open-source projects for ideas: [xhongc/ai_story](https://github.com/xhongc/ai_story) for the pipeline and the design of the AI client layer, and [freestylefly/director_ai](https://github.com/freestylefly/director_ai) for the character-consistency approach and the documented video workflow. dramai is an independent TypeScript implementation and contains no source code from either.
