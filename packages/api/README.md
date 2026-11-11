# @dramai/api

前端和本地服务之间的契约：请求 / 响应的 zod schema、SSE 事件类型、带类型的客户端。

- **不依赖**服务端或 core 的任何代码，浏览器和 Node 都能用；只依赖 `zod`。
- 路由契约在 `src/routes.ts`（`routes`），文件类路由在 `fileRoutes`。
- `createClient({ baseUrl?, token?, fetch? })`：
  - `client.call('projects.list')`、`client.call('shots.update', { params: { shotId }, body: { … } })`——路径参数、查询、请求体、响应全部有类型；上传用 `{ params, form }`。
  - `client.fileUrl(projectId, fileRef.path)` / `client.exportUrl('package', episodeId)`：给 `<img>` `<video>` `<audio>` `<a download>` 用，支持 Range。
  - `client.connectEvents({ onEvent, onResync })`：SSE，断线自动重连（带 `Last-Event-ID`）；收到 `onResync` 就让所有查询失效重取。
- 构建：`pnpm build` 产出 `dist/`（运行时入口）；`exports` 的 `types` 指向 `src/`，开发时的 `dramai-source` 条件直接用源码。
