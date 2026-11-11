# @dramai/server

本地优先的 HTTP 服务：Hono + `node:sqlite`。前端只依赖 `@dramai/api`（契约、事件类型、类型化客户端），不会打进任何服务端代码。

```ts
import { createServer } from '@dramai/server'

const server = await createServer({
  dataDir, // 数据库、项目文件夹、密钥文件、用户覆盖的提示词 / 模型数据
  port: 0, // 0 = 系统分配
  host: '127.0.0.1', // 默认；非回环地址必须带 token
  token, // 桌面版每次启动随机生成
  staticDir, // 可选：托管前端构建产物
})
server.url // http://127.0.0.1:<port>
await server.close()
```

开发：`pnpm --filter @dramai/server dev`（环境变量见 `src/dev.ts`）。

## 启动顺序

1. 校验安全配置（非回环必须有 token）——不满足就失败，**不碰数据目录**。
2. 数据目录锁（`dramai.lock`，`wx` 排他创建，写 pid；存活的 pid → `DataDirLockedError`，陈旧锁自动接管）。
3. 打开 SQLite（压掉 `node:sqlite` 的实验警告）→ 建表 / 迁移 → 升级旧文档。
4. 文件夹 / 密钥 / 数据目录（内置提示词、模型、画风 + `<dataDir>/catalog` 用户覆盖）→ 定位 ffmpeg（找不到不致命，`/api/system` 里如实报告）。
5. **恢复上次没有结局的 running 任务**（`recoverRunningJobs`）。
6. 注册任务处理器 → 启动 worker。
7. 注册路由 → 监听。任何一步失败都会释放已获得的资源。

## 存储

`node:sqlite`，一个库文件 `dramai.sqlite`（WAL）。**文档表**：每个实体一张表，常用查询列 + 一列 JSON `doc`（完整实体）；
`shot_refs`（镜头引用）是规范化的。任务表上有两个**部分唯一索引**（`dedupe_key` / `exclusive_key`，仅 `queued/running`），
再加事务内的显式检查：并发的 `insertIfNoConflict` 只有一个能写入（通过 core 的 `checkJobRepoContract`，真实 SQLite）。

所有读写经一个异步互斥 + `AsyncLocalStorage`：事务期间别的调用排队，事务内的嵌套调用并入同一个事务。

**迁移是两层的**：

- 表结构：`PRAGMA user_version` + `SCHEMA_MIGRATIONS[]`，每一步 `BEGIN IMMEDIATE … COMMIT`，失败整步回滚；数据库比当前版本新 → `SchemaTooNewError`，原样不动。
- 文档：每个文档带 `schemaVersion`，读取时按 `DocMigrations` 逐版本升级；启动时把落后的文档升级并写回。升级失败的写进 `repair` 表（不静默损坏、不影响其他文档）；比当前新的文档拒绝读取。

驱动被一个很小的 `Db` 接口隔开（`exec/run/get/all`），Electron 里 `node:sqlite` 不可用时可换 `better-sqlite3`。

## 密钥

API Key 只在服务端：`<dataDir>/secrets.json`（0600，目录 0700，原子写），接口只返回掩码（`sk-…6789`，短的只显示圆点）。
**可替换点**：`createServer({ secretStore })` 换整个实现（系统钥匙串），或 `createServer({ secretCipher })` 只提供加解密（Electron `safeStorage`），密文落盘。
WebUI / 容器场景没有系统加密可用，靠文件权限和数据目录隔离。

## 安全（计划 4.2）

- 默认只监听 `127.0.0.1`；非回环地址没有 token 直接拒绝启动。
- **Host 头校验**（防 DNS rebinding）：只放行 `localhost` / `*.localhost` / 回环 IP / 配置的 `allowedHosts`；其他 IP 字面量仅在启用 token 时放行。
- **不开 CORS**：不发任何 `Access-Control-*`；写请求和 SSE 的 `Origin` 必须与 `Host` 同源，`Sec-Fetch-Site: cross-site` 一律拒绝。
- token：`Authorization: Bearer`、`X-Dramai-Token`，或 HttpOnly + SameSite=Strict 的 cookie（`/?token=…` 引导后 303 跳转去掉 token）。常数时间比较，至少 16 字符。`/api/health` 免 token（仍需过 Host 校验）。
- 请求体上限：JSON 8MB，multipart 1GB。
- 项目文件下载：路径严格限制在项目文件夹内；`nosniff`、`default-src 'none'; sandbox`；只有图片 / 视频 / 音频内联，其余强制 attachment。

## 事件（SSE）与重连

唯一的通道 `GET /api/events`。事件类型见 `@dramai/api` 的 `serverEvent`：`hello`、`resync`、`job.updated`、`job.progress`、`job.worker_error`、`text.delta`、`data.changed`、`artifact.changed`。

