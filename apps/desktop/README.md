# @dramai/desktop

Dramai 桌面应用：一个 Electron 壳，里面跑的就是 `@dramai/server`（同一个本地服务），窗口加载同一份前端（`@dramai/workspace`）。

两种形态：

| 形态             | 命令                             | 给谁                                     |
| ---------------- | -------------------------------- | ---------------------------------------- |
| 从源码运行       | `pnpm desktop:dev`               | 开发者、想跑最新代码的人；前端改动热更新 |
| 打包（带版本号） | `pnpm desktop:dist` → `release/` | 普通用户；CI 在打 `v*` tag 时构建并上传  |

## 架构

```
┌──────────────────────── Electron 主进程 ─────────────────────────┐
│ 窗口 / 菜单 / 原生对话框 / 通知 / 单实例 / 更新检查               │
│ 保险箱 SecretVault（safeStorage 加密 API Key，落盘 secrets.json） │
│ 令牌（每次启动随机生成，只在内存里）                              │
└──────┬───────────────────────────────┬───────────────────────────┘
       │ utilityProcess 消息通道        │ 会话层给“应用来源”的请求补令牌
       │ (start / stop / secret.*)     │
┌──────▼───────────────┐        ┌──────▼──────────────────────────┐
│ 服务进程              │ HTTP   │ 渲染进程（沙箱，无 Node）        │
│ @dramai/server        │◄──────►│ http://127.0.0.1:<端口>/ 前端    │
│ node:sqlite · ffmpeg  │ + SSE  │ window.dramaiDesktop（小桥接）   │
└───────────────────────┘        └─────────────────────────────────┘
```

**为什么服务在 utilityProcess 里，不在主进程里**：`node:sqlite` 是同步调用，文档解析（mammoth）、大文件上传都吃 CPU，放在主进程会让菜单、窗口、系统对话框一起卡住；服务崩溃时也只丢这个进程，主进程能弹窗并重启它，而不是整个应用消失。ffmpeg 是服务进程的子进程。代价是密钥要跨进程：`safeStorage` 只能在主进程用，所以服务里的 `SecretStore` 是个转发器，每次读写都通过消息交给主进程的保险箱（明文只在两个进程的内存里短暂出现）。

**窗口怎么通过鉴权**：令牌不出现在任何地址里，页面脚本也读不到它。主进程在窗口所属的会话里拦截发往“应用自己那个来源”（`http://127.0.0.1:<端口>`）的请求，补上 `Authorization: Bearer <令牌>`；发往别的来源的请求不带。外部浏览器、别的本地程序不知道令牌，拿不到数据；Host 头校验、同源校验仍由服务端执行。（计划 4.2 写的是“由 preload 注入”，这里改成主进程补头：preload 注入意味着令牌进了页面的 JS 环境，一个 XSS 就能读走。）

**端口**：随机，由服务自己绑定（没有“先探测、后绑定”的竞争）；但上次用过的端口空闲就继续用它——页面的来源（含端口）不变，`localStorage` 里的语言、主题等偏好才能跨启动保留。被占用就换一个随机的。

**数据在哪**（优先级从高到低）：环境变量 `DRAMAI_DATA_DIR` > 菜单“文件 → 更改数据目录…”选的 > 默认位置：

