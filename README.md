<div align="center">

<img src="https://raw.githubusercontent.com/hyyyyyyz/dramai/main/public/logo.svg" alt="dramai · AI short-drama studio in your browser" width="720" />

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

## 🚀 完整教程 · 从注册到第一部短剧

> 📌 **预计耗时**：首次配置 30 分钟 + 跑一次约 30 分钟（含等视频生成）
> 💰 **预计花费**：先充 **¥30-50** 试水，单部 30 秒短剧成本 **¥40-50** 左右

### Step 1 · 准备两个账号 + API Key（10 分钟）

dramai 不存你的 key，所以**你需要直接去 AI 服务商充值**。下面这两个组合是验证过的最便宜组合：

#### ① DeepSeek（写分镜剧本，几乎免费）

1. 打开 [https://platform.deepseek.com](https://platform.deepseek.com) → 注册（手机号/邮箱）
2. 充值 **¥10**（够写几十部短剧的分镜）
3. 左侧 **「API keys」** → **「Create new API key」** → 复制保存（`sk-xxxxxx`）

#### ② 302.AI（生图 + 生视频，主要花费在这里）

1. 打开 [https://302.ai](https://302.ai)（推广链接 [https://share.302.ai/d6IJUM](https://share.302.ai/d6IJUM) 通常带充值优惠）→ 注册
2. **「账户」/「充值」** → 充 **¥30-50**（够 3-5 部短剧试水）
3. **「API 管理」/「密钥管理」** → 创建一个 API Key（命名为 "dramai"）→ 复制保存

> ⚠️ 一个 302 key 通常能调它对接的所有模型，**不需要给生图、生视频分别建 key**——下面 3 个 provider 共用同一个就行。

### Step 2 · 在 dramai 里配 4 个 Provider（5 分钟）

打开 [https://hyyyyyyz.github.io/dramai/settings](https://hyyyyyyz.github.io/dramai/settings)（或你 fork 部署的地址）。

每个 provider **直接点预设 chip**自动填好配置，**只需粘贴 API Key + 保存 + 激活**：

| 顺序      | 点这个预设 chip                                       | 粘什么 key         | 激活 |
| --------- | ----------------------------------------------------- | ------------------ | ---- |
| ①         | **DeepSeek 直连 (LLM)**                               | DeepSeek 的 sk-... | ✅   |
| ②         | **302.AI · 即梦 Seedream 5.0 (字节，便宜)**           | 302 的 sk-...      | ✅   |
| ③         | **⭐ 302.AI · 通义万相 Wan2.2 Flash (最便宜 · 阿里)** | 302 的 sk-...      | ✅   |
| ④（可选） | **302.AI · Nano Banana (Gemini 文生图)**              | 302 的 sk-...      | 备用 |

**激活**：每个 provider 卡片上点「激活」按钮，让它成为该类型的当前选项。

> 测试连接：DeepSeek 的会显示模型数量；图/视频的预设可能显示「该协议无标准列表端点，请直接生成验证」——**这是正常的**，不代表配错了。

### Step 3 · 创建项目，喂故事素材（5 分钟）

1. 顶栏点 **「项目」** → **「+ 新建项目」**
2. 填：
   - **标题**：随便（如"清朝宫廷"）
   - **风格**：点一个预设 chip（漫剧/动画 / 古风仙侠漫 / 现代都市短剧 等）
   - **简介**：可选
3. 点「创建并打开」
4. **「素材」** 卡片：上传一个 `.txt` / `.md` / `.docx`（你的故事原文，500-3000 字最佳），或者图片做参考

### Step 4 · 生成分镜（30 秒到 1 分钟）

在 **「分镜生成」** 卡片：

1. 在指令框写你的需求，例如：

   > 把上传的故事改写成 6 个分镜，温馨童话风格。每镜 5 秒。重点表现主角的心理变化。

2. 点 **「生成分镜」**
3. 等下方实时刷出 6 个分镜（含场景、旁白、英文 image prompt、出场角色、时长）
4. 不满意可以改指令重生；满意再下一步

### Step 5 · 批量生图（2-5 分钟）

分镜列表上方点 **「批量生图」**：

- dramai 顺序给每个分镜调 Seedream 5.0
- 每张图 10-30 秒，6 张约 1-3 分钟
- 完成后每个分镜卡片左侧出现缩略图
- **预算**：6 × 0.035 PTC ≈ **¥1.5**

### Step 6 · 批量生视频（10-20 分钟，最慢的一步）

点 **「批量生视频」**：

- 顺序调 Wan2.2 Flash，每条 1-3 分钟
- 6 条总耗时约 6-18 分钟（**别刷新页面**——任务恢复轮询是 v0.5 才有）
- **预算**：6 × 0.2 PTC ≈ **¥8**
- 完成后分镜卡片缩略图变成可播放的 video

### Step 7 · 合成 + 字幕 + 剪映 ZIP（5 分钟）

滚到 **「合成 / 字幕 / 剪映导出」** 卡片：

1. 点 **「合成成片（6 段）」**
   - **首次**会下载 ~30MB 的 FFmpeg.wasm core（仅一次，浏览器缓存住）
   - 转码每段 → 拼接 → 完成约 30 秒-2 分钟
2. 点 **「下载成片 mp4」** → 你这部 30 秒短剧到手 🎬
3. 同时点 **「导出 SRT」** → 拿到字幕文件
4. （可选）点 **「剪映 ZIP」** → 下载一个含 mp4 + 图 + SRT 的 zip

### Step 8 · 在剪映加配音（5 分钟，可选）

dramai 当前不生成旁白音频。要让旁白被读出来：

1. 桌面端打开 **剪映**（CapCut）
2. 新建项目 → 把 dramai 下载的 mp4 拖到主轨
3. 把 SRT 拖到字幕轨
4. **选中字幕 → 右侧面板「文本朗读」** → 选音色（小学语文老师 / 抒情女声 / 新闻男声等）
5. 一键生成配音，剪映会按 SRT 时间轴自动对齐

✨ **完成**——你刚刚做完一部完整的 AI 短剧。

---

## 🎯 已验证组合（2026-05-04 端到端跑通）

下面这套配置是经过**真人实测**从素材 → 分镜 → 图 → 视频 → 成片 → 剪映 ZIP 全流程跑通的，**强烈推荐新用户照抄**——dramai 内置预设也只保留这 4 个：

| 角色           | 服务商                         | Base URL                    | Model                        | API 协议风格       | 价格档          |
| -------------- | ------------------------------ | --------------------------- | ---------------------------- | ------------------ | --------------- |
| LLM 写分镜     | DeepSeek 直连                  | `https://api.deepseek.com`  | `deepseek-chat`              | OpenAI 兼容        | 极便宜          |
| 文生图         | 302.AI · 即梦 Seedream 5.0     | `https://api.302.ai/doubao` | `doubao-seedream-5-0-260128` | OpenAI 兼容        | ~0.035 PTC/张   |
| 文生图（备选） | 302.AI · Nano Banana           | `https://api.302.ai`        | `gemini-2.5-flash-image`     | **Gemini 原生**    | ~0.2-0.5 PTC/张 |
| 图生视频       | 302.AI · 通义万相 Wan2.2 Flash | `https://api.302ai.cn`      | `wan2.2-i2v-flash`           | **阿里 DashScope** | ~0.04 PTC/秒    |

**单部 30 秒短剧成本预估**（6 个分镜 / 720P）：

```
LLM        ¥0.x         （写分镜，便宜到忽略）
文生图      6 × 0.035 PTC = 0.21 PTC ≈ ¥1.5
图生视频    6 × 1 PTC ≈ 6 PTC ≈ ¥40         ← 大头在这里（Wan2.2-flash 5秒720P 约 0.2 PTC）
合成      免费（FFmpeg.wasm 在你浏览器跑）
配音      免费（导入剪映 → AI 配音内置）
─────────────────────────
总计       约 ¥40-50 一部
```

> 旁白音频不在 dramai 里生成，**导出剪映 ZIP 后**用剪映自带的「文本朗读」/「AI 配音」给 SRT 字幕配音，**免费且中文音色丰富**。这是当前最省事的路径。

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
