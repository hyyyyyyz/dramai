/** 界面语言：English、简体中文、繁體中文。 */
export type Lang = 'en' | 'zh-CN' | 'zh-TW'
/** 用户的选择：跟随系统，或固定一种。 */
export type LangPreference = 'auto' | Lang

export const LANGS: readonly Lang[] = ['en', 'zh-CN', 'zh-TW']

export function isLangPreference(value: unknown): value is LangPreference {
  return (
    value === 'auto' || (typeof value === 'string' && (LANGS as readonly string[]).includes(value))
  )
}

/** 系统语言（如 `zh-TW`、`zh-Hant-HK`、`zh-CN`、`en-US`）对应到三种界面语言；其他语言用 English。 */
export function detectLang(locale: string): Lang {
  const l = locale.toLowerCase()
  if (!l.startsWith('zh')) return 'en'
  return /hant|-tw|-hk|-mo/.test(l) ? 'zh-TW' : 'zh-CN'
}

export function resolveLang(preference: LangPreference | undefined, systemLocale: string): Lang {
  return preference && preference !== 'auto' ? preference : detectLang(systemLocale)
}

/** Install commands for the user's system, one per line. */
export function ffmpegInstallLines(platform: string, lang: Lang): string {
  const alt = lang === 'en' ? 'or' : lang === 'zh-TW' ? '或' : '或'
  if (platform === 'darwin') return '  brew install ffmpeg'
  if (platform === 'win32')
    return `  winget install Gyan.FFmpeg   (${alt}: choco install ffmpeg / scoop install ffmpeg)`
  return [
    '  Debian / Ubuntu:  sudo apt install ffmpeg',
    '  Fedora:           sudo dnf install ffmpeg',
    '  Arch:             sudo pacman -S ffmpeg',
  ].join('\n')
}

const zhCN = {
  appName: 'Dramai',
  startFailedTitle: '无法启动 Dramai',
  startFailed: {
    DATA_DIR_LOCKED: (dir: string) =>
      `数据目录已被另一个 Dramai（或 WebUI）占用：\n${dir}\n\n请先关闭它，或者换一个数据目录。`,
    SCHEMA_TOO_NEW: (dir: string) =>
      `这个数据目录是更新版本的 Dramai 创建的，当前版本打不开它：\n${dir}\n\n请升级 Dramai，或者换一个数据目录。`,
    PORT_IN_USE: () => '本机端口被占用，服务没能启动。请重试。',
    TOKEN_REQUIRED: () => '内部错误：服务要求访问令牌但没有提供。请重试，仍然失败请反馈。',
    UNKNOWN: () => '本地服务启动失败。',
  },
  details: '详细信息',
  retry: '重试',
  chooseDataDir: '选择其他数据目录…',
  quit: '退出',
  openLogs: '打开日志文件夹',
  crashedTitle: '本地服务意外退出',
  crashed: '正在进行的任务不会丢失，重新启动服务后会接着处理。',
  restartServer: '重新启动服务',
  quitConfirmTitle: '还有任务在运行',
  quitConfirm: (n: number) =>
    `有 ${n} 个任务正在运行。现在退出会中断它们；下次启动时会自动恢复（已提交给服务商的任务会继续查询结果）。`,
  quitAnyway: '仍然退出',
  cancel: '取消',
  rendererGoneTitle: '界面进程崩溃了',
  reload: '重新加载',
  updateAvailableTitle: '有新版本可用',
  updateAvailable: (current: string, latest: string) =>
    `Dramai ${latest} 已发布（当前 ${current}）。`,
  openReleasePage: '打开发布页',
  later: '稍后',
  skipVersion: '跳过此版本',
  upToDate: (v: string) => `已是最新版本（${v}）。`,
  updateCheckFailed: '检查更新失败，请稍后再试。',
  changeDataDirTitle: '选择数据目录',
  changeDataDirConfirm: (dir: string) =>
    `将使用这个目录保存数据：\n${dir}\n\n已有的数据不会被移动或复制；选一个空文件夹会从头开始，选一个原有的 Dramai 数据目录会继续使用其中的内容。应用将重新启动。`,
  restartNow: '重启应用',
  plainSecretsTitle: '没有可用的系统加密',
  plainSecrets:
    '这台电脑上没有可用的系统密钥库，API Key 会以仅当前用户可读的文件保存（没有加密）。在 Linux 上安装并解锁 GNOME Keyring 或 KWallet 后，重启应用会自动改为加密保存。',
  updateLocalHint:
    '这是本地编译安装的版本。更新方法：拉取最新代码，再运行一次 pnpm desktop:install（会覆盖旧版本，不影响你的数据）。',
  ffmpegMissingTitle: '没有找到 ffmpeg',
  ffmpegMissing: (platform: string) =>
    `合成视频和导出成片需要 ffmpeg，这台电脑上没有找到。\n\n安装后重启 Dramai：\n${ffmpegInstallLines(platform, 'zh-CN')}\n\n把字幕烧进画面还要求 ffmpeg 带 libass。也可以设置环境变量 DRAMAI_FFMPEG 指向 ffmpeg 的完整路径。`,
  dontRemind: '不再提醒',
  ok: '好',
  aboutTitle: '关于 Dramai',
  aboutDetail: (v: { app: string; electron: string; chrome: string; node: string; data: string }) =>
    `版本 ${v.app}\nElectron ${v.electron} · Chromium ${v.chrome} · Node ${v.node}\n数据目录：${v.data}\n\nApache-2.0 许可证`,
  openProject: '项目主页',
  menu: {
    file: '文件',
    edit: '编辑',
    view: '视图',
    window: '窗口',
    help: '帮助',
    changeDataDir: '更改数据目录…',
    openDataDir: '在文件夹中显示数据目录',
    openLogs: '打开日志文件夹',
    checkUpdates: '检查更新…',
    autoCheck: '启动时检查更新',
    about: '关于 Dramai',
    homepage: '项目主页',
    reportIssue: '反馈问题',
    ffmpegHelp: '设置 ffmpeg…',
    language: '语言',
    languageAuto: '跟随系统',
  },
}