| 系统    | 默认数据目录                                | 日志                     |
| ------- | ------------------------------------------- | ------------------------ |
| macOS   | `~/Library/Application Support/Dramai/data` | `~/Library/Logs/Dramai/` |
| Windows | `%APPDATA%\Dramai\data`                     | `%APPDATA%\Dramai\logs\` |
| Linux   | `~/.config/Dramai/data`                     | `~/.config/Dramai/logs/` |

开发形态用 `Dramai Dev`（同级目录），不碰正式安装的数据。更改数据目录**不会移动已有数据**：选空目录是从头开始，选原来的数据目录就继续用。卸载（Windows NSIS）不删数据。

**API Key**：`<数据目录>/secrets.json`，值用系统加密设施（macOS 钥匙串 / Windows DPAPI / Linux libsecret 或 kwallet，通过 Electron `safeStorage` 的**异步**接口；同步接口在 Electron 45 起弃用、46 移除）加密后落盘，文件头标 `electron-safe-storage`。**没有系统加密的机器**（典型：没装也没解锁密码管理器的 Linux，Electron 会退到写死密码的 `basic_text`，那只是混淆，不算加密）：退回明文文件 + 0600 权限（和 WebUI 一样），首次启动弹窗告诉用户；之后系统加密可用了会自动把明文升级成密文。解不开的单个密钥（钥匙串被重置、数据目录从别的电脑拷来）按“未设置”处理，让用户重新填，不会让应用起不来。

## 运行

```bash
pnpm install
pnpm desktop:dev                 # 窗口加载 Vite（热更新）；改主进程 / 服务源码会自动重新打包并重启应用
pnpm desktop:dev --demo --fresh  # 演示模式：同时起模拟服务商并建好服务商配置，不需要任何 Key、不花钱
```

`pnpm desktop:dev` 做的事：监听构建主进程 / 预加载 / 服务进程（esbuild）→ 起前端开发服务器（`/api` 代理到应用内的服务）→ 起 Electron。服务进程用的是和正式包**同一份打包产物**（从源码构建），所以开发形态跑的就是真实的进程模型。演示模式的数据在 `~/.dramai-desktop-demo`，和正式数据分开；演示代码只存在于开发构建里，不进安装包。

## 打包

```bash
pnpm desktop:dist                 # 当前平台、本机架构；产物在 apps/desktop/release/
pnpm desktop:dist --arch x64      # macOS 上可以交叉打 Intel 版（arm64 机器出 x64 包）
pnpm desktop:dist --dir           # 只生成未打包的应用目录（冒烟检查用）
```

做了什么：构建前端 → esbuild 把主进程、预加载、服务进程各打成**单个文件**（应用包里没有 `node_modules`）→ 拷入 `packages/core/data`（提示词和模型数据）和前端构建产物（含自托管字体）→ electron-builder 出安装包。

产物名 `dramai-<版本>-<系统>-<架构>.<扩展名>`：

| 平台              | 产物                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| macOS arm64 / x64 | `dramai-X.Y.Z-mac-arm64.dmg` / `.zip`、`dramai-X.Y.Z-mac-x64.dmg` / `.zip`      |
| Windows x64       | `dramai-X.Y.Z-win-x64.exe`（NSIS 安装包）、`dramai-X.Y.Z-win-x64.zip`（免安装） |
| Linux x64（可选） | `dramai-X.Y.Z-linux-x64.AppImage`                                               |

版本号取 `apps/desktop/package.json` 的 `version`（全仓统一一个版本，由版本工具一起改），About 里显示的是 `app.getVersion()`，同一个值。

### 给发布工作流（`infra`）

每个平台在对应的 runner 上各跑一次，**不需要额外参数、不需要 wine**：

```bash
pnpm install --frozen-lockfile
pnpm desktop:dist                       # macos-14 (arm64)、windows-latest (x64)、ubuntu-latest (x64)
pnpm desktop:dist --arch x64            # macOS Intel 包：在 macos-14 (arm64) 上交叉打，不需要 Intel runner
# 上传：apps/desktop/release/dramai-*.{dmg,zip,exe,AppImage}  （*.blockmap 不需要）
```

- 命令内部已经包含前端构建和 `electron-builder --publish never`，不会往任何地方发布。
- 首次运行会下载 Electron（约 100 MB，缓存在 `~/.cache/electron` 或系统缓存目录），CI 里可缓存。
- 退出码非零即失败；产物清单在最后打印。
- 校验和、创建 Release、上传由工作流负责。

### 签名和公证（环境变量驱动，没有就干净地跳过）

| 目的                  | 环境变量                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS 签名            | `CSC_LINK`（Developer ID Application 证书 .p12，base64 或路径）+ `CSC_KEY_PASSWORD`                                                             |
| macOS 公证（推荐）    | `APPLE_API_KEY`（.p8 路径）+ `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`                                                                            |
| macOS 公证（备选）    | `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`                                                                                    |
| Windows 签名（证书）  | `WIN_CSC_LINK`（.pfx，base64 或路径）+ `WIN_CSC_KEY_PASSWORD`                                                                                   |
| Windows 签名（Azure） | `AZURE_TRUSTED_SIGNING_ENDPOINT` / `_ACCOUNT` / `_PROFILE` / `_PUBLISHER`，认证用 `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` |
| 随包 ffmpeg           | `DRAMAI_FFMPEG_DIR=<放着 ffmpeg(.exe)、ffprobe(.exe) 和许可证文件的目录>`                                                                       |

- 没有 `CSC_LINK`/`CSC_NAME` 时：不签名，**也不会去钥匙串里“自动发现”一个碰巧存在的证书**（`CSC_IDENTITY_AUTO_DISCOVERY=false`），再由 `afterSign` 钩子做 ad-hoc 签名（Apple 芯片上可执行文件至少要有一个签名才能运行；翻转 Electron fuses 后原签名会失效，所以最后重签）。
- 有证书时：启用 hardened runtime 和 `build/entitlements.mac.plist`；有公证凭据时再公证。
- 没有任何变量时，三个平台的构建都照常成功，只是产物未签名。开启签名只需要在工作流里加 secrets，**不用改任何文件**。

### 未签名版本用户会看到什么

**macOS（15 及以后）**：从浏览器下载的 dmg / zip 带隔离属性，双击打开会提示“无法打开“Dramai”，因为 Apple 无法验证其不含恶意软件”。解决：

1. 先双击一次（会被拦），然后打开 **系统设置 → 隐私与安全性**，滚到“安全性”，点 **仍要打开**，输入密码确认。（macOS 15 起右键 → 打开 不再能绕过。）
2. 或者在终端去掉隔离属性：`xattr -dr com.apple.quarantine /Applications/Dramai.app`
3. 如果提示的是“已损坏，无法打开”，也是同一条命令。

**Windows**：运行安装包时 SmartScreen 显示“Windows 已保护你的电脑”，发布者“未知”。点 **更多信息 → 仍要运行**。免安装的 zip 解压后同理。（只有代码签名，且信誉积累后，这个提示才会消失；EV / Azure Trusted Signing 证书可以更快获得信誉。）

**Linux**：`chmod +x dramai-*.AppImage` 后运行。

## 更新

启动后约 8 秒（且距上次检查超过 6 小时）问 GitHub Releases（`GET /repos/hyyyyyyz/dramai/releases`，匿名，不带任何个人信息，UA 只有 `dramai-desktop/<版本>`），有更新的版本就弹窗，带**发布页链接**：“打开发布页 / 稍后 / 跳过此版本”。用正式版的人只看正式版，用预发布版（`v0.5.0-beta.1`）的人也看预发布；草稿忽略；只接受指回本仓库发布页的链接。菜单“帮助 → 检查更新…”手动检查，“启动时检查更新”可关。

**只通知、不自动下载安装**：macOS 的自动更新（Squirrel.Mac）要求应用已签名并公证，第一版没有。要开启自动更新，需要：

1. 有 Apple Developer Program 账号，做完上面的 macOS 签名 + 公证；Windows 建议同时签名（NSIS 更新在未签名时也能工作，但 SmartScreen 每次都拦）。
2. `apps/desktop` 加依赖 `electron-updater`，`electron-builder.config.mjs` 里把 `publish` 改成 `[{ provider: 'github' }]`（会生成并上传 `latest*.yml`；mac 的 zip 必须保留，它就是更新包），发布工作流上传这些 yml。
3. 主进程里用 `autoUpdater` 替换 `runUpdateCheck`（`src/main/updates.ts` 的 semver 逻辑可继续用于通知文案）。
4. 注意：macOS 上 `safeStorage` 的钥匙串条目绑定在应用签名上，ad-hoc 签名每次构建都不一样，**更新后系统会再问一次钥匙串权限**；用固定的 Developer ID 签名就不会。

## ffmpeg

服务通过 `createServer({ ffmpeg: { ffmpegPath } })` 接受显式路径。桌面端的解析顺序：

1. **随包的**：`<应用资源>/ffmpeg/ffmpeg(.exe)`（同目录有 `ffprobe` 也会用）——打包时设 `DRAMAI_FFMPEG_DIR` 把一个目录拷到这里；**仓库里不提交二进制**，没设就不随包。
2. 环境变量 `DRAMAI_FFMPEG`。
3. 系统 PATH。从访达 / 开始菜单启动的应用拿不到用户 shell 的 PATH（Homebrew 的 `/opt/homebrew/bin` 不在默认 PATH 里），所以桌面端会把常见安装位置（macOS：`/opt/homebrew/bin`、`/usr/local/bin`、`/opt/local/bin`；Windows：Chocolatey、Scoop、WinGet 的链接目录）补到服务进程的 PATH 末尾。

服务要求的能力：H.264 编码（`libx264`，macOS 上可退到 `h264_videotoolbox`）、AAC；字幕烧录还要 `subtitles` 滤镜（libass）。没有 `libx264` 的 Windows 构建会被服务判为不可用——服务目前没有 `h264_mf` / `nvenc` / `qsv` / `amf` 的回退，选 LGPL 路线需要 `core-server` 加。

**方案对比（需要你来决定许可取舍）**

| 方案                                         | 许可                                                                                                                                                            | 体积                                               | 功能                                                                                                                                     | 评价                                                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A. 随包 GPL 静态构建，作为**独立可执行文件** | ffmpeg 为 GPL。应用只是**调用**它的外部程序（聚合，不链接），应用本身保持 Apache-2.0；要随包附 GPL 许可全文、版权声明和“如何获取对应源码”的说明（或书面承诺）。 | 每个平台增加约 80–150 MB（以实际下载的为准，未量） | libx264 + libass + AAC 齐全，两个平台行为一致，字幕烧录可用                                                                              | **推荐**：用户装完即可走完整流程，不用自己装 ffmpeg                      |
| B. 随包 LGPL 构建 + 系统自带的 H.264 编码器  | LGPL（动态/独立可执行均可，义务比 GPL 轻）                                                                                                                      | 更小                                               | macOS 用 `h264_videotoolbox`；Windows 用 `h264_mf` 或厂商硬编（nvenc / qsv / amf）；没有 libx264，画质 / 码控不如 x264，部分机器没有硬编 | 许可最干净，但需要 `core-server` 加编码器回退，且 Windows 上稳定性要实测 |
| C. 首次运行时下载                            | 应用不分发 ffmpeg；下载的是第三方构建                                                                                                                           | 安装包小                                           | 需要联网、需要托管点、要校验哈希、要处理失败与重试                                                                                       | 工程量大，离线用不了；除非安装包体积是硬约束，否则不划算                 |
| D. 依赖用户系统里装的（现状）                | 无                                                                                                                                                              | 0                                                  | 取决于用户装的构建；Homebrew 默认的 ffmpeg 常带 libx264 但**不带 libass**                                                                | 对普通用户门槛高；适合作为第一版的“先发出去”选项                         |

**建议**：第一版（未签名）先走 D（已支持，界面会显示 ffmpeg 状态），同时把 A 的流水线准备好——发布工作流下载各平台的 GPL 静态构建（Windows：BtbN 的 `win64-gpl`；macOS arm64 / x64：确认带 libx264 + libass 的静态构建来源），放进 `DRAMAI_FFMPEG_DIR`，并随包附 `ffmpeg/LICENSE` 与来源说明；macOS 上随包的 ffmpeg 要和应用一起用同一个证书签名（`codesign --options runtime`）才能通过公证。具体用哪个下载源、是否带 libass，**必须下载后跑 `ffmpeg -buildconf` / `-encoders` / `-filters` 实测**，我没有在这台机器上验证第三方构建。

## 安全

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、`webSecurity: true`；预加载只暴露一个冻结的小对象，不暴露 `ipcRenderer` 或任何 Electron 对象。
- 所有 IPC 在主进程里校验发送者（必须是应用自己的页面）和参数（路径、字符串长度）。
- 导航只允许应用自己的来源（比较解析后的 origin，不比字符串前缀）；`window.open` 一律拒绝，http(s) / mailto 交给系统浏览器，其他协议丢弃；`<webview>` 禁止。
- 权限请求默认拒绝，只放行应用页面的 `fullscreen`（视频全屏）和 `clipboard-sanitized-write`（复制）。拼写检查关闭（Windows / Linux 上它要联网下载词典）。
- Electron fuses：`runAsNode` 关、`NODE_OPTIONS` 关、`--inspect` 关、`onlyLoadAppFromAsar` 开、asar 完整性校验开、`file://` 额外权限关。
- 原生菜单和对话框有 English / 简体中文 / 繁體中文 三套文案：默认跟随系统（`zh-TW` / `zh-HK` / `zh-Hant*` → 繁体，其他 `zh*` → 简体，其余 → English），可在“视图 → 语言”或通过桥接的 `setLanguage` 改，选择保存在 `desktop.json`。
- 页面本身带的 CSP 由服务端的静态托管下发。

