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

## Provider authentication, OpenAI account sign-in, preset verification (English)

**Auth methods.** A provider config has `auth`: `api_key` (the key is in the `SecretStore` under `secretRef`), `account_login` (`{ channel: 'openai-chatgpt' }`; the login record is in the `SecretStore` under `secretRef`), or `none` (local models). Data saved before the field existed is read as `api_key` when it has a key and `none` otherwise (`effectiveAuth`); nothing is rewritten until the user saves, so an old database keeps working (`test/provider-login.test.ts`, "old data keeps working"). The API always returns the effective `auth`. Credentials are resolved in one place before every request (`authFor` / `CredentialResolver`); login tokens are refreshed when they are within two minutes of expiry, concurrent refreshes for one provider send one request, and a refresh token the server no longer accepts becomes a `LOGIN_REQUIRED` error (status `needs_relogin`), not a network error.

**`openai-responses` (text, streamed).** `POST {baseUrl}/responses` with an API key or the sign-in token. System messages go to `instructions`, `store` is always `false`, JSON mode is `text.format = json_object` (the existing parse–validate–retry loop in `llmJson` sits on top, so JSON steps behave as before). With account sign-in the fields the official documentation says are not accepted (`temperature`, `top_p`, `max_output_tokens`) are dropped and logged by name (`[llm] dropped unsupported parameters`). Only `response.completed` is success; `response.failed` (including `subscription_sharing_usage_limit_exceeded`, which can arrive mid-stream), `response.incomplete`, `error` events and a stream that ends early all fail with a stable `code`.

**OpenAI account sign-in** (`providers.login.*`), implemented from the official documentation only (`developers.openai.com/siwc`). It uses only the public `https://api.openai.com/v1`; it never calls ChatGPT back-end endpoints or borrows another client's identity.

