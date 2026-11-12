# @dramai/desktop

The Dramai desktop app: an Electron shell around the same local server (`@dramai/server`) and the same frontend (`@dramai/workspace`) that the WebUI uses.

## Three ways to get it

| Form                      | Command                                                       | For                                                                        |
| ------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Run from source           | `pnpm desktop:dev`                                            | Developers; frontend hot reload                                            |
| Build and install locally | `pnpm desktop:install` (`desktop:build`, `desktop:uninstall`) | Anyone with the repo and Node + pnpm; no download warnings, no certificate |
| Installer from a release  | `pnpm desktop:dist` (CI runs it on a version tag)             | Everyone else; unsigned, see "Opening an unsigned installer"               |

Requirements for the first two: Node 22.13+ (24 recommended), pnpm 9, and `pnpm install` run once at the repo root. ffmpeg is not bundled in any form; see [ffmpeg](#ffmpeg).

```bash
pnpm install
pnpm desktop:dev                 # run from source (add --demo --fresh for mock providers: no API keys, no cost)
pnpm desktop:build               # compile the app for this machine into apps/desktop/release/ (does not install)
pnpm desktop:install             # build + install for the current user
pnpm desktop:uninstall           # remove the app, keep your data (add --purge-data to delete data too)
pnpm desktop:dist                # installers for this system into apps/desktop/release/
```

All of `build`, `install` and `dist` run the **same generation step** (build the frontend, bundle the app, `electron-builder`); `build`/`install` stop at the unpacked app, `dist` also produces installers. The only difference in the resulting app is a `dramai.distribution` field (`local` or `package`) in its `package.json`, which the update notice uses.

## Local build and install

Everything is installed for the current user, so **no administrator rights are needed** (the one exception is a Linux hardening setting, below).

| System  | Installed to                                                                                                                                  | Appears in                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| macOS   | `/Applications/Dramai.app` (or `~/Applications` if `/Applications` is not writable by you)                                                    | Launchpad, Spotlight, Finder                   |
| Windows | `%LOCALAPPDATA%\Programs\Dramai` + Start menu shortcut + an entry in Settings > Apps                                                          | Start menu, search, Settings > Apps            |
| Linux   | `~/.local/share/dramai`, symlink `~/.local/bin/dramai`, `~/.local/share/applications/dramai.desktop`, icons in `~/.local/share/icons/hicolor` | Application menu, `dramai` on the command line |

- **Upgrade**: pull the new code and run `pnpm desktop:install` again. The old copy is replaced (and restored if the copy fails); your data is not touched. The installer refuses to replace a running app: quit Dramai first.
- **Uninstall**: `pnpm desktop:uninstall` removes the app, launcher entries and icons and **keeps your projects, settings and API keys**. `--purge-data` also deletes them: it lists every folder it will delete (including a custom data folder chosen in the app) and asks you to type `delete`; non-interactive runs must add `--yes`. On macOS it also deletes the "Dramai Safe Storage" keychain entry that protected the API keys.
- **Why no certificate is needed**: Gatekeeper (macOS), SmartScreen (Windows) and similar checks apply to files that arrived from the network (they carry a quarantine / "mark of the web" flag). An app generated on your own machine has no such flag.
  - **macOS** (verified on Apple silicon): an arm64 executable must have at least an _ad-hoc_ signature to run at all. That needs no certificate, but something has to create it, so the build does (`scripts/ad-hoc-sign.mjs`). The installed app opens from Launchpad / Finder without any prompt.
  - **Windows** and **Linux**: no signature is required to run a locally created program; this is according to the platforms' documentation and has **not** been tested here (see "What was verified").
- **macOS Keychain prompt after a rebuild**: API keys are encrypted with a key in the login Keychain ("Dramai Safe Storage"). An ad-hoc signature identifies the app by its code hash, so every locally rebuilt app is a "new" app to the Keychain and macOS asks once whether it may use the entry; choose **Always Allow**. The app opens and stays usable while the prompt is open (only reading or saving API keys waits for the answer). I tried giving the ad-hoc signature a stable designated requirement; the Keychain still asked, so it is not worth the weaker identity. A signing certificate (a later step) removes the prompt. To start from a clean slate: `security delete-generic-password -s "Dramai Safe Storage"` (the saved keys then have to be entered again).
- **Linux sandbox note**: Chromium's sandbox needs unprivileged user namespaces. Ubuntu 24.04+ (AppArmor) and some hardened kernels block them; if Dramai does not start there, the installer prints the one command to run with `sudo` (set the setuid bit on `chrome-sandbox`). Nothing else needs root.

## Installers (`pnpm desktop:dist`)

Run once per system on that system (no wine, no extra arguments); output in `apps/desktop/release/`, named `dramai-<version>-<os>-<arch>.<ext>`:

| System  | Files                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| macOS   | `dramai-X.Y.Z-mac-arm64.dmg`, `.zip`; `--arch x64` also builds `…-mac-x64.dmg`, `.zip` (cross-built on an arm64 runner) |
| Windows | `dramai-X.Y.Z-win-x64.exe` (NSIS installer, per-user), `dramai-X.Y.Z-win-x64.zip` (portable)                            |
| Linux   | `dramai-X.Y.Z-linux-x64.AppImage`, `dramai-X.Y.Z-linux-x64.tar.gz`                                                      |

The version is the `version` of `apps/desktop/package.json` (one repo-wide version) and is what About shows. The command also builds the frontend and runs `electron-builder --publish never`: it never uploads anything. Downloaded Electron binaries are cached (~100 MB per platform and arch). Checksums, the release and the upload belong to the release workflow.

Nothing is signed. The configuration does not block adding signing later: set `mac.identity` / `win.signtoolOptions` in `electron-builder.config.mjs` (and drop `scripts/ad-hoc-sign.mjs`).

### Opening an unsigned installer

_English_

- **macOS**: a downloaded `.dmg` / `.zip` is quarantined, so the first launch is blocked with "Dramai cannot be opened because Apple cannot check it for malicious software". Open **System Settings > Privacy & Security**, scroll to **Security**, click **Open Anyway** next to Dramai and confirm with your password. (On macOS 15 and later, right-click > Open no longer bypasses this.) Or remove the flag in Terminal: `xattr -dr com.apple.quarantine /Applications/Dramai.app`. If macOS says the app is "damaged", that command fixes it too.
- **Windows**: SmartScreen shows "Windows protected your PC" with publisher "Unknown". Click **More info**, then **Run anyway**. The same applies to the portable `.zip` after you extract it.
- **Linux**: `chmod +x dramai-*.AppImage`, then run it (AppImages need FUSE 2; on Ubuntu 22.04+ install `libfuse2`, or use the `.tar.gz`). See the sandbox note above for Ubuntu 24.04+.
- You can avoid all of this by building locally (`pnpm desktop:install`).

_中文_

- **macOS**：下载的 `.dmg` / `.zip` 带隔离标记，首次打开会提示"无法打开 Dramai，因为 Apple 无法检查其是否包含恶意软件"。打开 **系统设置 > 隐私与安全性**，滚动到 **安全性**，点 Dramai 旁边的 **仍要打开** 并输入密码。（macOS 15 起右键 > 打开 不再能绕过。）或在终端运行：`xattr -dr com.apple.quarantine /Applications/Dramai.app`。提示"已损坏"时同样用这条命令。
- **Windows**：SmartScreen 会显示"Windows 已保护你的电脑"，发布者为"未知"。点 **更多信息**，再点 **仍要运行**。免安装的 `.zip` 解压后同理。
- **Linux**：`chmod +x dramai-*.AppImage` 后运行（AppImage 需要 FUSE 2，Ubuntu 22.04+ 请安装 `libfuse2`，或改用 `.tar.gz`）。
- 想避开这些提示：用本地编译安装（`pnpm desktop:install`）。
- 所有形式都需要自己安装 ffmpeg，见下。

## ffmpeg

Not bundled in any form. The app uses the ffmpeg installed on the machine: `DRAMAI_FFMPEG` (full path) if set, otherwise the one on `PATH`. Apps started from Finder / the Start menu do not inherit your shell's `PATH` (Homebrew's `/opt/homebrew/bin` is not in it), so the app appends the usual install folders (macOS: `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`; Windows: Chocolatey, Scoop and WinGet link folders) to the server's `PATH`.