## 前端可以调用什么（`window.dramaiDesktop`）

只在桌面壳里存在；页面用 `window.dramaiDesktop !== undefined` 判断自己是不是桌面端（`GET /api/system` 的 `desktop: true` 也一样）。类型见 [`src/shared/bridge.ts`](src/shared/bridge.ts)。

```ts
interface DramaiDesktopBridge {
  getInfo(): Promise<{
    version: string
    platform: 'darwin' | 'win32' | 'linux'
    arch: string
    dataDir: string
    secretStorage: 'os' | 'plain'
    language: Lang
    languagePreference: 'auto' | Lang
  }> // Lang = 'en' | 'zh-CN' | 'zh-TW'
  selectFolder(options?: { title?: string; defaultPath?: string }): Promise<string | null>
  revealProjectFile(target: { projectId: string; path?: string }): Promise<boolean> // 在访达 / 资源管理器里显示
  notify(notification: { title: string; body?: string }): Promise<boolean> // 窗口在前台时不弹，返回 false
  setLanguage(language: 'auto' | 'en' | 'zh-CN' | 'zh-TW'): Promise<boolean> // 让原生菜单 / 对话框跟着换语言
}
```

前端需要接的地方（`workspace-fe`）：

1. **在访达中显示**：项目页 / 镜头卡 / 导出完成后加“在文件夹中显示”，调 `revealProjectFile({ projectId, path })`；`path` 是项目文件夹内的相对路径（和 `fileUrl(projectId, path)` 同一个），不给就打开项目文件夹。不在桌面端时不显示这个入口（WebUI 下没有）。
2. **任务完成通知**：任务面板收到 `job.updated` 且状态变成 `succeeded`（或需要用户处理）的长任务（成片合成、整集视频批量）时调 `notify({ title, body })`；窗口在前台时主进程自己不弹。
3. **选择文件夹**：导出到指定目录、剪映草稿目录等需要目录路径的输入框旁边放“选择…”按钮，调 `selectFolder()`。
4. **界面语言**（用户要求：设置里可以切换 English / 简体中文 / 繁體中文）：设置页加“语言”选项，三种语言 + “跟随系统”；用户切换时除了切换网页界面，还要调 `setLanguage(...)`，让原生菜单和对话框一起变。桌面端自己的菜单“视图 → 语言”改的是同一个值（页面启动时用 `getInfo().languagePreference` 同步一次即可）。网页界面和服务端的内置数据（风格预设、服务商预设、演示提示语）目前只有中英两种，**繁体中文需要前端补一套文案，`core-server` 的 `Localized` / `locale` 也要加 `zh-TW`**（`GET /api/settings` 的 `locale`、请求头 `X-Dramai-Locale`）。
5. **设置页显示密钥保存方式**：`getInfo().secretStorage === 'plain'` 时提示“没有系统加密，API Key 以文件权限保护”。