type Strings = typeof zhCN

const en: Strings = {
  appName: 'Dramai',
  startFailedTitle: 'Dramai could not start',
  startFailed: {
    DATA_DIR_LOCKED: (dir) =>
      `The data folder is in use by another Dramai (or the WebUI):\n${dir}\n\nClose it, or choose a different data folder.`,
    SCHEMA_TOO_NEW: (dir) =>
      `This data folder was created by a newer Dramai that this version cannot open:\n${dir}\n\nUpdate Dramai, or choose a different data folder.`,
    PORT_IN_USE: () => 'A local port was taken and the server could not start. Please retry.',
    TOKEN_REQUIRED: () =>
      'Internal error: the server asked for an access token that was not provided. Retry, and report it if it keeps happening.',
    UNKNOWN: () => 'The local server failed to start.',
  },
  details: 'Details',
  retry: 'Retry',
  chooseDataDir: 'Choose another data folder…',
  quit: 'Quit',
  openLogs: 'Open log folder',
  crashedTitle: 'The local server stopped unexpectedly',
  crashed: 'Running tasks are not lost; they are picked up again when the server restarts.',
  restartServer: 'Restart server',
  quitConfirmTitle: 'Tasks are still running',
  quitConfirm: (n) =>
    `${n} task${n === 1 ? ' is' : 's are'} running. Quitting now interrupts ${n === 1 ? 'it' : 'them'}; they resume automatically on next launch (tasks already submitted to a provider keep being polled).`,
  quitAnyway: 'Quit anyway',
  cancel: 'Cancel',
  rendererGoneTitle: 'The window crashed',
  reload: 'Reload',
  updateAvailableTitle: 'A new version is available',
  updateAvailable: (current, latest) => `Dramai ${latest} is out (you have ${current}).`,
  openReleasePage: 'Open release page',
  later: 'Later',
  skipVersion: 'Skip this version',
  upToDate: (v) => `You are up to date (${v}).`,
  updateCheckFailed: 'Could not check for updates. Please try again later.',
  changeDataDirTitle: 'Choose data folder',
  changeDataDirConfirm: (dir) =>
    `Data will be stored in:\n${dir}\n\nExisting data is not moved or copied. An empty folder starts fresh; an existing Dramai data folder is used as it is. The app will restart.`,
  restartNow: 'Restart app',
  plainSecretsTitle: 'No system encryption available',
  plainSecrets:
    'This computer has no usable system key store, so API keys are saved in a file readable only by your user account (not encrypted). On Linux, install and unlock GNOME Keyring or KWallet and restart: the keys are then encrypted automatically.',
  updateLocalHint:
    '這是本機編譯安裝的版本。更新方法：拉取最新程式碼，再執行一次 pnpm desktop:install（會覆蓋舊版本，不影響你的資料）。',
  ffmpegMissingTitle: '找不到 ffmpeg',
  ffmpegMissing: (platform) =>
    `合成影片和匯出成片需要 ffmpeg，這台電腦上找不到。\n\n安裝後重新啟動 Dramai：\n${ffmpegInstallLines(platform, 'zh-TW')}\n\n把字幕燒進畫面還要求 ffmpeg 帶有 libass。也可以設定環境變數 DRAMAI_FFMPEG 指向 ffmpeg 的完整路徑。`,
  dontRemind: '不再提醒',
  ok: 'OK',
  aboutTitle: 'About Dramai',
  aboutDetail: (v) =>
    `Version ${v.app}\nElectron ${v.electron} · Chromium ${v.chrome} · Node ${v.node}\nData folder: ${v.data}\n\nApache-2.0 license`,
  openProject: 'Project page',
  menu: {
    file: 'File',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    help: 'Help',
    changeDataDir: 'Change Data Folder…',
    openDataDir: 'Show Data Folder',
    openLogs: 'Open Log Folder',
    checkUpdates: 'Check for Updates…',
    autoCheck: 'Check for Updates on Launch',
    about: 'About Dramai',
    homepage: 'Project Page',
    reportIssue: 'Report an Issue',
    ffmpegHelp: 'Set Up ffmpeg…',
    language: 'Language',
    languageAuto: 'Match System',
  },
}

