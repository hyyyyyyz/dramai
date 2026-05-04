<div align="center">

# dramai

**An open-source AI short-drama studio that runs entirely in your browser.**

Text / docs / reference images → storyboard → character-consistent shots → video clips → one-click CapCut draft.
Pure front-end. Zero backend. Fork & deploy to GitHub Pages in minutes.

[中文](./README.md) ·
[Architecture](./docs/ARCHITECTURE.md) ·
[Roadmap](./docs/ROADMAP.md) ·
[Live Demo](https://hyyyyyyz.github.io/dramai/) (after first deployment)

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-v0.4.0-brightgreen)](./docs/ROADMAP.md)

</div>

---

## ✨ What is dramai?

`dramai` is a fully client-side AI tool for short-drama production:

- Drop in your story material (doc / txt / md / reference images);
- Type "what kind of drama I want" in the prompt box;
- It calls your own OpenAI-compatible endpoint and produces a structured storyboard;
- Then renders each shot into images, animates them into clips, and stitches the final cut;
- Need to refine? Export a [CapCut](https://www.capcut.com/) draft package.

Zero backend means: fork the repo + enable GitHub Pages = your own private deployment.
Your data and API keys never leave your browser.

## ✅ What v0.1 already does

- Configure any OpenAI-compatible LLM provider (OpenRouter / 302.AI / ciyuan / OpenAI / custom) with one-click presets and a real connectivity probe.
- Create projects; upload `.docx` / `.txt` / `.md` / images as raw material with auto text extraction + image thumbnails.
- One-line prompt → streaming LLM → tolerant JSON parse → persisted storyboard list (scene text, narration, English image prompt, characters, duration).
- Export the entire local database to a single JSON, restore via `merge` or `replace`.
- Bilingual UI (zh-CN / EN). Marketing pages and chrome are translated; functional pages get full translation in v0.2.

🚧 **On the way**: v0.2 character cards + text-to-image / v0.3 image-to-video / v0.4 CapCut export. See [docs/ROADMAP.md](./docs/ROADMAP.md).

## 🧱 Stack

| Module  | Choice                                              |
| ------- | --------------------------------------------------- |
| Build   | Vite 8 + TypeScript 6 + React 19                    |
| State   | Zustand 5 + persist                                 |
| Storage | IndexedDB via Dexie 4 + dexie-react-hooks           |
| Styling | Tailwind CSS v4 (`@theme` + OKLCH dark)             |
| Routing | React Router v7 (data router + basename)            |
| i18n    | i18next + react-i18next                             |
| AI      | Any OpenAI-compatible endpoint (you bring your key) |
| Hosting | GitHub Pages + GitHub Actions                       |

## 🚀 Quick start

```bash
git clone https://github.com/hyyyyyyz/dramai.git
cd dramai
npm install
npm run dev
# Open http://localhost:5173/dramai/
```

> `vite.config.ts` defaults `base = "/dramai/"` to match GitHub Pages.
> Set `VITE_BASE=/` to serve from the root path locally.

## 🌐 Deploy to GitHub Pages

A `.github/workflows/deploy.yml` ships with the repo. **Push to `main` and the
site is published to `https://<your-username>.github.io/dramai/`.** One-time setup:

1. **Settings → Pages → Build and deployment → Source**: pick `GitHub Actions`.
2. (Optional) **Settings → Actions → General → Workflow permissions**: pick
   `Read and write permissions`.

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for custom domains, CDN, CORS notes, etc.

## 🗺️ Roadmap

| Version | Scope                                             | Status      |
| ------- | ------------------------------------------------- | ----------- |
| v0.0.1  | Project skeleton + GH Pages deploy                | ✅ released |
| v0.1    | Text/file/image → storyboard (streaming LLM)      | ✅ released |
| v0.2    | Character cards + text-to-image                   | 🚧 planned  |
| v0.3    | Image-to-video + camera motion                    | 🚧 planned  |
| v0.4    | Video stitching + subtitles + CapCut draft export | 🚧 planned  |
| v0.5    | Performance / docs / template library polish      | 🚧 planned  |

## 🤝 Contributing

Pull requests welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## 🙏 Acknowledgements

dramai's architecture borrows ideas from:

- [xhongc/ai_story](https://github.com/xhongc/ai_story): pipeline + AI-client abstraction.
- [freestylefly/director_ai](https://github.com/freestylefly/director_ai):
  character-consistency "triple-view" technique and video pipeline docs.

dramai is an independent TypeScript re-implementation under the "pure browser /
no backend / GH Pages friendly" constraint and **does not embed any source code
from the projects above**.

## 📄 License

[Apache License 2.0](./LICENSE) © 2026 hyyyyyyz and dramai contributors.