If ffmpeg is missing the app says so at launch (once; "Don't remind me" is remembered) and under Help > Set Up ffmpeg…, with the command for the system: `brew install ffmpeg` (macOS), `winget install Gyan.FFmpeg` (Windows), `apt` / `dnf` / `pacman install ffmpeg` (Linux). The server needs H.264 (`libx264`; `h264_videotoolbox` is the macOS fallback) and AAC; burning subtitles into the picture also needs the `subtitles` filter (libass), which some default builds lack.

If bundling is ever wanted: (1) a GPL static build shipped as a _separate executable_ next to the app (libx264 + libass, identical behaviour everywhere; needs the GPL text and a source offer in the notices, adds roughly 80–150 MB per platform, unmeasured); (2) an LGPL build plus the platforms' own H.264 encoders (`h264_videotoolbox`, `h264_mf` / nvenc / qsv / amf; lighter obligations, but the server has no encoder fallback besides VideoToolbox today); (3) download on first run (small installer, but needs hosting, hash checks and an offline story).

## Updates

At launch (about 8 s in, at most every 6 h) the app asks the GitHub Releases API whether a newer version exists (anonymous request, no personal data, `User-Agent: dramai-desktop/<version>`) and, if so, shows a dialog with a link to the release page and "Later" / "Skip this version". Stable users only see stable releases; pre-release users (`v0.5.0-beta.1`) also see pre-releases; drafts and links that do not point at this repository are ignored. The text depends on how the app was installed: **installer** → "download the new version from the release page"; **local build or source run** → "pull the latest code and run `pnpm desktop:install` again". Help > Check for Updates… checks on demand; "Check for Updates on Launch" can be switched off. There is no automatic updating: on macOS it requires a signed and notarized app.