const zhTW: Strings = {
  appName: 'Dramai',
  startFailedTitle: '無法啟動 Dramai',
  startFailed: {
    DATA_DIR_LOCKED: (dir) =>
      `資料目錄已被另一個 Dramai（或 WebUI）佔用：\n${dir}\n\n請先關閉它，或者換一個資料目錄。`,
    SCHEMA_TOO_NEW: (dir) =>
      `這個資料目錄是更新版本的 Dramai 建立的，目前版本無法開啟：\n${dir}\n\n請升級 Dramai，或者換一個資料目錄。`,
    PORT_IN_USE: () => '本機連接埠被佔用，服務沒能啟動。請重試。',
    TOKEN_REQUIRED: () => '內部錯誤：服務要求存取權杖但沒有提供。請重試，仍然失敗請回報。',
    UNKNOWN: () => '本機服務啟動失敗。',
  },
  details: '詳細資訊',
  retry: '重試',
  chooseDataDir: '選擇其他資料目錄…',
  quit: '結束',
  openLogs: '開啟日誌資料夾',
  crashedTitle: '本機服務意外結束',
  crashed: '進行中的任務不會遺失，重新啟動服務後會接著處理。',
  restartServer: '重新啟動服務',
  quitConfirmTitle: '還有任務在執行',
  quitConfirm: (n) =>
    `有 ${n} 個任務正在執行。現在結束會中斷它們；下次啟動時會自動恢復（已提交給服務商的任務會繼續查詢結果）。`,
  quitAnyway: '仍然結束',
  cancel: '取消',
  rendererGoneTitle: '介面程序當機了',
  reload: '重新載入',
  updateAvailableTitle: '有新版本可用',
  updateAvailable: (current, latest) => `Dramai ${latest} 已發布（目前 ${current}）。`,
  openReleasePage: '開啟發布頁',
  later: '稍後',
  skipVersion: '略過此版本',
  upToDate: (v) => `已是最新版本（${v}）。`,
  updateCheckFailed: '檢查更新失敗，請稍後再試。',
  changeDataDirTitle: '選擇資料目錄',
  changeDataDirConfirm: (dir) =>
    `將使用這個目錄儲存資料：\n${dir}\n\n既有的資料不會被移動或複製；選一個空資料夾會從頭開始，選一個原有的 Dramai 資料目錄會繼續使用其中的內容。應用程式將重新啟動。`,
  restartNow: '重新啟動應用程式',
  plainSecretsTitle: '沒有可用的系統加密',
  plainSecrets:
    '這台電腦上沒有可用的系統金鑰庫，API Key 會以僅目前使用者可讀的檔案儲存（沒有加密）。在 Linux 上安裝並解鎖 GNOME Keyring 或 KWallet 後，重新啟動應用程式會自動改為加密儲存。',
  updateLocalHint:
    'This is a locally built install. To update: pull the latest code and run pnpm desktop:install again (it replaces the old copy and leaves your data alone).',
  ffmpegMissingTitle: 'ffmpeg was not found',
  ffmpegMissing: (platform) =>
    `Dramai needs ffmpeg to compose videos and export the final cut. It was not found on this computer.\n\nInstall it, then restart Dramai:\n${ffmpegInstallLines(platform, 'en')}\n\nBurning subtitles into the picture also needs an ffmpeg build with libass. You can also set the DRAMAI_FFMPEG environment variable to the full path of ffmpeg.`,
  dontRemind: "Don't remind me",
  ok: '好',
  aboutTitle: '關於 Dramai',
  aboutDetail: (v) =>
    `版本 ${v.app}\nElectron ${v.electron} · Chromium ${v.chrome} · Node ${v.node}\n資料目錄：${v.data}\n\nApache-2.0 授權`,
  openProject: '專案首頁',
  menu: {
    file: '檔案',
    edit: '編輯',
    view: '檢視',
    window: '視窗',
    help: '說明',
    changeDataDir: '變更資料目錄…',
    openDataDir: '在資料夾中顯示資料目錄',
    openLogs: '開啟日誌資料夾',
    checkUpdates: '檢查更新…',
    autoCheck: '啟動時檢查更新',
    about: '關於 Dramai',
    homepage: '專案首頁',
    reportIssue: '回報問題',
    ffmpegHelp: '設定 ffmpeg…',
    language: '語言',
    languageAuto: '跟隨系統',
  },
}

export const strings: Record<Lang, Strings> = { 'zh-CN': zhCN, 'zh-TW': zhTW, en }
export type { Strings }
