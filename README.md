<div align="center">

# dramai

**浏览器内的开源 AI 短剧工作台**

文本 / 文档 / 参考图 → 分镜脚本 → 角色一致的图 → 视频片段 → 一键导出剪映草稿
全程纯前端、零后端、可直接 fork 部署到 GitHub Pages。

[English](./README_EN.md) ·
[文档](./docs/ARCHITECTURE.md) ·
[路线图](./docs/ROADMAP.md) ·
[在线 Demo](https://hyyyyyyz.github.io/dramai/)（部署后可用）

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-v0.4.0-brightgreen)](./docs/ROADMAP.md)
[![Made with React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

</div>

---

## ✨ 它是什么

`dramai` 是一个**完全跑在浏览器里的 AI 短剧创作工具**：

- 你把自己的故事素材（doc / txt / md / 参考图）丢进去；
- 在输入框里写下一句"我想要的短剧是什么样子"；
- 它会调用你自己配置的 OpenAI 兼容 API，先生成结构化分镜脚本；
- 然后逐个分镜生图、生成视频片段、合成成片；
- 想要二次剪辑？直接导出 [剪映](https://www.capcut.cn/) 草稿。

零后端意味着：你只要会 fork 这个仓库 + 启用 GitHub Pages，就拥有了**自己的私有部署**。
你的数据、API Key 都不会经过任何中间服务器。

## ✅ v0.4 已经能做的

**素材到分镜（v0.1）**

- 配置任意 OpenAI 兼容 LLM 服务商，一键测试连接。
- 上传 `.docx` / `.txt` / `.md` / 图片做素材；流式 LLM + 容错 JSON 解析得到结构化分镜（含场景、旁白、英文 image prompt、出场角色、时长）。
- 一键导出/导入整库 JSON 备份。

**角色卡 + 文生图（v0.2）**

- 多角色卡管理，每个角色可绑定参考图并锁定。
- OpenAI 兼容文生图客户端；锁定角色的参考图自动作为图生图源图，多镜头里形象保持一致。
- 单分镜 / 批量生图，全程可中止。

**图生视频 + 运镜（v0.3）**

- Kling 原生协议 + OpenAI 兼容图生视频协议双支持，Provider 里切。
- 11 种运镜（pan / tilt / zoom / orbit / dolly + static）× 3 速度。
- 单 / 批量生视频，async 轮询带 10 分钟超时；分镜行内嵌 `<video>` 播放。

**合成 / 字幕 / 剪映导出（v0.4）**

- FFmpeg.wasm 单线程拼成片（720p H.264，dynamic import 30MB 仅首次合成下载）。
- SRT / VTT 字幕按分镜时长自动生成。
- 剪映 / CapCut 草稿包 ZIP 导出（alpha · 含 mp4/图/srt/manifest）。

🚧 **路上**：完整 i18n 翻译 / 真正可直接打开的剪映 .draft_content / TTS 旁白混音 / 模板库等，详见 [docs/ROADMAP.md](./docs/ROADMAP.md)。

## 🧱 技术栈

| 模块 | 选择                                        |
| ---- | ------------------------------------------- |
| 构建 | Vite 8 + TypeScript 6 + React 19            |
| 状态 | Zustand 5 + persist 中间件                  |
| 数据 | IndexedDB via Dexie 4 + dexie-react-hooks   |
| 样式 | Tailwind CSS v4 (`@theme` + OKLCH 暗色)     |
| 路由 | React Router v7（data router + basename）   |
| i18n | i18next + react-i18next                     |
| AI   | OpenAI 兼容 API（用户自填 base URL 与 key） |
| 部署 | GitHub Pages + GitHub Actions               |

## 🚀 本地开发

```bash
git clone https://github.com/hyyyyyyz/dramai.git
cd dramai
npm install
npm run dev
# 浏览器访问 http://localhost:5173/dramai/
```

> 注：因为 `vite.config.ts` 默认 `base = "/dramai/"`（适配 GitHub Pages），
> 本地开发的访问路径也是 `/dramai/`。
> 想用根路径，请设置环境变量：`VITE_BASE=/ npm run dev`。

可用脚本：

| 命令                              | 说明                          |
| --------------------------------- | ----------------------------- |
| `npm run dev`                     | 开发模式（HMR）               |
| `npm run build`                   | 类型检查 + 生产构建到 `dist/` |
| `npm run preview`                 | 预览构建产物                  |
| `npm run typecheck`               | 仅类型检查                    |
| `npm run lint` / `lint:fix`       | ESLint                        |
| `npm run format` / `format:check` | Prettier                      |

## 🌐 部署到 GitHub Pages

仓库已经包含 `.github/workflows/deploy.yml`，**push 到 `main` 分支后会自动部署**到
`https://<your-username>.github.io/dramai/`。一次性配置：

1. **Settings → Pages → Build and deployment → Source** 选择 `GitHub Actions`。
2. （可选）`Settings → Actions → General → Workflow permissions` 选择
   `Read and write permissions`。
3. 推一次代码，等 Actions 跑完即可。

更详细的部署说明（含自定义域名、CDN、CORS 等）在 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。

## 🧠 核心概念

- **项目（Project）**：一部短剧。包含元信息、原始素材、分镜列表、角色卡、生成结果。
- **角色卡（Character）**：一个项目内可创建多个角色，每个角色可绑定一张参考图，使其在不同分镜中保持形象一致；不绑定的角色会随机生成且与主角不同。
- **分镜（Storyboard / Shot）**：一段画面。包含场景描述、旁白、角色出场表、生图提示词、运镜参数、最终图与视频。
- **Pipeline 阶段**：`parse → rewrite → storyboard → image → camera → video`，参考 [xhongc/ai_story](https://github.com/xhongc/ai_story) 的责任链思路，但完全在浏览器内执行。

更多见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)。

## 🗺️ 路线图

| 版本   | 范围                                    | 状态      |
| ------ | --------------------------------------- | --------- |
| v0.0.1 | 项目骨架 + GitHub Pages 部署            | ✅ 已发布 |
| v0.1   | 文本/文件/参考图 → 分镜脚本（LLM 流式） | ✅ 已发布 |
| v0.2   | 角色卡 + 文生图                         | ✅ 已发布 |
| v0.3   | 图生视频 + 运镜                         | ✅ 已发布 |
| v0.4   | 视频合成 + 字幕 + 剪映导出              | ✅ 已发布 |
| v0.5   | 性能 / 文档 / 模板库 / 完整 i18n        | 🚧 规划中 |

完整路线图见 [docs/ROADMAP.md](./docs/ROADMAP.md)。

## 🤝 贡献

非常欢迎贡献！请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

- 报告 bug：请使用 [Bug Issue 模板](https://github.com/hyyyyyyz/dramai/issues/new?template=bug_report.yml)。
- 申请新特性：[Feature Issue 模板](https://github.com/hyyyyyyz/dramai/issues/new?template=feature_request.yml)。
- 安全问题：见 [SECURITY.md](./SECURITY.md)。

## 🙏 致谢

`dramai` 在架构与产品形态上参考了以下两个开源项目：

- [xhongc/ai_story](https://github.com/xhongc/ai_story)：Pipeline 责任链与 AI 客户端抽象层的设计思路。
- [freestylefly/director_ai](https://github.com/freestylefly/director_ai)：人物一致性"三视图"方案、视频生成完整流程文档。

`dramai` 是上述思路在"纯浏览器 / 零后端 / 可托管 GitHub Pages"约束下的全新 TypeScript
重写，**不包含任何来自上述项目的源代码**。

## 📄 许可证

[Apache License 2.0](./LICENSE) © 2026 hyyyyyyz and dramai contributors.
