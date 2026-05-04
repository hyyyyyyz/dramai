# Deployment

`dramai` 是纯静态站点，最推荐的部署方式是 **GitHub Pages**。本文也介绍其他常见
托管平台的配置要点。

## 1. GitHub Pages（默认）

仓库已经包含 `.github/workflows/deploy.yml`，会在每次 push 到 `main` 时自动构建
并发布到 `https://<user>.github.io/dramai/`。

### 一次性配置

1. 打开 **Settings → Pages**。
2. **Build and deployment → Source** 选择 `GitHub Actions`。
3. **Settings → Actions → General → Workflow permissions** 选择
   `Read and write permissions`（可选，但有些场景需要）。
4. 推一次代码，等待 Actions 完成（首次约 2-3 分钟）。

### 自定义域名

1. 在 `public/CNAME` 放上你的域名（例如 `dramai.example.com`）。
2. 在 Pages 设置里勾选 `Enforce HTTPS`。
3. 修改 `vite.config.ts`：

   ```ts
   export default defineConfig({
     base: '/', // 自定义根域名时无需子路径
     // ...
   })
   ```

### 子路径回退（SPA 路由刷新 404）

`deploy.yml` 已经把 `dist/index.html` 复制成 `dist/404.html`，这样在子路径下
直接刷新页面也能正确加载 SPA。

### `.nojekyll`

`deploy.yml` 也会创建空的 `dist/.nojekyll`，避免 GitHub Pages 把以下划线开头的
资源（如 `_app/`）误删。

## 2. Cloudflare Pages

1. 连接 GitHub 仓库。
2. 构建命令：`npm run build`，输出目录：`dist`。
3. 在 **Settings → Environment variables** 设置 `VITE_BASE=/`。
4. SPA 回退：在 `public/_redirects` 加 `/* /index.html 200`。

## 3. Vercel / Netlify

类似 Cloudflare Pages：构建 `npm run build` → 输出 `dist`。SPA 回退它们都内置。

## 4. 任意静态空间（nginx / OSS / S3）

```
npm run build
# 把 dist/ 整个上传，确保托管服务支持
#   - 路由 fallback：所有 404 返回 index.html
#   - 正确的 MIME 类型（特别是 .js / .mjs）
#   - HTTPS（很多浏览器 API、CORS 都要 HTTPS）
```

## 5. CORS 提示

浏览器直连 OpenAI 兼容 API 时，部分服务商会限制 CORS。已知 CORS-friendly 的
服务商示例见 [PROVIDERS.md](./PROVIDERS.md)。如果遇到 CORS 报错：

- 优先换一个支持 CORS 的服务商；
- 或者自建一个 1 文件的 Cloudflare Worker / Vercel Edge Function 做透传（v0.x 暂不内置）。

## 6. 验证部署成功

1. 打开 `https://<user>.github.io/dramai/`，能看到骨架页"`dramai · 浏览器内的
AI 短剧工作台`"。
2. F12 控制台无报错。
3. 在 v0.1 之后，进入 **Settings** 填入 OpenAI 兼容 base URL + key，点测试连接成功。
