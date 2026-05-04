# Architecture

> 本文档描述 `dramai` 的整体架构。当前是 v0.0.1 骨架阶段；标记 🚧 的部分会在
> 后续里程碑里逐步落地。

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
│           State Layer (Zustand) 🚧           │  store/*
├──────────────────────────────────────────────┤
│             Core (Business)                  │  src/core/*
│  ┌──────────┬──────────┬──────────────────┐  │
│  │ pipeline │ prompts  │ parsers / export │  │
│  ├──────────┴──────────┴──────────────────┤  │
│  │     llm    │   image    │   video      │  │  AI clients
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

## 3. 关键抽象（v0.1 起落地）

```ts
// src/core/llm/types.ts
export interface BaseAIClient {
  validateConfig(): Promise<boolean>
  healthCheck(): Promise<boolean>
}

export interface LLMClient extends BaseAIClient {
  chat(req: ChatRequest): AsyncIterable<ChatChunk>
}

export interface Text2ImageClient extends BaseAIClient {
  generate(req: T2IRequest): Promise<T2IResult>
}

export interface Image2VideoClient extends BaseAIClient {
  generate(req: I2VRequest): Promise<I2VTaskHandle>
  poll(handle: I2VTaskHandle): Promise<I2VResult>
}

export interface PipelineStage<I, O> {
  name: StageName
  validate(ctx: PipelineContext<I>): Promise<void>
  process(ctx: PipelineContext<I>): Promise<O>
  onFailure(ctx: PipelineContext<I>, err: unknown): Promise<void>
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

每个阶段实现 `PipelineStage` 接口；`PipelineOrchestrator`（v0.1 落地）负责
顺序调度、重试、暂停/恢复。

## 5. 数据模型 (IndexedDB / Dexie) 🚧

```
projects           id, title, summary, createdAt, updatedAt, settings
characters         id, projectId, name, refImageId?, prompt, isProtagonist
materials          id, projectId, kind(doc|txt|md|image), name, blobId
storyboards        id, projectId, sequence, sceneText, narration,
                   imagePrompt, cameraParams, characterIds, durationSec
assets             id, kind(image|video), blob (Blob), meta
generations        id, stageName, status, input, output, retry, error
settings           singleton: providers[], activeProvider, theme, locale
```

详细 schema 见 [docs/DATA_MODEL.md](./DATA_MODEL.md)（v0.1 起补充）。

## 6. 安全模型

- API Key 存在 `localStorage`（默认）或导出为加密 JSON（v0.3+）。
- AI 调用通过 fetch 直接打到用户填写的 base URL；不经任何中间服务器。
- 大文件资源（图、视频）用 Blob + IndexedDB 存储，可一键导出/清理。
- XSS：所有 AI 返回内容渲染前严格转义；不使用 `dangerouslySetInnerHTML`。

## 7. 项目结构

```
src/
  main.tsx
  App.tsx
  pages/        Home / Projects / Project / Characters / Settings / About 🚧
  components/   ui / upload / editor / storyboard / character / progress 🚧
  core/
    pipeline/   orchestrator + stages
    prompts/    模板
    llm/ image/ video/    AI 客户端
    parsers/    docx / md / txt
    storage/    Dexie schema + CRUD
    export/     jianying / json / zip
  store/        Zustand stores
  hooks/
  lib/          工具
  types/        公共类型
  styles/       全局样式
  i18n/         zh-CN / en
```
