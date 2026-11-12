<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./packages/ui/src/brand/banner-ink.svg" />
  <img src="./packages/ui/src/brand/banner-paper.svg" alt="dramai：在你自己电脑上运行的开源 AI 短剧工作室" width="720" />
</picture>

[English](./README.md) · **简体中文**

[![License](https://img.shields.io/github/license/hyyyyyyz/dramai?color=DF500C)](./LICENSE)
[![Version](https://img.shields.io/github/package-json/v/hyyyyyyz/dramai?color=DF500C&label=version)](./CHANGELOG.md)

</div>

dramai 是一个开源的 AI 短剧工作室，在你自己的电脑上运行。给它一部小说或一份剧本，它会规划出集、场和镜头，通过你选择的 AI 服务商生成图片和视频，再合成带旁白和字幕的成片。

它面向做连载短剧、又想把作品握在自己手里的人：项目是你磁盘上的普通文件夹，API Key 留在你的电脑上，不经过任何由我们运营的服务。

> [!IMPORTANT]
> **当前是 `0.5.0-beta.1`，一个测试版。** 它只用自动化测试和内置的模拟服务商验证过，**还没有连过真实的 AI 服务商**。桌面端只在 macOS 上实际运行过。目前没有发布任何版本：没有安装包、npm 包或 Docker 镜像可以下载。详见[现状](#现状)。

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/zh/storyboard-dark.webp" />
    <img src="./docs/assets/readme/zh/storyboard-light.webp" alt="分镜页：镜头按场分组，每个镜头带有图片、视频、旁白、提示词和引用的资产" width="100%" />
  </picture>
  <br />
  <sub>一个小型演示项目的分镜页。图片和视频是演示模式生成的占位内容。</sub>
</p>

## 一分钟试用，不需要 API Key

演示模式会在你的电脑上用模拟的服务商跑完整个工作室：不用注册账号，不用 Key，不产生费用。它生成的是占位内容（带编号的色块和测试画面），用来展示工作流怎么运转，而不是真实模型的效果。

你需要 [Node.js](https://nodejs.org) 22.13 或更新版本、[pnpm](https://pnpm.io) 9，以及在 `PATH` 里能找到的 [ffmpeg](https://ffmpeg.org)。

```bash
git clone https://github.com/hyyyyyyz/dramai.git
cd dramai
pnpm install
pnpm build
pnpm demo --static-dir packages/workspace/dist
```

打开 <http://127.0.0.1:8787>。新建一个项目，上传一个短篇故事，规划分集，拆分镜头，确认角色和地点，然后生成图片和视频，最后合成成片。演示用的数据放在 `~/.dramai-demo`，和你的正式数据分开；加上 `--fresh` 可以清空重来。

## 有什么不同

|                            |                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **本地运行，Key 在你手里** | 一个监听 `127.0.0.1` 的服务完成所有工作。项目是普通文件加一个 SQLite 数据库。请求由这个服务直接发给服务商，没有 CORS 限制，中间也没有转发。                        |
| **长文本和连载**           | 一个项目包含集，集包含场，场包含镜头。长文本按章节切分成集。                                                                                                       |
| **可复用的资产库**         | 角色、地点、道具和服装是资产，镜头通过引用使用它们。每个资产有一张设定图，所有用到它的镜头都以它为参考生成。画风在建项目时选定一次。                               |
| **花钱之前先检查**         | 引用了未登记资产、或没有参考图的资产的镜头会被拦下；一批任务要么整批执行，要么都不执行；一个镜头同一时间最多只有一个视频任务；确认之前会按模型价目表给出费用预估。 |
| **重启后不丢的任务队列**   | 关掉浏览器不会中断工作。重启之后，有上游任务号的视频任务会继续轮询；没有的会标成“提交结果待确认”，**不会被自动重新提交**。取消只作用于还在排队的任务。             |
| **保留版本**               | 重新生成会新增一个版本，不覆盖旧的。上游内容变了，依赖它的产物会标为过期，但不会自动重新生成。                                                                     |
| **原生 ffmpeg 合成**       | 成片由你电脑上的 ffmpeg 渲染，支持 9:16、16:9、1:1，带旁白配音、软字幕或烧录字幕、SRT 和 VTT，还能导出素材包到别的软件里继续剪。                                   |

工作台提供英文、简体中文和繁体中文界面，有浅色和深色两套主题。

## 一个项目怎么走

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/pipeline-zh-dark.svg" />
    <img src="./docs/assets/readme/pipeline-zh-light.svg" alt="先规划原文、分集、场和镜头，再生成分镜图、视频、旁白，合成成片并导出。任何付费任务之前都会检查，版本会保留，任务队列重启后可恢复。" width="100%" />
  </picture>
</p>

用文字说：原文 → 分集 → 场 → 镜头 → 分镜图 → 视频 → 旁白 → 带字幕的成片 → 导出。

<details>
<summary><strong>更多界面</strong>：项目概览、资产库、生成前确认、合成时间线、任务面板</summary>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/zh/overview-dark.webp" />
  <img src="./docs/assets/readme/zh/overview-light.webp" alt="项目概览：当前集的下一步、分集列表和项目设置" width="100%" />
</picture>

**项目概览。** 当前集的下一步，以及每一集的进度。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/zh/assets-dark.webp" />
  <img src="./docs/assets/readme/zh/assets-light.webp" alt="资产库：角色设定图" width="100%" />
</picture>

**资产库。** 角色、地点、道具和服装。这里的设定图是演示模式的占位图。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/zh/confirm-dark.webp" />
  <img src="./docs/assets/readme/zh/confirm-light.webp" alt="批量生成视频前的确认对话框：模型、画幅、预估费用和提示" width="100%" />
</picture>

**生成前确认。** 在你确认之前，不会向服务商下任何订单。金额用的是演示模式里虚构的币种。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/zh/compose-dark.webp" />
  <img src="./docs/assets/readme/zh/compose-light.webp" alt="合成页：画面、旁白、字幕轨道的时间线和问题列表" width="100%" />
</picture>

**合成。** 画面、旁白、字幕和配乐的时间线，以及会阻止渲染的问题清单。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/zh/tasks-dark.webp" />
  <img src="./docs/assets/readme/zh/tasks-light.webp" alt="打开任务面板的分镜页，显示两个进行中的视频任务" width="100%" />
</picture>

**任务面板。** 进行中、排队中和已完成的任务。已经提交给服务商的任务不能取消，照常计费。

</details>

## 怎么运行

| 形式                     | 命令                   | 说明                                                                                                                                              |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WebUI**                | `pnpm webui`           | 启动服务、托管工作台，并打开浏览器。                                                                                                              |
| **桌面端：从源码运行**   | `pnpm desktop:dev`     | 一个 Electron 窗口，里面是同一个服务和同一个工作台。                                                                                              |
| **桌面端：本机编译安装** | `pnpm desktop:install` | 在你的机器上编译并安装给当前用户。不需要证书，也没有下载警告，因为应用是在你自己的电脑上生成的。`pnpm desktop:uninstall` 卸载应用，保留你的数据。 |
| **桌面端：安装包**       | 暂无                   | macOS、Windows、Linux 的安装包由发布工作流构建，首个测试版发布后会附在 GitHub Release 上。安装包不签名。                                          |

所有形式都从一份检出的代码开始，需要 Node.js 22.13+、pnpm 9 和 ffmpeg：

```bash
git clone https://github.com/hyyyyyyz/dramai.git
cd dramai
pnpm install
pnpm build          # WebUI 需要先构建
pnpm webui          # 或：pnpm desktop:install
```

任何形式都不附带 ffmpeg，请自己安装：macOS 用 `brew install ffmpeg`，Windows 用 `winget install Gyan.FFmpeg`，Linux 用包管理器（如 `apt install ffmpeg`）。把字幕烧录进画面需要带 libass 的 ffmpeg；设置 → 关于 里能看到你的 ffmpeg 支持什么。

<details>
<summary><strong>WebUI 的选项与数据位置</strong></summary>

<br />

```bash
pnpm webui --port 9000 --data-dir ~/dramai-data --no-open
```

默认地址是 `http://127.0.0.1:8787`，默认数据目录是 `~/.dramai`。服务只监听 `127.0.0.1`；想从别的设备访问，必须同时给 `--host` 和访问令牌。WebUI 下，API Key 保存在数据目录的 `secrets.json` 里，只有你的操作系统用户可读，没有加密。详见 [apps/webui](./apps/webui/README.md)。

</details>

<details>
<summary><strong>桌面端的细节</strong></summary>

<br />

桌面端把数据放在你的用户目录下（例如 macOS 上是 `~/Library/Application Support/Dramai/data`），有系统密钥库时用它保存 API Key。安装包不签名，所以 macOS 和 Windows 第一次打开时会给出警告，放行的步骤以及编译、安装、卸载的细节见 [apps/desktop](./apps/desktop/README.md)。

</details>

## 现状

| 现在能用的                                                                                                                                                                                                                  | 还没验证的                                                                                                                                                                 | 还没发布的                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 整条流程在演示模式下端到端可用：上传文本、规划分集、拆分镜头、确认角色和地点、生成图片和视频、合成、导出。浏览器测试（Playwright）覆盖了这条路径、失败任务的恢复、英文界面和纯键盘操作。桌面端在 macOS 上通过了自己的检查。 | 任何真实的 AI 服务商：四个服务商预设里的模型名和价格，最后核对于 2026 年 5 月。桌面端在 Windows 和 Linux 上的表现。三个系统上的 CI 仍在修复中。WebUI 下 API Key 没有加密。 | 安装包、npm 包、Docker 镜像和宣传页。GitHub Pages 上不再提供可用的工作台。 |

关于桌面端：Linux 上，CI 能编译并安装它；Windows 上能编译和安装，但安装后的应用还没有通过 CI 的启动检查。请把这两个系统都当作未经测试。

已知的限制：转场目前只有硬切，配乐只支持一条，浏览器里的预览不含字幕、配乐和转场。服务商（大模型、图片、视频、配音）的配置方法会另外成文；在那之前，应用里的 设置 → 服务商 列出了预设，并且可以测试连接。完整清单见[更新日志](./CHANGELOG.md)。

## 从 v0.4 升级

v0.4 是纯浏览器应用，数据存在浏览器里，所以新版本看不到它们。趁旧应用还在，先从里面导出一份 JSON 备份，再到新版的 设置 → 数据与备份 里导入。升级步骤见 [CHANGELOG.md](./CHANGELOG.md)。最后一个纯浏览器版本是 [v0.4.1](https://github.com/hyyyyyyz/dramai/releases/tag/v0.4.1)。

## 文档

|                                                                                                                                                                                               |                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| [CHANGELOG.md](./CHANGELOG.md)                                                                                                                                                                | `0.5.0-beta.1` 包含什么、不兼容的变更和升级说明 |
| [apps/webui](./apps/webui/README.md) · [apps/desktop](./apps/desktop/README.md)                                                                                                               | 启动服务，以及桌面端的三种形式                  |
| [packages/mock-providers](./packages/mock-providers/README.md)                                                                                                                                | 演示模式和模拟服务商                            |
| [packages/server](./packages/server/README.md) · [packages/api](./packages/api/README.md) · [packages/core](./packages/core/README.md) · [packages/workspace](./packages/workspace/README.md) | 本地服务、类型化接口、业务内核和工作台          |
| [docs/VERSIONING.md](./docs/VERSIONING.md) · [docs/RELEASING.md](./docs/RELEASING.md) · [docs/CI.md](./docs/CI.md)                                                                            | 版本号规则、发布流程、持续集成                  |

`docs/` 里的架构、服务商和部署文档仍然描述 v0.4，正在重写。这些文档以及各包的说明目前多为英文。

## 参与贡献

欢迎提交议题和拉取请求，见 [CONTRIBUTING.md](./CONTRIBUTING.md)。提交信息遵循约定式提交；开拉取请求之前，请确保 `pnpm typecheck`、`pnpm lint`、`pnpm test` 和 `pnpm format:check` 通过。

## 版本号

全仓所有包使用同一个版本号。主版本为 0 期间，新功能和不兼容的变更提高次版本号，修复提高修订号；不兼容的变更一定会在更新日志里单独写明。像 `0.5.0-beta.1` 这样的预发布版本在 GitHub 上会标为预发布。规则见 [docs/VERSIONING.md](./docs/VERSIONING.md)。

## 许可证

[Apache License 2.0](./LICENSE) © 2026 hyyyyyyz and dramai contributors.

## 致谢

dramai 在思路上参考了两个开源项目：[xhongc/ai_story](https://github.com/xhongc/ai_story) 的流水线与 AI 客户端抽象层设计，以及 [freestylefly/director_ai](https://github.com/freestylefly/director_ai) 的角色一致性方案和视频生成流程文档。dramai 是独立的 TypeScript 实现，不包含上述任何一个项目的源代码。
