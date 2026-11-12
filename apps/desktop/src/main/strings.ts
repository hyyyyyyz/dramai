export type Lang = 'zh' | 'en'

export function detectLang(locale: string): Lang {
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

const zh = {
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
  },
}

type Strings = typeof zh

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
  },
}

export const strings: Record<Lang, Strings> = { zh, en }
export type { Strings }
