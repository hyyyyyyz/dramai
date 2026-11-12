# @dramai/workspace

工作台前端（SPA）：WebUI 和 Desktop 共用。**只负责界面**——所有数据和动作都通过 HTTP 和 SSE 交给本地服务（`@dramai/server`）。
只依赖 `@dramai/api`（契约、类型化客户端、事件类型）和 `@dramai/ui/v2`（设计系统），不 import 服务端或 core 的代码。

## 开发循环

```bash
pnpm dev                 # 本地服务（正式，数据目录 ~/.dramai-dev）+ vite（http://localhost:5173），/api 已代理到服务
pnpm dev:demo --fresh    # 演示模式：服务商是本机的模拟服务，不花钱；--fresh 清空演示数据
pnpm dev:demo --fail-rate 0.3 --fail-kinds rate_limit,upstream_failed   # 选项原样交给 pnpm demo
```

- `scripts/dev.mjs` 先起服务、等 `/api/health` 通了再起 vite；任何一个退出，另一个一起停。
- 服务地址默认 `http://127.0.0.1:8787`，用 `PORT` 或 `DRAMAI_API` 覆盖。
- vite 的代理不改 Host / Origin：服务端按同源校验写请求，原样转发即可。

## 演示模式（不花钱、可练故障）

`GET /api/system` 报告 `demo.active` 时，界面顶部有一条**不能关掉**的横幅。故障怎么注入、怎么让界面进入失败 / 限流 / “提交结果待确认”等状态，见 `packages/mock-providers/README.md`。常用的：

```bash
curl -X PUT  localhost:8788/__mock/config -H 'content-type: application/json' -d '{"streamChunkMs":500}'            # 让流式文本慢下来
curl -X POST localhost:8788/__mock/rules  -H 'content-type: application/json' -d '{"fault":"drop_connection","on":"image","times":1}'   # → 提交结果待确认
curl -X POST localhost:8788/__mock/rules  -H 'content-type: application/json' -d '{"fault":"poll_error","on":"video","times":1}'        # → 可恢复原任务
curl -X POST localhost:8788/__mock/heal                                                                                 # 上游恢复
```

## 构建后的应用

```bash
pnpm build                                   # 产出 packages/workspace/dist（根路径托管，base = '/'）
pnpm demo --static-dir "$PWD/packages/workspace/dist"   # 注意：--static-dir 相对路径是按 packages/mock-providers 解析的，给绝对路径
pnpm webui                                   # 或用启动器（见 apps/webui）
```

## 结构

```
src/
  app/          入口、路由（router.tsx）、QueryClient
  data/         api-context / queries（每个接口一个 hook）、keys（查询键）、
                events（SSE 事件 → 缓存失效 / 瞬时状态）、errors（按错误码分支）、current-episode
  i18n/         zh-CN 与 en 两套文案（locales/*），format.ts（日期 / 数字 / 时长 / 金额按语言格式化）
  layout/       外框、侧栏、顶栏、集切换器、演示横幅、服务状态
  features/     projects / overview / materials / settings / jobs（任务面板）/ placeholders / common
  lib/          主题、媒体查询、小工具
tests/          vitest + Testing Library（数据层、事件重连与 resync、任务面板、i18n 完整性、应用外壳）
```

## 约定

- **每个服务调用都走类型化客户端**；服务端状态用 TanStack Query 缓存，**SSE 只负责让缓存失效**（规则见 `packages/server/README.md`：事件只是提示，`resync` 或 epoch 变了就整体失效重取）。
- **错误按 `code` 处理，不看 `message`**：`data/errors.ts` + `features/common/use-error-text.ts`，每个错误码在两种语言里都有文案（测试保证）。
- **文案全部走 i18n**，zh-CN 是类型来源；en 的键、占位符、复数由 `tests/i18n.test.ts` 逐项核对，英文里不允许出现汉字和全角标点。
- 样式只用 `@dramai/ui/v2` 的语义 token；不要同时加载旧的 `@dramai/ui` 根入口。
- 表单的校验错误只在用户尝试提交（或改过之后）才出现，对话框刚打开时不能是一片红。

## 脚本

`pnpm --filter @dramai/workspace` 下：`dev` / `dev:web` / `build` / `typecheck` / `lint` / `test` / `e2e`（`e2e` 见下一节）。

## Pages, code splitting and end-to-end tests (3C)

- Pages added in 3C: compose (`features/compose`: four-track timeline, clip inspector, issues with an action each,
  revisions with rollback, narration voice generation, render options, in-browser preview), export
  (`features/export`), settings general / access / data / about (`features/settings`), project delete with trash and
  restore, and legacy backup import.
- Every page is a route-level lazy chunk (`src/app/router.tsx`); only the shell and the 404 page ship in the main
  chunk. Fonts are emitted as files (`assetsInlineLimit: 0`) because the server's CSP only allows same-origin
  resources.
- `src/components/overlay.tsx` wraps the design system's `Modal` / `Drawer` so that `onClose` has a stable identity;
  otherwise focus is not returned to the trigger after the dialog closes. Dialogs must mark their first field with
  `data-autofocus`, never React's `autoFocus`.
- End-to-end tests live in `e2e/` and run against demo mode: `pnpm e2e` from the repo root (see `e2e/README.md` for
  coverage, the browser install step and what CI needs). Run `pnpm exec playwright install chromium` the first time and
  again after any Playwright version change in the lockfile, otherwise the browser is missing; `pnpm e2e` checks for
  this and stops with a clear message.