- 事件 id = `<epoch>:<seq>`。epoch 是本次启动的标识，seq 在 epoch 内单调递增；最近 3000 条留在内存环里。
- 连接后先发 `hello`（带 epoch）。带 `Last-Event-ID` 重连：epoch 相同且缺的事件还在环里 → 按序补发；epoch 不同（服务重启过）或缺的已被挤出 → 发 `resync`，前端让所有查询失效重取。事件只是“提示”，真相永远在接口里。
- `text.delta`（文本步骤的 LLM 流式输出）约每 100ms 合并一条，不参与补发。
- 每 15s 一条注释心跳；关闭服务时主动结束所有流。

## 写入与并发

每个修改类路由（非 GET）整体在**一个事务**里执行（`RouteRegistry`）：读-改-写不会被并发请求穿插，不丢更新；中途失败整体回滚。
请求体（含上传文件）在进入事务前已读完。例外：`providers.test`（要等外部网络）、`generate.preflight`、`episodes.preflight`（只读）。
事务期间别的读写排队——本地单用户场景下串行就是想要的语义。测试里用“拉长读”的方式证明：去掉事务包装，并发编辑会丢更新。

## 错误

响应统一是 `{ error: { code, message, details? } }`。**前端按 `code` 分支，不要按 `message`**。
完整、封闭的错误码表在 `@dramai/api` 的 `ERROR_CODES`（每个码固定的 HTTP 状态 + 说明）；测试保证服务端抛出的每个码都在表里、状态一致。
core 的业务错误是 `DomainError`（`code` + `kind`：not_found / conflict / invalid / precondition），服务端按 `kind` 映射状态码、`code` 原样透传，**不看文案**。

## 路由

契约在 `@dramai/api`（`routes`）。服务端用 `RouteRegistry.handle(name, fn)` 绑定：路径参数 / 查询 / 请求体按契约校验（400），处理函数返回值的类型就是契约响应类型；测试里 `validateResponses: true` 会把响应也按 schema 校验。