## 验证脚本

```bash
node scripts/smoke.mjs                       # 源码形态冒烟（需要先 pnpm --filter @dramai/desktop build）
node scripts/smoke.mjs --app <可执行文件>     # 打包形态冒烟，如 release/mac-arm64/Dramai.app/Contents/MacOS/Dramai
node scripts/smoke.mjs --full [--app …]      # 再加：模拟服务商走短流程、密钥加密落盘、重启后端口和密钥仍在、单实例
```

冒烟检查通过 Chromium 的 `--remote-debugging-port` 驱动应用（应用本身没有为测试留任何后门）：等服务健康 → 首屏渲染 → 验证安全边界（无令牌 401、错误令牌 401、伪造 Host 403、页面里没有 cookie、预加载只暴露约定的四个方法、渲染进程没有 Node）→ 正常退出（服务关闭、数据目录锁释放）。

## 已知限制

- 第一版未签名（见上）。
- 没有托盘（计划里提到，这一版没做）；关闭最后一个窗口在 macOS 上保留应用（任务继续跑），在 Windows / Linux 上退出应用。
- 退出时有运行中的任务会先确认；确认后不等它们结束：已提交给服务商的任务由下次启动的恢复逻辑继续查询，其余标记“结果不明”（不会重复提交，避免重复计费）。
