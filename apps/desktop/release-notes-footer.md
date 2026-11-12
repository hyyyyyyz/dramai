## Installing Dramai

These installers are **not code-signed**, so macOS and Windows warn the first time you open them. Dramai also needs **ffmpeg** installed on your computer (it is not bundled).

### Opening an unsigned installer

- **macOS** (`.dmg` / `.zip`): the first launch is blocked with "Dramai cannot be opened because Apple cannot check it for malicious software". Open **System Settings > Privacy & Security**, scroll to **Security**, click **Open Anyway** next to Dramai and confirm with your password. (On macOS 15 and later, right-click > Open no longer bypasses this.) Or run `xattr -dr com.apple.quarantine /Applications/Dramai.app` in Terminal; the same command fixes a "damaged" message. After each upgrade macOS asks once more whether Dramai may use its Keychain entry (it protects your API keys, and a new unsigned build looks like a new app to the system): choose **Always Allow**. Dramai stays usable while the prompt is open.
- **Windows** (`.exe` / `.zip`): SmartScreen shows "Windows protected your PC" with publisher "Unknown". Click **More info**, then **Run anyway**. The portable `.zip` behaves the same after you extract it.
- **Linux** (`.AppImage` / `.tar.gz`): `chmod +x dramai-*.AppImage`, then run it. AppImages need FUSE 2 (on Ubuntu 22.04+ install `libfuse2`), or use the `.tar.gz`. On Ubuntu 24.04+ the Chromium sandbox may be blocked; see `apps/desktop/README.md`.
- To avoid these prompts, build and install locally instead: `pnpm desktop:install` (see the repository README).

### Install ffmpeg

- macOS: `brew install ffmpeg`
- Windows: `winget install Gyan.FFmpeg` (or `choco install ffmpeg` / `scoop install ffmpeg`)
- Linux: `sudo apt install ffmpeg` / `sudo dnf install ffmpeg` / `sudo pacman -S ffmpeg`

Burning subtitles into the picture needs an ffmpeg build with libass (`ffmpeg -filters` should list `subtitles`). Dramai tells you at launch if ffmpeg is missing; you can also point `DRAMAI_FFMPEG` at the full path of the executable.

---

## 安装 Dramai

这些安装包**没有代码签名**，首次打开时 macOS 和 Windows 会弹出安全提示。Dramai 还需要你**自己安装 ffmpeg**（不随安装包分发）。

### 怎么打开未签名的安装包

- **macOS**（`.dmg` / `.zip`）：首次打开会提示“无法打开 Dramai，因为 Apple 无法检查其是否包含恶意软件”。打开 **系统设置 > 隐私与安全性**，滚动到 **安全性**，点 Dramai 旁边的 **仍要打开** 并输入密码。（macOS 15 起右键 > 打开 不再能绕过。）或在终端运行 `xattr -dr com.apple.quarantine /Applications/Dramai.app`；提示“已损坏”时也用这条命令。每次升级后 macOS 会再问一次是否允许 Dramai 使用它的钥匙串条目（它保护你的 API Key，未签名的新版本在系统眼里是一个新应用），选 **始终允许** 即可；提示窗口打开期间 Dramai 仍可使用。
- **Windows**（`.exe` / `.zip`）：SmartScreen 会显示“Windows 已保护你的电脑”，发布者为“未知”。点 **更多信息**，再点 **仍要运行**。免安装的 `.zip` 解压后同理。
- **Linux**（`.AppImage` / `.tar.gz`）：`chmod +x dramai-*.AppImage` 后运行。AppImage 需要 FUSE 2（Ubuntu 22.04+ 请安装 `libfuse2`），或改用 `.tar.gz`。Ubuntu 24.04+ 上 Chromium 沙箱可能被系统禁用，见 `apps/desktop/README.md`。
- 想避开这些提示：改用本地编译安装 `pnpm desktop:install`（见仓库 README）。

### 安装 ffmpeg

- macOS：`brew install ffmpeg`
- Windows：`winget install Gyan.FFmpeg`（或 `choco install ffmpeg` / `scoop install ffmpeg`）
- Linux：`sudo apt install ffmpeg` / `sudo dnf install ffmpeg` / `sudo pacman -S ffmpeg`

把字幕烧进画面需要带 libass 的 ffmpeg（`ffmpeg -filters` 里应有 `subtitles`）。启动时如果找不到 ffmpeg，Dramai 会提示；也可以把环境变量 `DRAMAI_FFMPEG` 设为 ffmpeg 可执行文件的完整路径。