- `POST /api/providers/:id/login/start` returns the address to open in the browser; the callback is received by a temporary listener on `127.0.0.1` (port 1455 first, any free port otherwise; only `GET /auth/callback` with its own `Host`). It is closed when the sign-in finishes, fails, is cancelled or times out (10 minutes).
- `GET …/login` is the status: `signed_out` / `pending` / `signed_in` / `needs_relogin`, the account label (email), expiry, `planUsage`, the last error code, and `availability`. **No token is ever in a response or a log**; the authorization address carries `login_hint`, never `id_token_hint`.
- `POST …/login/cancel`, and `POST …/login/logout` (revokes the refresh token at the documented endpoint, retried; `revoked: 'unconfirmed'` is returned honestly when revocation could not be confirmed; local tokens are cleared either way and the registration is kept). Deleting the provider signs out first.
- First sign-in registers the client (`client_id=dynamic_agent_client`, `agent_name_hint=dramai`, a stable `urn:uuid:` `ext_agent_host_id`), saves the issued `client_id`, and later sign-ins reuse it; no client secret. PKCE `S256`, fresh `state`/`nonce`/verifier each time. The callback is checked state-first; the ID token's RS256 signature (JWKS), issuer, audience, expiry and nonce are verified with `node:crypto`; plan usage is enabled only if the granted scopes include `chatgpt.tokens.use.direct`. Re-authorization (the default when the provider has a registration) must return the same account; `{ account: 'new' }` registers again and revokes the old refresh token only after the new sign-in succeeded.
- **Fixed endpoint.** A sign-in provider can only be `openai-responses` at exactly `https://api.openai.com/v1` (normalized; no user info, port or query string). `providers.create` and `providers.update` refuse anything else (`AUTH_NOT_ALLOWED`), and the check is repeated before the token is read (`LOGIN_ENDPOINT_NOT_ALLOWED`), so stored data cannot send the token elsewhere. "Only the public API" is enforced in code, not by convention.
- **Forged callbacks.** A callback whose `state` does not match is answered with 400 and ignored: it does not end the login (any web page can send a GET to `127.0.0.1`). Every other failure ends the attempt. Cancelling or timing out while the code exchange is in flight discards the result: no credentials are saved.
- **Keys and tokens.** The ID token is verified and then not kept (only the access and refresh tokens are stored). The JWKS address and the revocation endpoint come from the discovery document (cached; the issuer must match and the address must be https on the issuer's origin), with the documented addresses as fallback. A refresh refusal that is neither temporary nor in the documented list (`LOGIN_REFRESH_REJECTED`, or `invalid_client`) keeps the credentials but reports `lastError.code = 'refresh_rejected'` ("signing in again may help").
- `providers.clearKey` leaves `auth: api_key` with no key; `none` only appears when chosen explicitly.
- **Another machine.** The authorization callback goes to `127.0.0.1` of the machine running the browser. If the request comes from another host, `availability.available` is `false` (`reason: 'remote_access'`) and `login/start` answers `409 LOGIN_UNAVAILABLE_REMOTE`. The official self-hosted page describes signing in on the machine with the browser and copying the saved credential file to the remote one over a secure channel; dramai does not offer credential import yet, so remote users should use an API key. The check is by `Host` header and peer address; an SSH port forward looks local and is not detected.
- `GET /api/providers/:id/models` lists usable models (`visibility == "list"` for sign-in, standard `data[]` for API keys).

**Preset verification.** Every preset carries `verification`: `{ status: 'tested', testedAt }` or `{ status: 'documented', source }` (connected from official documentation, not tested). Documented presets never become the current choice automatically. The four v0.4 presets stay `tested` (2026-05-04). The OpenAI preset (`openai-responses-login`) is `documented`, text only, and its limitations say so.

## Creating a provider from a preset in one step (English)

`providers.fromPreset({ presetId, apiKey?, label?, baseUrl?, model? })` creates the provider with the address and model already filled in. The effective address (override or the preset's own) is validated before anything is stored, and every failure is a 400:

- `BASE_URL_PLACEHOLDER_UNFILLED`: a `{placeholder}` such as `{WorkspaceId}` is still in the address (`details.placeholders`). Presets with placeholders must be created with a complete `baseUrl`.
- `BASE_URL_INVALID`: not a URL, not `http`/`https`, user name or password in it, or whitespace.
- `BASE_URL_INSECURE`: plain `http` is only accepted for this machine and the local network (loopback, private IPv4 ranges incl. 100.64.0.0/10, IPv6 `fc`/`fd`/`fe80`, `*.local` / `*.lan` / `*.internal`, single-label host names); everything else needs `https`.
- `BASE_URL_NOT_OVERRIDABLE`: account-login presets pin their address; only `model` may be overridden.

`providers.test` failures also carry a machine-readable `code` (the same set job failures use: Anthropic `error.type`, Gemini `error.status`, `HTTP_<status>`, `NETWORK`, `TIMEOUT`, `LOGIN_REQUIRED`, ...) next to the unchanged `error` string. `providers.login.logout` always carries `manageUrl` when there is something to invalidate (OpenRouter), because the key is gone from the status once logout has run. Preset `label` / `notes` / `knownLimitations` are localized (`en`, `zh-Hant`) both in `presets.list` and in provider configs made from presets, as long as the user has not edited the text.

## Text providers, dialect options and OpenRouter sign-in (English)

**Protocols.** Text providers use one of `openai-chat`, `openai-responses`, `anthropic-messages` (`POST /v1/messages`, `x-api-key` + `Authorization`, `anthropic-version`, `max_tokens` always set, no temperature/top_p) and `gemini-chat` (`:streamGenerateContent?alt=sse`, `x-goog-api-key`; the official reference does not describe the stream format, so a plain JSON array is accepted too). All stream; all fail on interruption, error events, blocked output and an empty output cut by the length limit (`EMPTY_OUTPUT_TRUNCATED`). Model lists and connection tests are per protocol (`providers.models`; image, video and speech protocols answer `MODEL_LIST_UNSUPPORTED`).

**Dialect.** A provider config carries `dialect` (copied from the preset, editable through `providers.create/update`): `extraBody` (deep-merged into the request body; cannot replace `model`, `messages`, `input`, `contents`, `stream`, `store`) — presets use it to switch thinking off where a model thinks by default and the docs allow it; `maxTokensField` (`max_tokens` or `max_completion_tokens`); `jsonMode` (`json_object`, or `prompt_only` for services without `response_format`). `openai-chat` ignores `reasoning_content` / `reasoning` / `reasoning_details`, reads array `content` (Mistral) and skips SSE comment lines; `<think>…</think>` inlined in content is stripped.

**Presets.** `vendor` (grouping, localized name), `region` (`cn` / `global` / `local`), `baseUrlPlaceholders`, `dialect`, `auth`, `verification`. The fifteen text presets added in this batch are all "documented" (official source, not tested) and never auto-selected; local models (Ollama, LM Studio) use `auth: none`.

**OpenRouter sign-in** (`channel: 'openrouter'`, same `providers.login.*` routes). From the official OAuth page: no registration or secret; `callback_url` is `http://localhost:<port>/callback` (the only form the docs mention; the listener also binds `::1`); PKCE `S256`; the code is exchanged at `POST /api/v1/auth/keys` and the response is the user's own API key, stored in the `SecretStore` and used as a plain Bearer (provider pinned to `https://openrouter.ai/api/v1`, `openai-chat`). There is no refresh and no revocation endpoint: logout clears the local key and answers `revoked: 'unconfirmed'` with `manageUrl`, the official key page (`/keys/<SHA-256 of the key>`). A denial carries no `state`, so it is ignored like any request with the wrong state and the attempt waits for the timeout or cancel. Login status is generic: `credential: { kind: 'api_key', mask }` and `manageUrl` replace OpenAI's account label, expiry and `planUsage`.

## Image providers (English)

Image protocols: `openai-images` (writing chosen by model name: `gpt-image*` / `chatgpt-image*` follow the official OpenAI reference — no `response_format`, no `negative_prompt`, references through `POST /images/edits` as multipart `image[]`; `MiniMax-H3-Image*` use `/images/edits` with JSON `images[{image_url}]`; every other name keeps the original compat request unchanged, which the tested 302.AI Seedream preset relies on), `gemini-image` (Google's official address gets only `x-goog-api-key`), and new `volcengine-images` (Seedream direct: `image` as data URIs, watermark off, no `n`, size scaled up to the model minimum), `dashscope-image` (Qwen-Image, synchronous, `W*H` size, exactly one text, prompt rewriting off), `siliconflow-images` (`images[].url`, `image_size`, one reference in the model's field) and `kling-image` (generations and Omni, submit + poll, bare-base64 references, up to 10). A generation downloads its result as soon as it succeeds (result URLs live from one hour to 30 days); the URL is checkpointed first, so a restart resumes the download.

The eight image presets are "documented" (official source, not tested), never auto-selected, with vendor and region. Their model profiles mark every capability unverified and carry the officially claimed reference-image limit; prices are the official USD per image where the page gives one, otherwise empty. Not done and why: BFL FLUX (the official reference does not say whether `input_image` accepts base64, and we only have local files), fal (per-model schemas and the failure states are not documented on the pages read), BytePlus (the official page body could not be read), Replicate / Stability / Ideogram / ComfyUI (out of scope for this round).

## 安全（计划 4.2）

- 默认只监听 `127.0.0.1`；非回环地址没有 token 直接拒绝启动。
- **Host 头校验**（防 DNS rebinding）：只放行 `localhost` / `*.localhost` / 回环 IP / 配置的 `allowedHosts`；其他 IP 字面量仅在启用 token 时放行。
- **不开 CORS**：不发任何 `Access-Control-*`；写请求和 SSE 的 `Origin` 必须与 `Host` 同源，`Sec-Fetch-Site: cross-site` 一律拒绝。
- token：`Authorization: Bearer`、`X-Dramai-Token`，或 HttpOnly + SameSite=Strict 的 cookie（`/?token=…` 引导后 303 跳转去掉 token）。常数时间比较，至少 16 字符。`/api/health` 免 token（仍需过 Host 校验）。
- 请求体上限：JSON 8MB，multipart 1GB。
- 项目文件下载：路径严格限制在项目文件夹内；`nosniff`、`default-src 'none'; sandbox`；只有图片 / 视频 / 音频内联，其余强制 attachment。

### Content-Security-Policy of the hosted frontend (English)

`index.html` served from `staticDir` carries the policy in [`src/http/csp.ts`](src/http/csp.ts) (`APP_CSP`); other static assets and every API response get no page policy. Each directive is the narrowest value the built frontend needs:

| Directive                                                     | Value                                     | Why                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default-src`                                                 | `'self'`                                  | Everything not listed below is same-origin only.                                                                                                                                                                 |
| `script-src`                                                  | `'self'`                                  | Only the bundled scripts. No `'unsafe-inline'`, no `'unsafe-eval'` — `@dramai/api` switches zod to its non-`eval` mode in browsers (`z.config({ jitless: true })`), because zod's JIT probes `new Function('')`. |
| `style-src`                                                   | `'self' 'unsafe-inline'`                  | The UI library injects inline styles at runtime. Styles cannot run code.                                                                                                                                         |
| `font-src`                                                    | `'self' data:`                            | Self-hosted font files, and fonts the bundler inlines as `data:` URLs when they are small.                                                                                                                       |
| `img-src`                                                     | `'self' data: blob:`                      | Project images are served by this server; `data:` for inlined icons; `blob:` for previews of files the user just picked.                                                                                         |
| `media-src`                                                   | `'self' blob:`                            | Project video/audio come from this server (Range requests).                                                                                                                                                      |
| `connect-src`                                                 | `'self'`                                  | The JSON API and the SSE event stream are same-origin. Nothing can talk to a third-party host.                                                                                                                   |
| `object-src` / `base-uri` / `form-action` / `frame-ancestors` | `'none'` / `'self'` / `'self'` / `'none'` | No plugins, no `<base>` hijacking, no cross-site form posts, cannot be framed.                                                                                                                                   |

`test/csp.test.ts` keeps this honest: it reads the **built** frontend (`packages/workspace/dist`, built on demand), checks that every script, stylesheet, font, image, and `fetch`/`EventSource` target it references is allowed by the policy, that the policy has no directive the build does not need, and — when Playwright's Chromium is installed — loads the page in a real browser and fails on any `securitypolicyviolation`.

### Windows notes (English)

The server runs on Windows, macOS and Linux; the test suite is run on all three in CI. What was made portable, and how it is tested on any machine (`test/files.test.ts`, `test/static.test.ts`, and core's `test/windows.test.ts`):

- **Project file paths.** `FsFileStore.resolve` rejects, on every platform, anything Windows would read differently: drive letters and UNC (`C:/…`, `//server/…`), alternate data streams (`a.txt:stream`), `< > " | ? *`, control characters, segments ending in a dot or space, and device names (`CON`, `nul.txt`, `COM1`, …). A project folder therefore stays valid when copied between systems, and a path that is harmless on macOS cannot be an attack on Windows.
- **Static hosting.** A request path containing a backslash, a colon or NUL never maps to a file (it may still fall back to `index.html` as an app route).
- **Busy files.** On Windows an antivirus scan or indexer can hold a file open for a moment, which makes `rename`/`unlink` fail with `EBUSY`/`EPERM`. Atomic writes, the secrets file, the data-directory lock, and project removal retry briefly; other errors surface immediately.
- **Line endings and encodings** are handled in `@dramai/core`: bundled prompts, styles and model files read the same with CRLF line endings or a UTF-8 BOM; uploaded `.txt` files in GBK/GB18030, Big5 or UTF-16 are decoded instead of turning into mojibake.

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

**Languages (English).** The built-in data exists in three locales: `zh` (Simplified Chinese, the source language and the default), `zh-Hant` (Traditional Chinese, Taiwan wording — translated, not converted character by character: 影格 not 帧, 底片 not 胶片, 短影音 not 短视频, 賽博龐克 not 赛博朋克), and `en`. Request locale is chosen as: `?lang=` / `X-Dramai-Locale` → the `locale` app setting → `Accept-Language` → `zh`. `zh-TW`, `zh-HK` and `zh-Hant-*` select `zh-Hant`; `zh-CN` / `zh-Hans-*` select `zh`. A missing translation falls back to Simplified Chinese, so a locale can be filled in gradually. User-written text is always returned as written; only built-in text that is still unchanged is translated.
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

## Review fixes for the image/text provider batch (English)

- **Extra headers** (`dialect.extraHeaders`) now apply to every provider kind: text protocols merge them in their request builders, the executor merges them into the submit and poll requests of every media protocol (image, video, speech), and the connection test and model list send them too. Result downloads never get them (the result host is usually another host). The protected list (case-insensitive): `Authorization`, `Proxy-Authorization`, `Cookie`, `X-Api-Key`, `X-Goog-Api-Key`, `X-Key`, `Api-Key`, `Content-Type`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Host`, `Anthropic-Version`.
- **Minimum image size**: `ModelCapability.minPixels`, applied in `resolveOutputSize` (keeps the ratio and the step, stays under the ceilings; a floor above the ceiling is an error). The Seedream in-protocol scale-up remains only as the fallback for models without a profile.
- **Image style** (`dialect.imageStyle`: `auto` | `openai` | `compat` | `minimax`) for the `openai-images` protocol; `auto` strips vendor prefixes (`openai/gpt-image-1`) and decides from the last path segment.
- **Polling**: a response with no task state but an explicit error (`{ code: non-zero, message }`, `{ output: { code, message } }`, `{ error }`) fails the task at once instead of waiting for the poll timeout.
- **Base URL** rules are checked on `providers.create`, `providers.fromPreset` and on `providers.update` when the address changes (never when stored rows are read): http(s) only, no query string or fragment, no placeholder (also percent-encoded), plain http only to this machine or the local network, never to link-local addresses (`169.254.0.0/16`, `fe80::/10`).

## Video providers (P3c, English)

- **Protocols**: `ark-video` (Volcengine Ark Seedance and BytePlus ModelArk, `content[]` with `first_frame` / `last_frame` / `reference_image` roles), `kling-contents` (Kling 4.0 / 4.0 Flash: `text-to-video`, `image-to-video` or `omni-video` by task type, `contents[]` + `settings` + `options`, polling `GET /tasks?task_ids=`), `dashscope-video` (Wan 3.0 `input.media[]`, native DashScope path). The four legacy video protocols and the tested 302.AI Wan Flash preset are unchanged (pinned by a golden file generated from `b06d198`).
- **Reference images** are a task parameter, `videoRefs` (default off): the shot's character/scene/prop sheets go to the model together with the shot image. Where the official docs make first frame and references mutually exclusive (Seedance, Wan 3.0) the shot image becomes reference no. 1 and the strict first frame is given up; the preflight verdict's `video` field (`frame`, `ifRefsOn`, ...) tells the UI; asking for references on a provider that cannot send them (the four first-frame-only legacy protocols, or a profile saying unsupported) is always blocked with `REFERENCE_NOT_SUPPORTED`. The version records what was used (`usedReferences`), which does not make the video stale when a sheet changes (known gap).
- **Native audio**: composing always uses each clip's own timeline volume. A timeline clip gets volume 0 as its _default_ when its video was generated without native voice and the model's capability says it cannot switch audio off (`audioToggle: unsupported`, Kling 4.0) - decided when the clip is created, or the first time its shot gets a generated video (one `agent` revision, announced as a `timeline` data change). A clip that already had a video, or whose volume was ever changed by the user, is never touched; the user can raise it.
- Protocol errors keep their stable upstream codes (`KLING_<code>`, Ark/DashScope codes such as `InputImageSensitiveContentDetected.PrivacyInformation`, `DataInspectionFailed`).