## Icons and the app name

Icons are generated from the artwork in `packages/ui/src/brand/` by the build; no derived icon is committed.

| Where                                                 | How                                                                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS installed app (Finder, Launchpad, Dock)         | `electron-builder` turns `app-icon-1024.png` (the macOS artwork) into the `.icns`                                                                              |
| Windows installed app (Start menu, taskbar, Explorer) | `electron-builder` embeds `app-icon-square-1024.png` into `Dramai.exe` as `.ico`; the Start menu shortcut takes its icon from the exe                          |
| Linux (menu, window)                                  | the local installer writes 16–512 px PNGs from `app-icon-square-1024.png` into the `hicolor` theme; the window icon is `dist/icons/window.png`                 |
| Running from source, macOS                            | `scripts/lib/dev-app.mjs` makes `.dev/Dramai Dev.app`, a patched copy of Electron.app with the dramai icon and the name "Dramai Dev" (Dock, Cmd-Tab, menu bar) |
| Running from source, Windows / Linux                  | the window / taskbar icon is set from the app (`dist/icons/window.png`) and the app user model id; the process still appears as `electron` in task managers    |

Scaling uses `scripts/lib/icons.mjs` (an area-average resampler on `pngjs`, identical on every OS).

## How it works

```
Electron main process: window, menu, dialogs, notifications, single instance, update notice,
                       vault for API keys (safeStorage), the per-launch token (in memory only)
   │ utilityProcess channel (start / stop / secret.*)       │ session layer adds the token to requests for the app origin
@dramai/server (own process)  ◄──── HTTP + SSE on 127.0.0.1:<port> ────►  renderer (sandboxed, no Node)
node:sqlite · ffmpeg child process                                          the frontend + window.dramaiDesktop (tiny bridge)
```

