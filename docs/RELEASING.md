# 发布流程

dramai 全仓使用**同一个版本号**。推送形如 `v0.5.0` 的 tag，GitHub Actions 就会核对版本、跑一遍 CI、在
macOS（Apple Silicon 和 Intel）与 Windows 上构建桌面安装包、生成校验和，然后创建 GitHub Release 并上传。

> 这份文档描述的工作流在 `.github/workflows/`。它们只有推送到 GitHub 之后才会运行；
> 第一次真正发布之前，请先按下面的“演练”跑一遍。

## 工作流一览

| 文件                  | 什么时候运行                                                         | 做什么                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`              | 推送到 `main` 或 `refactor/**`；任何拉取请求；手动；被发布工作流调用 | 版本一致性、格式、lint、类型检查（Linux）；测试（Linux Node 24 / Node 22.13、macOS、Windows）；构建；工作流静态检查（actionlint）；E2E（接入后）。汇总检查 `CI passed` |
| `release-desktop.yml` | 推送 `v*.*.*` tag；手动（只构建，不发布）                            | 核对 tag → 跑 CI → 构建三个平台的安装包 → 校验和 → 创建 Release                                                                                                        |
| `deploy.yml`          | 仅手动                                                               | 旧的 Pages 部署，已停用自动触发（原因写在文件头部），宣传页 `apps/site` 做好后换成它的部署                                                                             |
| `dependabot.yml`      | 每周                                                                 | 更新 GitHub Actions（固定到 SHA）和 npm 依赖，新版本先冷却 7 天                                                                                                        |

自定义的组合步骤在 `.github/actions/setup/`（安装 pnpm 和 Node、缓存 pnpm store、安装依赖）。

## 发一个正式版

1. **统一版本号**（在 `main` 最新代码上开一个分支）：

   ```bash
   pnpm version:set 0.5.0     # 全仓所有 package.json 改成 0.5.0；加 --dry-run 只预览
   ```

2. **写更新日志**：在 `CHANGELOG.md` 里把 `[Unreleased]` 下的内容整理成 `## [0.5.0] - 2026-12-20` 一节，
   并在文末补上 `[0.5.0]: https://github.com/hyyyyyyz/dramai/releases/tag/v0.5.0`。
   这一节会原样成为 Release 说明；**正式版没有这一节，发布会失败**。
3. **提交并合并到 `main`**（走拉取请求，等 `CI passed` 变绿）：`chore(release): v0.5.0`。
4. **打 tag 并推送**（在合并后的 `main` 上）：

   ```bash
   git switch main && git pull
   pnpm version:check --tag v0.5.0     # 本地先核对一次
   git tag v0.5.0
   git push origin v0.5.0
   ```

5. 在仓库的 **Actions → Release desktop** 看进度。全部通过后，Release 里有安装包、`SHA256SUMS.txt`，
   说明里有更新日志、校验方法和每个平台的签名状态。

正式版 tag 指向的提交必须在 `main` 上，否则工作流会失败并提示。

## 发一个预发布

tag 带后缀就是预发布，Release 会标成 Pre-release，也不会成为 “Latest”：

```bash
pnpm version:set 0.5.0-beta.1
git commit -am "chore(release): v0.5.0-beta.1"
git tag v0.5.0-beta.1 && git push origin HEAD v0.5.0-beta.1
```

- 预发布可以从任何分支打 tag（例如在重构分支上试发），不要求在 `main` 上。
- `CHANGELOG.md` 里有 `## [0.5.0-beta.1]` 就用它；没有则回退到 GitHub 自动生成的说明。

## 演练（不创建 Release）

**Actions → Release desktop → Run workflow**，选要试的分支。它会核对版本、跑 CI、构建全部平台，
安装包留在这次运行页面底部的 Artifacts 里（保留 7 天），**不会**创建 Release。第一次发布前、
以及改动了打包配置之后都建议这样跑一遍。

## 出了问题怎么办

| 情况                                                                  | 处理                                                                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 报 “Tag … is version X, but the repository is at Y”                   | tag 和包版本不一致。要么 `pnpm version:set X` 后提交并重新打 tag，要么删掉 tag 改用 `vY`                                                       |
| 报 “… is at "0.4.1", expected "0.5.0”（某个 package.json 的版本不对） | 有包的版本漂移了，`pnpm version:set <版本>` 一次性对齐                                                                                         |
| 报缺 CHANGELOG 小节                                                   | 补上 `## [<版本>]` 一节，提交后重新打 tag                                                                                                      |
| 构建失败（Release 还没创建）                                          | 修好后：同一提交可以在 Actions 里 “Re-run failed jobs”；要换提交就删 tag 重打（见下）                                                          |
| 上传到一半失败                                                        | Release 是**草稿**，用户看不到。重跑工作流会刷新草稿里的文件后再发布                                                                           |
| 已发布但发现有问题                                                    | 先把它变回草稿，用户就下载不到了：`gh release edit v0.5.0 --draft`。修复后再用新的补丁版本（`0.5.1`）发布                                      |
| 彻底撤回一个版本                                                      | `gh release delete v0.5.0 --cleanup-tag --yes`（同时删掉远端 tag），本地再 `git tag -d v0.5.0`。已经有人下载过的版本号不要复用，改发下一个版本 |
| 要删 tag 重打（从没公开过）                                           | `git push --delete origin v0.5.0 && git tag -d v0.5.0`，修复后重新 `git tag` 和 `git push`                                                     |

已发布的 Release 不会被工作流覆盖：对一个已发布的 tag 重跑会报错，需要先按上表撤回。

## 需要在 GitHub 上配置什么

工作流本身不需要任何必须配置的密钥——没有配置时安装包是**未签名**的，工作流会在日志里明确说明。
下面按“建议做”的顺序列出。

### 仓库设置（Settings）

1. **Actions → General → Workflow permissions**：保持默认的 “Read repository contents”。
   每个工作流都自己声明权限，只有发布 job 申请 `contents: write`。
2. **Actions → General → Actions permissions**：如果选了 “Allow select actions”，要允许
   GitHub 官方 action、`pnpm/action-setup@*`，以及 Dependabot 引入的其它 action。
3. **Rules → Rulesets（或 Branches）**：给 `main` 加保护——要求拉取请求、要求状态检查
   **`CI passed`** 通过。这是 `ci.yml` 里汇总所有 job 的那一个，只需要把它设为必需；被跳过的 job（比如 E2E 接入前）不算失败。
4. **Rules → Rulesets**：新建一个针对 tag `v*` 的规则，限制只有维护者能创建、更新、删除，
   防止误推或被人篡改已发布的版本 tag。
5. **Code security**：开启 Dependabot alerts / security updates，`.github/dependabot.yml` 会驱动版本更新。
6. **Pages**：Source 保持 “GitHub Actions”（旧部署手动运行时用；宣传页上线后继续沿用）。
7. （可选）**Environments**：新建 `release` 环境并设置必需审批人，然后在 `release-desktop.yml` 的 `release` job
   里加一行 `environment: release`，发布前就需要人工点一下确认。

### 仓库变量（Settings → Secrets and variables → Actions → Variables）

| 变量                   | 作用                                                    |
| ---------------------- | ------------------------------------------------------- |
| `DRAMAI_RELEASE_LINUX` | 设为 `true` 时，发布也构建 Linux x64 安装包。默认不构建 |

### 密钥（Secrets，全部可选）

没有配置时对应平台的安装包不签名，其余流程照常。名字对应 electron-builder 的环境变量
（`CSC_LINK`、`CSC_KEY_PASSWORD`、`WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`、`APPLE_ID`、
`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`），由工作流在构建前映射。

| 密钥                           | 内容                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `MACOS_CERTIFICATE`            | “Developer ID Application” 证书导出的 `.p12`，做 base64：`base64 -i cert.p12 \| pbcopy` |
| `MACOS_CERTIFICATE_PASSWORD`   | 导出 `.p12` 时设的密码                                                                  |
| `APPLE_ID`                     | Apple ID 邮箱（公证用）                                                                 |
| `APPLE_APP_SPECIFIC_PASSWORD`  | 在 appleid.apple.com 生成的 App 专用密码（公证用）                                      |
| `APPLE_TEAM_ID`                | 开发者团队 ID（公证用）                                                                 |
| `WINDOWS_CERTIFICATE`          | 代码签名证书 `.pfx` 的 base64                                                           |
| `WINDOWS_CERTIFICATE_PASSWORD` | 证书密码                                                                                |

macOS 签名和公证必须同时配置证书和三个 `APPLE_*`，只配证书得到的是“已签名但未公证”的包，Gatekeeper 仍会警告。
需要 Apple 开发者账号（每年 99 美元）和 Windows 代码签名证书，见 `REFACTOR_PLAN.md` 的“需要用户决定或提供的”。

## 版本工具

位置 `tooling/release/`（`@dramai/release-tools`），零依赖，只用 Node 内置模块。

```bash
pnpm version:set 0.5.0                  # 改全仓所有 package.json（根、apps、packages、tooling）
pnpm version:set 0.5.0 --dry-run        # 只预览
pnpm version:check                      # 所有包版本一致且是合法 semver
pnpm version:check --tag v0.5.0         # 同时要求 tag 对应仓库版本
```

- 只改 `package.json` 里顶层的那一行 `"version"`，其余格式不动。
- CI 的 `checks` job 每次都会跑 `version:check`；发布工作流还会带上 tag 再核对一次。
- 版本号出现在别的地方（比如界面里的版本显示）应该从 `package.json` 读取，而不是再写一份常量。

## 约定与假设

发布工作流依赖 `desktop` 会话交付的东西，约定见 `REFACTOR_PLAN.md`“阶段 6 的调整”：

- `pnpm desktop:dist` 打包当前平台，产物在 `apps/desktop/release/`，不自行发布（工作流不提供 `GH_TOKEN`）。
- 安装包命名 `dramai-<版本>-<系统>-<架构>.<扩展名>`，例如 `dramai-0.5.0-mac-arm64.dmg`、
  `dramai-0.5.0-beta.1-win-x64.exe`。“系统”目前接受 `mac|macos|darwin`、`win|windows`、`linux`，
  扩展名接受 `dmg zip exe msi AppImage deb rpm tar.gz`；不符合的文件不会上传，日志里会有警告。
- 自动更新用的 `latest*.yml` 和 `.blockmap` 目前**不上传**（两个 macOS 架构会产生同名的 `latest-mac.yml`，
  需要先决定怎么合并）。做自动更新时再扩展 `tooling/release/src/assets.ts` 和 `release-desktop.yml`。

## E2E 接入约定

`ci.yml` 里已经有 `E2E (browser)` 这个 job，现在没有 `test:e2e` 脚本所以会空过。前端会话交付端到端测试时，需要提供：

1. 根 `package.json` 里的 **`test:e2e`** 脚本：自己准备好所需的一切（构建、启动服务——建议用 `@dramai/mock-providers`
   的演示模式，不要用真实 Key——并运行测试），失败时以非零码退出。CI 里就是 `pnpm test:e2e`。
2. **Playwright** 作为 `@dramai/workspace` 的 devDependency（CI 会执行
   `pnpm --filter @dramai/workspace exec playwright install --with-deps chromium`）。
   用别的框架的话，需要同时改这一步。
3. 报告输出到 `playwright-report/` 和 `test-results/`（已在 `.gitignore`），失败时 CI 会把它们作为 Artifact 上传。
4. 只依赖 Linux + Chromium，不需要额外密钥。

脚本一合并，这个 job 就自动开始真正运行，并计入 `CI passed`。