| 方法   | 路径                                             | 名称                                |
| ------ | ------------------------------------------------ | ----------------------------------- |
| GET    | `/api/system`                                    | `system.get`                        |
| GET    | `/api/settings`                                  | `settings.get`                      |
| PUT    | `/api/settings`                                  | `settings.update`                   |
| GET    | `/api/styles`                                    | `styles.list`                       |
| GET    | `/api/presets`                                   | `presets.list`                      |
| GET    | `/api/providers`                                 | `providers.list`                    |
| POST   | `/api/providers`                                 | `providers.create`                  |
| POST   | `/api/providers/from-preset`                     | `providers.fromPreset`              |
| GET    | `/api/providers/:providerId`                     | `providers.get`                     |
| PATCH  | `/api/providers/:providerId`                     | `providers.update`                  |
| DELETE | `/api/providers/:providerId`                     | `providers.delete`                  |
| PUT    | `/api/providers/:providerId/key`                 | `providers.setKey`                  |
| DELETE | `/api/providers/:providerId/key`                 | `providers.clearKey`                |
| POST   | `/api/providers/:providerId/test`                | `providers.test`                    |
| GET    | `/api/providers/:providerId/capability`          | `providers.capability`              |
| PUT    | `/api/providers/:providerId/accepted-unverified` | `providers.acceptUnverified`        |
| GET    | `/api/projects`                                  | `projects.list`                     |
| POST   | `/api/projects`                                  | `projects.create`                   |
| GET    | `/api/projects/:projectId`                       | `projects.get`                      |
| PATCH  | `/api/projects/:projectId`                       | `projects.update`                   |
| DELETE | `/api/projects/:projectId`                       | `projects.delete`                   |
| POST   | `/api/projects/:projectId/restore`               | `projects.restore`                  |
| DELETE | `/api/projects/:projectId/purge`                 | `projects.purge`                    |
| GET    | `/api/projects/:projectId/artifacts`             | `projects.artifacts`                |
| GET    | `/api/projects/:projectId/materials`             | `materials.list`                    |
| POST   | `/api/projects/:projectId/materials`             | `materials.upload` (multipart)      |
| GET    | `/api/materials/:materialId/text`                | `materials.text`                    |
| DELETE | `/api/materials/:materialId`                     | `materials.delete`                  |
| GET    | `/api/projects/:projectId/episodes`              | `episodes.list`                     |
| GET    | `/api/episodes/:episodeId`                       | `episodes.get`                      |
| PATCH  | `/api/episodes/:episodeId`                       | `episodes.update`                   |
| DELETE | `/api/episodes/:episodeId`                       | `episodes.delete`                   |
| PUT    | `/api/projects/:projectId/episode-order`         | `episodes.reorder`                  |
| POST   | `/api/projects/:projectId/episodes/plan`         | `episodes.plan`                     |
| POST   | `/api/episodes/:episodeId/breakdown`             | `episodes.breakdown`                |
| POST   | `/api/episodes/:episodeId/entities`              | `episodes.extractEntities`          |
| POST   | `/api/episodes/:episodeId/shot-prompts`          | `episodes.generatePrompts`          |
| POST   | `/api/episodes/:episodeId/preflight`             | `episodes.preflight`                |
| POST   | `/api/episodes/:episodeId/compose`               | `episodes.compose`                  |
| GET    | `/api/episodes/:episodeId/artifacts`             | `episodes.artifacts`                |
| POST   | `/api/episodes/:episodeId/scenes`                | `scenes.create`                     |
| PATCH  | `/api/scenes/:sceneId`                           | `scenes.update`                     |
| DELETE | `/api/scenes/:sceneId`                           | `scenes.delete`                     |
| PUT    | `/api/episodes/:episodeId/scene-order`           | `scenes.reorder`                    |
| POST   | `/api/scenes/:sceneId/shots`                     | `shots.create`                      |
| GET    | `/api/shots/:shotId`                             | `shots.get`                         |
| PATCH  | `/api/shots/:shotId`                             | `shots.update`                      |
| DELETE | `/api/shots/:shotId`                             | `shots.delete`                      |
| PUT    | `/api/shots/:shotId/refs`                        | `shots.setRefs`                     |
| PUT    | `/api/scenes/:sceneId/shot-order`                | `shots.reorder`                     |
| POST   | `/api/shots/:shotId/move`                        | `shots.move`                        |
| PUT    | `/api/shots/:shotId/current-version`             | `shots.setCurrentVersion`           |
| POST   | `/api/shots/:shotId/image`                       | `shots.uploadImage` (multipart)     |
| GET    | `/api/projects/:projectId/assets`                | `assets.list`                       |
| POST   | `/api/projects/:projectId/assets`                | `assets.create`                     |
| GET    | `/api/assets/:assetId`                           | `assets.get`                        |
| PATCH  | `/api/assets/:assetId`                           | `assets.update`                     |
| DELETE | `/api/assets/:assetId`                           | `assets.delete`                     |
| POST   | `/api/assets/:assetId/originals`                 | `assets.uploadOriginal` (multipart) |
| POST   | `/api/assets/:assetId/sheet`                     | `assets.uploadSheet` (multipart)    |
| PUT    | `/api/assets/:assetId/sheet/current`             | `assets.setCurrentSheet`            |
| POST   | `/api/assets/:assetId/voice`                     | `assets.uploadVoice` (multipart)    |
| POST   | `/api/assets/:assetId/variants`                  | `variants.create`                   |
| PATCH  | `/api/assets/:assetId/variants/:variantName`     | `variants.update`                   |
| DELETE | `/api/assets/:assetId/variants/:variantName`     | `variants.delete`                   |
| GET    | `/api/projects/:projectId/candidates`            | `candidates.list`                   |
| POST   | `/api/candidates/:candidateId/accept`            | `candidates.accept`                 |
| POST   | `/api/candidates/:candidateId/link`              | `candidates.link`                   |
| POST   | `/api/candidates/:candidateId/ignore`            | `candidates.ignore`                 |
| POST   | `/api/candidates/:candidateId/undo-link`         | `candidates.undoLink`               |
| GET    | `/api/episodes/:episodeId/timeline`              | `timeline.get`                      |
| PUT    | `/api/episodes/:episodeId/timeline`              | `timeline.update`                   |
| POST   | `/api/episodes/:episodeId/timeline/rollback`     | `timeline.rollback`                 |
| POST   | `/api/episodes/:episodeId/timeline/sync`         | `timeline.sync`                     |
| POST   | `/api/episodes/:episodeId/timeline/bgm`          | `timeline.uploadBgm` (multipart)    |
| POST   | `/api/projects/:projectId/preflight`             | `generate.preflight`                |
| POST   | `/api/projects/:projectId/generate`              | `generate.submit`                   |
| GET    | `/api/jobs`                                      | `jobs.list`                         |
| GET    | `/api/jobs/:jobId`                               | `jobs.get`                          |
| POST   | `/api/jobs/:jobId/cancel`                        | `jobs.cancel`                       |
| POST   | `/api/jobs/:jobId/retry`                         | `jobs.retry`                        |
| POST   | `/api/jobs/:jobId/resume`                        | `jobs.resume`                       |
| POST   | `/api/jobs/:jobId/acknowledge`                   | `jobs.acknowledge`                  |
| POST   | `/api/import/legacy`                             | `import.legacy` (multipart)         |
| GET    | `/api/projects/:projectId/files/*`               | `file` (非 JSON)                    |
| GET    | `/api/episodes/:episodeId/export/srt`            | `srt` (非 JSON)                     |
| GET    | `/api/episodes/:episodeId/export/vtt`            | `vtt` (非 JSON)                     |
| GET    | `/api/episodes/:episodeId/export/package`        | `package` (非 JSON)                 |
| GET    | `/api/episodes/:episodeId/export/cut`            | `cut` (非 JSON)                     |
| GET    | `/api/events`                                    | `events` (非 JSON)                  |

multipart 上传的文件字段统一叫 `file`（`assets.uploadSheet` 可选 `variantName`；`import.legacy` 可选 `projectIds`、`allowDuplicate`）。
