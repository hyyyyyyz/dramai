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
演示 / 前端联调（不花钱）：仓库根 `pnpm demo`，见 `packages/mock-providers`。`createServer({ demo: { notice } })` 只影响 `/api/system` 的 `demo` 字段（让界面显示提示），服务端行为不变。

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

## 任务的目标（谁的任务）

`jobs.list` / `jobs.get` 的每个任务带结构化的 `target`（`@dramai/api` 的 `jobTarget`），`job.updated` 事件也带着，文案由前端按语言拼：

| `target.kind` | 字段                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shot`        | `shotId`、`shotIndex`（这一集里第几个，从 1 起）、`shotNumber`（项目内编号）、`shotTitle?`、`sceneId`、`episodeId`、`episodeNumber`、`episodeTitle` |
| `asset`       | `assetId`、`assetKind`、`name`、`variantName?`（衍生形态的设定图 / 编辑）                                                                           |
| `episode`     | `episodeId`、`episodeNumber`、`episodeTitle`（合成等整集任务）                                                                                      |
| `project`     | 分集规划等整个项目的任务                                                                                                                            |
| `removed`     | 目标已被删除（`entity`、`id`）——任务历史还在                                                                                                        |

名称 / 标题是用户自己填的，原样返回。

## 忽略结果（运行中的付费任务）

已发往服务商的调用无法撤回，所以运行中的付费任务不能取消，只能 `POST /api/jobs/:id/ignore-result`（`{ ignore?: boolean }`，缺省 `true`，`false` = 反悔）：

- 任务**照常跑完**，产物**照常保存进版本历史**（钱已经花了，不能丢）；
- 但**不自动成为当前版本**（槽的 `currentVersionId` 不动），也**不登记为当前产物**（产物状态保持原样）；
- 任务结束后 `result.ignored = true`、`resultIgnored = true`；运行期间 `ignoreResult: true` 表示“已标记，结束时生效”；
- 之后用户随时可以从版本历史里手动选用它（`shots.setCurrentVersion` / `assets.setCurrentSheet`）：它成为当前版本，产物记录用**这个版本自己的依据摘要**登记——依据和现在不一致就如实显示过期，不会因为被选中而冒充最新；
- 适用：运行中、产出媒体版本的付费任务（图 / 视频 / 配音 / 设定图）。排队中的任务（还没花钱）直接取消（`NOT_RUNNING`）；已结束的用选版本（`ALREADY_FINISHED`）；文本 / 合成任务没有这个概念（`NOT_APPLICABLE`）；
- 标记与落库的判断在同一个事务里，不会错过；重试 / 恢复原任务会清掉标记。极小的窗口：处理器已落库、任务状态还没改成 succeeded 的瞬间标记不会生效——此时 `result.ignored` 如实是 `false`。

## 参考图风格

`projects.setStyleReference`（multipart：`file`，可选 `label`）上传 / 替换项目的参考图风格：图片存在项目文件夹 `style/reference-<哈希>.<扩展名>`，`project.style` 变成 `{ source: 'reference_image', label, referenceFile }`；读取就是 `project.style.referenceFile.path` + 文件接口（`client.fileUrl`）。生成图片时它作为画风参考图传给模型；**图片内容的哈希是图片依据的一部分**——换了参考图，用它生成的图判为过期。

- 创建项目时不能直接选（还没有图）：先创建，再上传（`STYLE_REFERENCE_MISSING`）；
- `projects.update` 可传 `{ source: 'reference_image', label? }` 只改名称；换图再调一次上传；改成别的风格会删掉不再使用的参考图文件。

## 语言（内置数据中英两种）

风格预设、服务商预设的名称 / 备注 / 已知限制、项目里存的内置风格名（“未指定 / 自定义 / 风格参考图”）、演示模式提示语都有中英文（中文是源语言，缺翻译回退中文）。
**用户自己填写的内容永远原样返回**；只有和内置原文一致（没被改过）的文案才会被翻译——例如由预设创建的服务商，名称 / 备注 / 限制没改就按语言显示，改过的就是用户的文字。

请求用哪种语言：`?lang=en` 或请求头 `X-Dramai-Locale: en`（`createClient({ locale })`）→ 应用设置里的 `locale` → `Accept-Language` → 中文。画面关键词（`imageKeywords`）是提示词素材，不翻译。
受影响的接口：`styles.list`、`presets.list`、`providers.*`、`projects.*`（`style.label` / `style.description`）、`system.get`（`demo.notice`）。
没有翻译的：错误响应里的 `message`（前端按 `code` 展示自己的文案）、ffmpeg 缺失说明（`system.get.ffmpeg.missing`）。

## 找不到（`NOT_FOUND`）一律带实体

所有 404 `NOT_FOUND` 的 `details` 都是 `{ entity, id }`（`entity` 取值见 `@dramai/api` 的 `NOT_FOUND_ENTITIES`：`project / episode / scene / shot / asset / candidate / material / job / provider / provider_preset / variant / media_version / timeline_revision / timeline_clip / artifact / file / route`），界面据此显示“找不到这个镜头”之类的具体提示。有一条测试把所有带路径参数的接口用假 id 扫一遍，确保没有漏的。`route` 表示请求的路径本身不存在（`id` 是 `METHOD /path`）。

## 拆分镜头 / 规划分集时的创作者要求

- `episodes.breakdown` 的 `instructions`（≤1000 字，如“重点表现主角的心理变化”“每镜不超过 8 秒”）：进提示词的“创作者的额外要求”一节，并**记在集上**（`episode.breakdownInstructions`）。不传 = 沿用集上记的（重新拆分默认沿用）；传空字符串 = 清掉，这一次也不带。
- `episodes.update` 的 `breakdownInstructions` 可以只改这条要求而不重新拆分（`null` / 空 = 清掉）。
- 入队失败（比如没有可用的大模型）整个请求回滚，不会留下一条没用上的要求。
- `episodes.plan` 也接受 `instructions`（如“每集结尾留悬念”），**只对这一次有效、不记下来**：分集规划是按批次追加的，只处理还没规划的章节，一条持久的要求没有明确的作用对象。

## 镜头提示词：按部分补缺

`episodes.generatePrompts` 的 `onlyMissing` 按提示词的各部分分别判断：首帧（`prompts.keyFrame`）缺不缺、视频（`prompts.video`）缺不缺（尾帧是可选的，不算缺）。只缺视频提示词的镜头也会被补，**只写缺的那部分**，已有的（尤其是用户手改过的）原样保留。任务结果里 `shots` 是写了几个镜头、`filled: { image, video }` 是各部分补了几处。不带 `onlyMissing` 才整集重写。

## 用一句话修改设定图

`generate.preflight` / `generate.submit` 的目标 `asset_sheet` 带 `editInstruction`（可再加 `variantName` 改某个形态的图）= 图片编辑，不是重新生成：

- **以这个槽的当前图为唯一参考图、这句增量指令为唯一提示词**（不再带资产描述、画风、版式）；画幅沿用当前图；
- 新图成为当前版本（`source: 'image_edit'`），旧图留在版本历史；失败时什么都不改（落库在最后一步的同一个事务里）；
- 走和普通生成一样的准入 / 预检（只读预检、费用估算、能力核对）：没有当前图 → 预检原因 `SHEET_TO_EDIT_MISSING`；指令是空白 → `EDIT_INSTRUCTION_EMPTY`；模型没有图生图（或参考图）能力 → 能力检查给出的拒绝原因——都在入队前被拦下，什么都不会入队；
- 同一张设定图同一时刻只能有一个在途的修改（互斥键），两次修改都基于同一张当前图，同时跑会互相盖掉；
- 任务的 `target` 是 `{ kind: 'asset', …, edit: true }`，任务面板能区分“修改”和“生成”；可以被“忽略结果”。

## 过期产物“保持现状”

`artifacts.keep`（`{ key }`，`key` 取自产物清单如 `shot_video:<id>`）：用户看过过期提示，决定这件产物不用重新生成。服务端把它的记录按**当前**的依据与上游重新对齐（文件、版本不变）：它显示为 current，`keptAt` 标出“已按现状保留”，不再提示；之后它的依据或上游**再次变化**，会照常重新过期（`keptAt` 随之消失）。状态存在服务端（换浏览器也在）。不是过期状态 → 409 `ARTIFACT_NOT_STALE`（`details.status` 是当前状态）；`key` 不存在 → 404 `NOT_FOUND`（`entity: 'artifact'`）。下游不受影响（产物文件没变，下游看的是文件内容的哈希）。重新生成、或手动选用某个版本，会照常换掉这条记录。

## 角色的声线描述

角色资产多了 `voiceDescription`（文字描述，≤500 字，如“低沉沙哑的中年男声，语速慢”），和音色参考音频（`voiceRef`）并列。`assets.create` / `assets.update` 可写（`null` / 空白 = 清掉）；非角色写它 → 400 `VOICE_NOT_ALLOWED`。它只是创作备注，**不参与任何生成依据**（改它不会让任何产物过期）。

## 把镜头移到另一个场

`shots.move`（`{ toSceneId, index? }`）把镜头移到另一个场——也可以是同一项目里**另一集**的场；`index` 缺省 / 超界 = 放到最后；镜头保持自己的 id、编号和全部产物；来源场和目标场的顺序、两边的集状态一并更新。`shots.reorder` 只在**同一个场内**调整顺序（`order` 必须恰好是这个场现有的全部镜头），传了别的场的镜头会 400，错误里提示用 `shots.move`（`details.hint`）。

## 错误

响应统一是 `{ error: { code, message, details? } }`。**前端按 `code` 分支，不要按 `message`**。
完整、封闭的错误码表在 `@dramai/api` 的 `ERROR_CODES`（每个码固定的 HTTP 状态 + 说明）；测试保证服务端抛出的每个码都在表里、状态一致。
core 的业务错误是 `DomainError`（`code` + `kind`：not_found / conflict / invalid / precondition），服务端按 `kind` 映射状态码、`code` 原样透传，**不看文案**。

## 路由

契约在 `@dramai/api`（`routes`）。服务端用 `RouteRegistry.handle(name, fn)` 绑定：路径参数 / 查询 / 请求体按契约校验（400），处理函数返回值的类型就是契约响应类型；测试里 `validateResponses: true` 会把响应也按 schema 校验。

| 方法   | 路径                                             | 名称                                     |
| ------ | ------------------------------------------------ | ---------------------------------------- |
| GET    | `/api/system`                                    | `system.get`                             |
| GET    | `/api/settings`                                  | `settings.get`                           |
| PUT    | `/api/settings`                                  | `settings.update`                        |
| GET    | `/api/styles`                                    | `styles.list`                            |
| GET    | `/api/presets`                                   | `presets.list`                           |
| GET    | `/api/providers`                                 | `providers.list`                         |
| POST   | `/api/providers`                                 | `providers.create`                       |
| POST   | `/api/providers/from-preset`                     | `providers.fromPreset`                   |
| GET    | `/api/providers/:providerId`                     | `providers.get`                          |
| PATCH  | `/api/providers/:providerId`                     | `providers.update`                       |
| DELETE | `/api/providers/:providerId`                     | `providers.delete`                       |
| PUT    | `/api/providers/:providerId/key`                 | `providers.setKey`                       |
| DELETE | `/api/providers/:providerId/key`                 | `providers.clearKey`                     |
| POST   | `/api/providers/:providerId/test`                | `providers.test`                         |
| GET    | `/api/providers/:providerId/capability`          | `providers.capability`                   |
| PUT    | `/api/providers/:providerId/accepted-unverified` | `providers.acceptUnverified`             |
| GET    | `/api/projects`                                  | `projects.list`                          |
| POST   | `/api/projects`                                  | `projects.create`                        |
| GET    | `/api/projects/:projectId`                       | `projects.get`                           |
| PATCH  | `/api/projects/:projectId`                       | `projects.update`                        |
| DELETE | `/api/projects/:projectId`                       | `projects.delete`                        |
| POST   | `/api/projects/:projectId/restore`               | `projects.restore`                       |
| DELETE | `/api/projects/:projectId/purge`                 | `projects.purge`                         |
| POST   | `/api/projects/:projectId/style-reference`       | `projects.setStyleReference` (multipart) |
| GET    | `/api/projects/:projectId/artifacts`             | `projects.artifacts`                     |
| POST   | `/api/projects/:projectId/artifacts/keep`        | `artifacts.keep`                         |
| GET    | `/api/projects/:projectId/materials`             | `materials.list`                         |
| POST   | `/api/projects/:projectId/materials`             | `materials.upload` (multipart)           |
| GET    | `/api/materials/:materialId/text`                | `materials.text`                         |
| DELETE | `/api/materials/:materialId`                     | `materials.delete`                       |
| GET    | `/api/projects/:projectId/episodes`              | `episodes.list`                          |
| POST   | `/api/projects/:projectId/episodes`              | `episodes.create`                        |
| GET    | `/api/episodes/:episodeId`                       | `episodes.get`                           |
| PATCH  | `/api/episodes/:episodeId`                       | `episodes.update`                        |
| DELETE | `/api/episodes/:episodeId`                       | `episodes.delete`                        |
| PUT    | `/api/projects/:projectId/episode-order`         | `episodes.reorder`                       |
| POST   | `/api/projects/:projectId/episodes/plan`         | `episodes.plan`                          |
| POST   | `/api/episodes/:episodeId/breakdown`             | `episodes.breakdown`                     |
| POST   | `/api/episodes/:episodeId/entities`              | `episodes.extractEntities`               |
| POST   | `/api/episodes/:episodeId/shot-prompts`          | `episodes.generatePrompts`               |
| POST   | `/api/episodes/:episodeId/preflight`             | `episodes.preflight`                     |
| POST   | `/api/episodes/:episodeId/compose`               | `episodes.compose`                       |
| GET    | `/api/episodes/:episodeId/artifacts`             | `episodes.artifacts`                     |
| POST   | `/api/episodes/:episodeId/scenes`                | `scenes.create`                          |
| PATCH  | `/api/scenes/:sceneId`                           | `scenes.update`                          |
| DELETE | `/api/scenes/:sceneId`                           | `scenes.delete`                          |
| PUT    | `/api/episodes/:episodeId/scene-order`           | `scenes.reorder`                         |
| POST   | `/api/scenes/:sceneId/shots`                     | `shots.create`                           |
| GET    | `/api/shots/:shotId`                             | `shots.get`                              |
| PATCH  | `/api/shots/:shotId`                             | `shots.update`                           |
| DELETE | `/api/shots/:shotId`                             | `shots.delete`                           |
| PUT    | `/api/shots/:shotId/refs`                        | `shots.setRefs`                          |
| PUT    | `/api/scenes/:sceneId/shot-order`                | `shots.reorder`                          |
| POST   | `/api/shots/:shotId/move`                        | `shots.move`                             |
| PUT    | `/api/shots/:shotId/current-version`             | `shots.setCurrentVersion`                |
| POST   | `/api/shots/:shotId/image`                       | `shots.uploadImage` (multipart)          |
| GET    | `/api/projects/:projectId/assets`                | `assets.list`                            |
| POST   | `/api/projects/:projectId/assets`                | `assets.create`                          |
| GET    | `/api/assets/:assetId`                           | `assets.get`                             |
| PATCH  | `/api/assets/:assetId`                           | `assets.update`                          |
| DELETE | `/api/assets/:assetId`                           | `assets.delete`                          |
| POST   | `/api/assets/:assetId/originals`                 | `assets.uploadOriginal` (multipart)      |
| POST   | `/api/assets/:assetId/sheet`                     | `assets.uploadSheet` (multipart)         |
| PUT    | `/api/assets/:assetId/sheet/current`             | `assets.setCurrentSheet`                 |
| POST   | `/api/assets/:assetId/voice`                     | `assets.uploadVoice` (multipart)         |
| POST   | `/api/assets/:assetId/variants`                  | `variants.create`                        |
| PATCH  | `/api/assets/:assetId/variants/:variantName`     | `variants.update`                        |
| DELETE | `/api/assets/:assetId/variants/:variantName`     | `variants.delete`                        |
| GET    | `/api/projects/:projectId/candidates`            | `candidates.list`                        |
| POST   | `/api/candidates/:candidateId/accept`            | `candidates.accept`                      |
| POST   | `/api/candidates/:candidateId/link`              | `candidates.link`                        |
| POST   | `/api/candidates/:candidateId/ignore`            | `candidates.ignore`                      |
| POST   | `/api/candidates/:candidateId/undo-link`         | `candidates.undoLink`                    |
| GET    | `/api/episodes/:episodeId/timeline`              | `timeline.get`                           |
| PUT    | `/api/episodes/:episodeId/timeline`              | `timeline.update`                        |
| POST   | `/api/episodes/:episodeId/timeline/rollback`     | `timeline.rollback`                      |
| POST   | `/api/episodes/:episodeId/timeline/sync`         | `timeline.sync`                          |
| POST   | `/api/episodes/:episodeId/timeline/bgm`          | `timeline.uploadBgm` (multipart)         |
| POST   | `/api/projects/:projectId/preflight`             | `generate.preflight`                     |
| POST   | `/api/projects/:projectId/generate`              | `generate.submit`                        |
| GET    | `/api/jobs`                                      | `jobs.list`                              |
| GET    | `/api/jobs/:jobId`                               | `jobs.get`                               |
| POST   | `/api/jobs/:jobId/cancel`                        | `jobs.cancel`                            |
| POST   | `/api/jobs/:jobId/retry`                         | `jobs.retry`                             |
| POST   | `/api/jobs/:jobId/resume`                        | `jobs.resume`                            |
| POST   | `/api/jobs/:jobId/acknowledge`                   | `jobs.acknowledge`                       |
| POST   | `/api/jobs/:jobId/ignore-result`                 | `jobs.ignoreResult`                      |
| POST   | `/api/import/legacy`                             | `import.legacy` (multipart)              |
| GET    | `/api/projects/:projectId/files/*`               | `file` (非 JSON)                         |
| GET    | `/api/episodes/:episodeId/export/srt`            | `srt` (非 JSON)                          |
| GET    | `/api/episodes/:episodeId/export/vtt`            | `vtt` (非 JSON)                          |
| GET    | `/api/episodes/:episodeId/export/package`        | `package` (非 JSON)                      |
| GET    | `/api/episodes/:episodeId/export/cut`            | `cut` (非 JSON)                          |
| GET    | `/api/events`                                    | `events` (非 JSON)                       |

multipart 上传的文件字段统一叫 `file`（`assets.uploadSheet` 可选 `variantName`；`projects.setStyleReference` 可选 `label`；`import.legacy` 可选 `projectIds`、`allowDuplicate`）。
