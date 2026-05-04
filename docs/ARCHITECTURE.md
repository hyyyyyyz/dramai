# Architecture

> 本文档描述 `dramai` 的整体架构（写于 v0.1.0）。标记 🚧 的部分会在后续里程碑里
> 逐步落地。

## 1. 设计原则

1. **零后端**：所有能力跑在浏览器里，不引入任何专属服务器端组件。
2. **可托管 GitHub Pages**：构建产物是纯静态资源，base path 配置成 `/dramai/`。
3. **OpenAI 兼容优先**：AI 调用统一抽象成"OpenAI 兼容协议"，方便用户在
   不同服务商之间切换。
4. **SOLID 抽象，开放扩展**：参考 [xhongc/ai_story](https://github.com/xhongc/ai_story)
   的责任链 + AI 客户端抽象层；本项目用 TypeScript 全新实现。
5. **数据本地化**：项目数据存 IndexedDB，资源文件可选下载到本地或挂第三方对象存储。

## 2. 分层

```
┌──────────────────────────────────────────────┐
│              UI Layer (React)                │  pages / components
├──────────────────────────────────────────────┤
│           State Layer (Zustand)              │  store/*
├──────────────────────────────────────────────┤
│             Core (Business)                  │  src/core/*
│  ┌──────────┬──────────┬──────────────────┐  │
│  │ pipeline │ prompts  │ parsers / export │  │
│  ├──────────┴──────────┴──────────────────┤  │
│  │     llm    │   image 🚧 │   video 🚧   │  │  AI clients
│  ├────────────┴────────────┴──────────────┤  │
│  │             storage (Dexie)            │  │  IndexedDB schema
│  └────────────────────────────────────────┘  │
├──────────────────────────────────────────────┤
│          Browser APIs (IDB / Fetch)          │
└──────────────────────────────────────────────┘
                       │
                       ▼
              OpenAI-compatible
               服务商 endpoint
```

## 3. 关键抽象

v0.1 实际落地的核心是 **OpenAI 兼容 LLM 流式客户端** + **责任链 Pipeline**，
对应 `src/core/llm/*` 与 `src/core/pipeline/storyboard.ts`：

```ts
// src/core/llm/client.ts
export async function* streamChat(
  provider: Pick<Provider, 'baseUrl' | 'apiKey' | 'model'>,
  request: ChatRequest,
): AsyncGenerator<ChatChunk, ChatResult, void>

// src/core/pipeline/storyboard.ts
export async function* generateStoryboards(
  input: RunInput,
): AsyncGenerator<StoryboardEvent, void, void>
```

`StoryboardEvent` 是一个 tagged union（`starting | streaming | parsing |
persisting | done | error`），UI 端用 `for await` 消费即可显示进度，并随时
`AbortController.abort()` 中止。

🚧 v0.2+ 将引入 `Text2ImageClient` / `Image2VideoClient` 抽象，复用同样的
`Provider` + AsyncGenerator 模式：

```ts
export interface Text2ImageClient {
  generate(req: T2IRequest): Promise<T2IResult>
}

export interface Image2VideoClient {
  generate(req: I2VRequest): Promise<I2VTaskHandle>
  poll(handle: I2VTaskHandle): Promise<I2VResult>
}
```

## 4. Pipeline 阶段（短剧工作流）

```
parse → rewrite → storyboard → image → camera → video
```

| 阶段         | 输入                                 | 输出                         |
| ------------ | ------------------------------------ | ---------------------------- |
| `parse`      | 上传的 doc/txt/md/img + 用户文本输入 | 归一化的"创作素材包"         |
| `rewrite`    | 创作素材包 + 风格设定                | 改写后的故事文案             |
| `storyboard` | 改写文案 + 角色卡                    | 结构化分镜 JSON 数组         |
| `image`      | 单分镜 + 关联角色参考图              | 分镜图片                     |
| `camera`     | 分镜 + 风格                          | 运镜参数（时长、移动、缩放） |
| `video`      | 分镜图 + 运镜 + 视频提示词           | 视频片段                     |

v0.1 已实现 `parse → storyboard`；后面四阶段进入 v0.2-v0.4 路线图。

## 5. 数据模型（IndexedDB / Dexie v1）

实际 schema 在 `src/core/storage/db.ts`，v0.1.0 版本号为 1：

```
projects      id, status, createdAt, updatedAt
characters    id, projectId, role, locked, createdAt
materials     id, projectId, kind, createdAt
storyboards   id, projectId, status, [projectId+sequence]
assets        id, projectId, kind, createdAt    -- Blob 直接存，不外切
generations   id, projectId, stageName, status, createdAt
```

完整字段定义见 `src/types/domain.ts`。Provider 配置不在 IndexedDB，而在
`localStorage` 的 `dramai-settings` key 下（zustand persist 中间件托管）。

备份/恢复实现在 `src/core/export/json.ts`：所有表 + Blob 序列化为单个 JSON
（Blob 用 base64），导入支持 merge / replace 两种模式。

## 6. 安全模型

- API Key 存在 `localStorage`（默认）或导出为加密 JSON（v0.3+）。
- AI 调用通过 fetch 直接打到用户填写的 base URL；不经任何中间服务器。
- 大文件资源（图、视频）用 Blob + IndexedDB 存储，可一键导出/清理。
- XSS：所有 AI 返回内容渲染前严格转义；不使用 `dangerouslySetInnerHTML`。

## 7. 项目结构（v0.1.0 实际状态）

```
src/
  main.tsx                     i18n 初始化 + 路由 RouterProvider
  router.tsx                   createBrowserRouter，basename 来自 BASE_URL
  pages/                       Home / Projects / ProjectDetail / Characters / Settings / About / NotFound
  components/
    ui/                        Button / Card / Badge / Input / Textarea / Label / Select / Modal
    icons/                     GithubIcon (lucide 1.x 不再含品牌)
    layout/                    AppLayout / AppHeader / AppFooter / BrandMark / LocaleSwitcher
    settings/                  ProviderForm / ProviderCard / BackupRestore / PROVIDER_PRESETS
    projects/                  ProjectCard / ProjectCreateDialog
    upload/                    MaterialUploadArea / MaterialList
    storyboard/                StoryboardGenerator / StoryboardList
  core/
    pipeline/storyboard.ts     生成分镜的 AsyncGenerator 编排
    prompts/storyboard.ts      system + user 模板
    llm/                       types / sse / client / test-connection
    image/                     🚧 v0.2 起
    video/                     🚧 v0.3 起
    parsers/                   docx (lazy) / text / image / index
    storage/                   db / projects / characters (后续) / materials / storyboards / assets
    export/json.ts             备份/恢复
  store/settings.ts            zustand provider 配置 + 持久化
  i18n/                        index + locales/zh-CN.json + locales/en.json
  lib/cn.ts                    clsx + tailwind-merge
  types/domain.ts              域模型类型契约
  styles/globals.css           Tailwind v4 + @theme + 暗色 OKLCH
```