- **Server in a utility process, not the main process**: `node:sqlite` is synchronous, document parsing and large uploads are CPU heavy; in the main process they would freeze menus and dialogs. A server crash only loses that process (the app offers to restart it). Secrets cross the process boundary because `safeStorage` is main-process only: the server's `SecretStore` forwards every read/write to the main process.
- **Window authentication**: the token never appears in a URL and page scripts cannot read it. The main process adds `Authorization: Bearer <token>` to requests for the app's own origin in the window's session; other origins get nothing. (The plan said "injected by preload"; that would put the token in the page's JS world, where one XSS could read it.) Other local programs and browsers do not know the token; the server still enforces the Host and same-origin checks.
- **Port**: random, bound by the server itself (no probe-then-bind race), but the previous port is reused when free so the page origin, and therefore `localStorage` (language, theme), survives restarts.
- **Data**: `DRAMAI_DATA_DIR` > the folder chosen in File > Change Data Folder… > the default below. Changing the folder does not move existing data. Development uses `Dramai Dev` next to it. Uninstalling never deletes data unless asked.

  | System  | Default data folder                         | Logs                     |
  | ------- | ------------------------------------------- | ------------------------ |
  | macOS   | `~/Library/Application Support/Dramai/data` | `~/Library/Logs/Dramai/` |
  | Windows | `%APPDATA%\Dramai\data`                     | `%APPDATA%\Dramai\logs\` |
  | Linux   | `~/.config/Dramai/data`                     | `~/.config/Dramai/logs/` |

- **API keys**: `<data folder>/secrets.json`, encrypted with the OS facility (macOS Keychain, Windows DPAPI, Linux libsecret / kwallet) through `safeStorage`'s async API (the sync API is deprecated in Electron 45 and removed in 46). Where no system key store exists (typically Linux without a running keyring; Electron then falls back to a hard-coded password, which is obfuscation, not encryption) keys are kept in a 0600 file like the WebUI does, and the app tells the user once. Keys become encrypted automatically once a key store is available. A single key that can no longer be decrypted (keychain reset, data folder copied from another computer) is treated as unset so the user can enter it again; it never prevents startup.
- **Security**: `contextIsolation`, `sandbox`, no Node integration, `webSecurity`; the preload exposes one frozen object; every IPC call validates the sender (must be the app page) and its arguments; navigation is limited to the app origin (parsed origin comparison), `window.open` is refused and http(s)/mailto links go to the system browser; permissions are denied except `fullscreen` and `clipboard-sanitized-write` for the app page; spell-check is off (it downloads dictionaries on Windows/Linux); fuses: `runAsNode` off, `NODE_OPTIONS` off, `--inspect` off, `onlyLoadAppFromAsar` + asar integrity on, extra `file://` privileges off.
- **Language**: native menus and dialogs come in English, 简体中文 and 繁體中文, follow the system by default, and can be changed under View > Language or with `setLanguage` from the page (kept in `desktop.json`).

## Frontend bridge (`window.dramaiDesktop`)

Only present in the desktop app; `GET /api/system` also reports `desktop: true`. Types: [`src/shared/bridge.ts`](src/shared/bridge.ts).

```ts
interface DramaiDesktopBridge {
  getInfo(): Promise<{
    version
    platform: 'darwin' | 'win32' | 'linux'
    arch
    dataDir
    secretStorage: 'os' | 'plain'
    language: 'en' | 'zh-CN' | 'zh-TW'
    languagePreference: 'auto' | 'en' | 'zh-CN' | 'zh-TW'
  }>
  selectFolder(options?: { title?: string; defaultPath?: string }): Promise<string | null>
  revealProjectFile(target: { projectId: string; path?: string }): Promise<boolean> // Finder / Explorer / file manager
  notify(notification: { title: string; body?: string }): Promise<boolean> // not shown while the window is focused
  setLanguage(language: 'auto' | 'en' | 'zh-CN' | 'zh-TW'): Promise<boolean> // keeps native menus/dialogs in sync
}
```

What the frontend should call: "Show in folder" on projects / shot cards / finished exports → `revealProjectFile({ projectId, path })` (path relative to the project folder, as in `fileUrl`); `notify` when a long task succeeds or needs attention; `selectFolder` next to directory inputs (export target, Jianying drafts folder); the Settings language switch (English / 简体中文 / 繁體中文 / match system) should also call `setLanguage`; Settings can show a notice when `getInfo().secretStorage === 'plain'`.

## Checks

```bash
node scripts/smoke.mjs                         # run-from-source smoke (needs `pnpm --filter @dramai/desktop build`)
node scripts/smoke.mjs --app <executable>      # against a built / installed app; add --full for the short flow
node scripts/selftest.mjs                      # after `pnpm desktop:build`: sandboxed install -> smoke -> uninstall -> purge, unattended
```

The smoke check drives the app through Chromium's `--remote-debugging-port` (the app has no test back door): server healthy, first screen rendered, security boundaries (no token / wrong token → 401, forged Host → 403, no cookies, preload exposes only the agreed methods, no Node in the renderer), clean exit with the data-dir lock released. `--full` adds the mock-provider flow (create project, upload, plan episodes), encrypted key storage, restart persistence and the single-instance check. `selftest.mjs` needs a display on Linux (`xvfb-run -a`) and `--arg=--no-sandbox` on runners that block user namespaces.

## What was verified (macOS arm64, Apple silicon)

Run from source (Dock shows the dramai icon, app registered as "Dramai Dev"); `desktop:install` to `/Applications` and opened through LaunchServices (as Launchpad does) with the short flow passing; reinstall over a running app is refused, over a stopped one replaces it; `desktop:uninstall` removes it and keeps data; `--purge-data` confirmations; `selftest.mjs`; the installer (`.dmg`) installed to a scratch folder and run. **Not run**: Windows, Linux, macOS x64 (built only), Launchpad itself (Spotlight/LaunchServices registration was checked), a machine without an OS key store (unit-tested only), the native error dialogs (logged and unit-tested, not clicked through).
