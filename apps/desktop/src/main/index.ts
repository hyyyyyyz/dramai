import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  safeStorage,
  session,
  shell,
  utilityProcess,
} from 'electron'
import type { Session } from 'electron'
import pkg from '../../package.json' with { type: 'json' }
import { BRIDGE_CHANNELS } from '../shared/bridge.ts'
import type { DramaiDesktopInfo } from '../shared/bridge.ts'
import type { ServerStartOptions } from '../shared/protocol.ts'
import { originOf, withAuthHeader } from './auth.ts'
import { ConfigStore } from './config.ts'
import { resolveBundledFfmpeg, withToolDirs } from './ffmpeg.ts'
import { createFileLogger } from './logger.ts'
import { buildMenuTemplate } from './menu.ts'
import { canOpenExternally, isAppUrl, isTrustedSender } from './navigation.ts'
import { cleanText, parseFolderRequest, resolveProjectPath } from './native.ts'
import { resolveDataDir } from './paths.ts'
import { isPermissionAllowed } from './permissions.ts'
import { chooseListenPort } from './ports.ts'
import { SecretVault } from './secret-vault.ts'
import type { SecretCrypto } from './secret-vault.ts'
import { ServerHost, ServerStartError } from './server-host.ts'
import { acquireSingleInstance } from './single-instance.ts'
import { isLangPreference, resolveLang, strings } from './strings.ts'
import type { Lang, LangPreference } from './strings.ts'
import { generateToken } from './token.ts'
import { checkForUpdate, repoSlug } from './updates.ts'

// —— 进程内的几个常量 ——
const distDir = fileURLToPath(new URL('.', import.meta.url))
const devUrl = process.env.DRAMAI_DESKTOP_DEV_URL // 开发形态：窗口加载前端开发服务器
const isDev = Boolean(devUrl)
const repo = repoSlug(pkg.repository.url) ?? 'hyyyyyyz/dramai'
const PARTITION = 'persist:dramai'

// 应用名决定 userData 位置；开发形态单独一个，不碰正式安装的数据。
app.setName(isDev ? 'Dramai Dev' : 'Dramai')
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', join(app.getPath('appData'), app.getName()))
}

const log = createFileLogger(app.getPath('logs'))
let lang: Lang = 'en'
const s = () => strings[lang]

/** 切换界面语言：保存选择，重建菜单；对话框每次弹出时取当前语言，所以下一次就是新语言。 */
function setLanguagePreference(preference: LangPreference): void {
  config.update({ language: preference })
  lang = resolveLang(preference, app.getLocale())
  installMenu()
}

// —— 状态 ——
const state = {
  token: generateToken(),
  /** 窗口里页面的来源（令牌只发给这些来源）。 */
  origins: new Set<string>(),
  serverUrl: undefined as string | undefined,
  dataDir: '',
  win: undefined as BrowserWindow | undefined,
  secretMode: 'plain' as 'os' | 'plain',
  quitting: false,
  shutdownDone: false,
  restarting: false,
}

let config!: ConfigStore
let vault!: SecretVault
let host!: ServerHost

// —— 系统加密（safeStorage 的异步接口；同步接口在 Electron 45 起已弃用，46 移除）——
const osCrypto: SecretCrypto = {
  async available() {
    try {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
      // Linux 上没有密码管理器时 Electron 退到写死密码的 basic_text，那只是混淆，不当作加密。
      return (
        process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
      )
    } catch {
      return false
    }
  },
  encrypt: (plain) => safeStorage.encryptStringAsync(plain),
  async decrypt(data) {
    const r = await safeStorage.decryptStringAsync(Buffer.from(data))
    return { plain: r.result, reEncrypt: r.shouldReEncrypt }
  },
}

// —— 会话：令牌注入、权限、导航限制 ——
function installSession(ses: Session): void {
  ses.setSpellCheckerEnabled(false) // 拼写词典要从 Google 下载，本地优先的应用不做这种联网
  ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*'] }, (details, callback) => {
    callback({
      requestHeaders: withAuthHeader(
        details.url,
        details.requestHeaders,
        state.origins,
        state.token,
      ) as Record<string, string>,
    })
  })
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(isPermissionAllowed(permission, details.requestingUrl, state.origins))
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    isPermissionAllowed(permission, requestingOrigin, state.origins),
  )
  ses.setDevicePermissionHandler(() => false)
}

app.on('web-contents-created', (_event, contents) => {
  const guard = (event: Electron.Event, url: string) => {
    if (isAppUrl(url, state.origins)) return
    event.preventDefault()
    if (canOpenExternally(url)) void shell.openExternal(url)
  }
  contents.on('will-navigate', (event, url) => guard(event, url))
  contents.on('will-redirect', (event, url) => guard(event, url))
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url, state.origins) && canOpenExternally(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

// —— 窗口 ——
function createWindow(target: string): BrowserWindow {
  const saved = config.get().window
  const win = new BrowserWindow({
    width: saved?.width ?? 1360,
    height: saved?.height ?? 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: s().appName,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b0f' : '#ffffff',
    webPreferences: {
      preload: join(distDir, 'preload.cjs'),
      session: session.fromPartition(PARTITION),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: isDev || !app.isPackaged,
    },
  })
  if (saved?.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  win.on('close', () => {
    if (win.isDestroyed()) return
    const { width, height } = win.getNormalBounds()
    config.update({ window: { width, height, maximized: win.isMaximized() } })
  })
  win.on('closed', () => {
    if (state.win === win) state.win = undefined
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log('error', `renderer gone: ${details.reason}`)
    if (state.quitting) return
    void dialog
      .showMessageBox({
        type: 'error',
        title: s().rendererGoneTitle,
        message: s().rendererGoneTitle,
        buttons: [s().reload, s().quit],
        defaultId: 0,
        cancelId: 1,
      })
      .then((r) => (r.response === 0 ? win.reload() : app.quit()))
  })
  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (isMainFrame) log('error', `load failed: ${description} (${code}) ${originOf(url) ?? ''}`)
  })
  void win.loadURL(target)
  if (process.env.DRAMAI_DESKTOP_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  state.win = win
  return win
}

function focusWindow(): void {
  const win = state.win
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// —— 服务 ——
function ffmpegOptions(): Pick<ServerStartOptions, 'ffmpegPath' | 'ffprobePath'> {
  const bundled = resolveBundledFfmpeg(process.resourcesPath)
  if (bundled) log('info', `using bundled ffmpeg: ${bundled.ffmpegPath}`)
  return bundled ?? {}
}

async function startServer(): Promise<void> {
  const devPort = Number(process.env.DRAMAI_DESKTOP_SERVER_PORT) || undefined
  const port = devPort ?? (await chooseListenPort(config.get().port))
  const demoNotice = process.env.DRAMAI_DESKTOP_DEMO_MOCK ? DEMO_NOTICE : undefined
  const ready = await host.start({
    dataDir: state.dataDir,
    port,
    token: state.token,
    staticDir: isDev ? undefined : join(distDir, 'web'),
    version: app.getVersion(),
    ...ffmpegOptions(),
    demoNotice,
  })
  state.serverUrl = ready.url
  state.origins = new Set([originOf(devUrl ?? ready.url)!])
  if (!isDev) config.update({ port: ready.port })
  log('info', `server ready at ${ready.url}`)
}

const DEMO_NOTICE = {
  zh: '演示模式：服务商是本机的模拟服务，不会产生任何费用，生成的是占位内容（不是真实作品）。',
  en: 'Demo mode: the providers are local simulations. Nothing is charged, and the generated content is placeholder, not real work.',
}

/** 开发形态的演示模式：服务起来后，建好指向本机模拟服务商的配置。演示代码只在开发构建里存在。 */
async function seedDemoIfRequested(): Promise<void> {
  const mockUrl = process.env.DRAMAI_DESKTOP_DEMO_MOCK
  if (!mockUrl || app.isPackaged || !state.serverUrl) return
  try {
    const mod = (await import(pathToFileURL(join(distDir, 'demo.mjs')).href)) as {
      seedDemo(options: {
        serverUrl: string
        token: string
        mockUrl: string
        lang: 'zh' | 'en'
      }): Promise<void>
    }
    await mod.seedDemo({
      serverUrl: state.serverUrl,
      token: state.token,
      mockUrl,
      lang: lang === 'en' ? 'en' : 'zh',
    })
    log('info', `demo providers ready (mock at ${mockUrl})`)
  } catch (err) {
    log('error', `demo seeding failed: ${String(err)}`)
  }
}

async function showStartFailure(err: unknown): Promise<'retry' | 'choose' | 'quit'> {
  const code = err instanceof ServerStartError ? err.code : 'UNKNOWN'
  const message = err instanceof Error ? err.message : String(err)
  log('error', `server failed to start: ${code}: ${message}`)
  const text = s().startFailed[code](state.dataDir)
  const r = await dialog.showMessageBox({
    type: 'error',
    title: s().startFailedTitle,
    message: s().startFailedTitle,
    detail: `${text}\n\n${s().details}: ${message}`,
    buttons: [s().retry, s().chooseDataDir, s().quit],
    defaultId: 0,
    cancelId: 2,
  })
  return (['retry', 'choose', 'quit'] as const)[r.response] ?? 'quit'
}

// —— 数据目录 ——
async function chooseDataDirAndRestart(): Promise<boolean> {
  const picked = await dialog.showOpenDialog({
    title: s().changeDataDirTitle,
    defaultPath: state.dataDir,
    properties: ['openDirectory', 'createDirectory'],
  })
  const dir = picked.filePaths[0]
  if (picked.canceled || !dir) return false
  const confirm = await dialog.showMessageBox({
    type: 'question',
    title: s().changeDataDirTitle,
    message: s().changeDataDirTitle,
    detail: s().changeDataDirConfirm(dir),
    buttons: [s().restartNow, s().cancel],
    defaultId: 0,
    cancelId: 1,
  })
  if (confirm.response !== 0) return false
  config.update({ dataDir: dir, port: undefined })
  state.restarting = true
  app.relaunch()
  app.quit()
  return true
}

// —— 更新检查 ——
async function runUpdateCheck(manual: boolean): Promise<void> {
  const result = await checkForUpdate({ currentVersion: app.getVersion(), repo })
  config.update({ lastUpdateCheck: Date.now() })
  const parent = state.win && !state.win.isDestroyed() ? state.win : undefined
  const show = (options: Electron.MessageBoxOptions) =>
    parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
  if (result.status === 'available') {
    if (!manual && config.get().skippedVersion === result.release.version) return
    const r = await show({
      type: 'info',
      title: s().updateAvailableTitle,
      message: s().updateAvailableTitle,
      detail: s().updateAvailable(app.getVersion(), result.release.version),
      buttons: [s().openReleasePage, s().later, s().skipVersion],
      defaultId: 0,
      cancelId: 1,
    })
    if (r.response === 0) void shell.openExternal(result.release.url)
    if (r.response === 2) config.update({ skippedVersion: result.release.version })
  } else if (manual) {
    await show({
      type: result.status === 'error' ? 'warning' : 'info',
      title: s().menu.checkUpdates,
      message: result.status === 'error' ? s().updateCheckFailed : s().upToDate(app.getVersion()),
      buttons: [s().ok],
    })
  } else if (result.status === 'error') {
    log('error', `update check failed: ${result.message}`)
  }
}

function scheduleUpdateCheck(): void {
  if (isDev || !config.get().checkForUpdates) return
  const last = config.get().lastUpdateCheck ?? 0
  if (Date.now() - last < 6 * 60 * 60 * 1000) return // 对 GitHub 的匿名接口客气一点
  setTimeout(() => void runUpdateCheck(false), 8_000).unref()
}

// —— About / 菜单 ——
async function showAbout(): Promise<void> {
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: s().aboutTitle,
    message: `${s().appName} ${app.getVersion()}`,
    detail: s().aboutDetail({
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      data: state.dataDir,
    }),
    buttons: [s().ok, s().openProject],
    defaultId: 0,
  }
  const r = state.win
    ? await dialog.showMessageBox(state.win, options)
    : await dialog.showMessageBox(options)
  if (r.response === 1) void shell.openExternal(pkg.homepage)
}

function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({
        platform: process.platform,
        strings: s(),
        devTools: !app.isPackaged,
        autoCheck: config.get().checkForUpdates,
        language: config.get().language ?? 'auto',
        homepage: pkg.homepage,
        issuesUrl: pkg.bugs.url,
        actions: {
          about: () => void showAbout(),
          checkForUpdates: () => void runUpdateCheck(true),
          toggleAutoCheck: (next) => config.update({ checkForUpdates: next }),
          changeDataDir: () => void chooseDataDirAndRestart(),
          showDataDir: () => void shell.openPath(state.dataDir),
          openLogs: () => void shell.openPath(app.getPath('logs')),
          openExternal: (url) => void shell.openExternal(url),
          setLanguage: setLanguagePreference,
        },
      }),
    ),
  )
}

// —— 渲染进程能调用的原生能力 ——
const activeNotifications = new Set<Notification>()

function registerIpc(): void {
  const trusted = (event: Electron.IpcMainInvokeEvent): boolean => {
    const url = event.senderFrame?.url
    return (
      url !== undefined &&
      event.sender === state.win?.webContents &&
      isTrustedSender(url, state.origins)
    )
  }
  const handle = <T>(
    channel: string,
    fn: (arg: unknown, event: Electron.IpcMainInvokeEvent) => Promise<T> | T,
  ) =>
    ipcMain.handle(channel, (event, arg) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      return fn(arg, event)
    })

  handle(
    BRIDGE_CHANNELS.getInfo,
    (): DramaiDesktopInfo => ({
      version: app.getVersion(),
      platform: process.platform as DramaiDesktopInfo['platform'],
      arch: process.arch,
      dataDir: state.dataDir,
      secretStorage: state.secretMode,
      language: lang,
      languagePreference: config.get().language ?? 'auto',
    }),
  )

  handle(BRIDGE_CHANNELS.setLanguage, (arg) => {
    if (!isLangPreference(arg)) return false
    setLanguagePreference(arg)
    return true
  })

  handle(BRIDGE_CHANNELS.selectFolder, async (arg) => {
    const request = parseFolderRequest(arg)
    const options: Electron.OpenDialogOptions = {
      title: request.title,
      defaultPath: request.defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    }
    const r = state.win
      ? await dialog.showOpenDialog(state.win, options)
      : await dialog.showOpenDialog(options)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  handle(BRIDGE_CHANNELS.revealProjectFile, (arg) => {
    const v = (typeof arg === 'object' && arg !== null ? arg : {}) as Record<string, unknown>
    const full = resolveProjectPath(state.dataDir, v.projectId, v.path)
    if (!full || !existsSync(full)) return false
    if (v.path === undefined || v.path === '') void shell.openPath(full)
    else shell.showItemInFolder(full)
    return true
  })

  handle(BRIDGE_CHANNELS.notify, (arg) => {
    const v = (typeof arg === 'object' && arg !== null ? arg : {}) as Record<string, unknown>
    const title = cleanText(v.title, 120)
    if (!title || !Notification.isSupported()) return false
    if (state.win?.isFocused()) return false // 人就在窗口前，不打扰
    const notification = new Notification({ title, body: cleanText(v.body, 400) })
    activeNotifications.add(notification)
    notification.on('click', focusWindow)
    notification.on('close', () => activeNotifications.delete(notification))
    notification.show()
    return true
  })
}

// —— 退出 ——
async function runningJobCount(): Promise<number> {
  if (!state.serverUrl || host.state !== 'running') return 0
  try {
    const res = await fetch(`${state.serverUrl}/api/jobs?status=running&limit=100`, {
      headers: { Authorization: `Bearer ${state.token}` },
      signal: AbortSignal.timeout(2_000),
    })
    if (!res.ok) return 0
    const body = (await res.json()) as { items?: unknown[] }
    return body.items?.length ?? 0
  } catch {
    return 0
  }
}

app.on('before-quit', (event) => {
  // 还没有服务可关（比如第二个实例拿不到单实例锁就退出）时，直接放行。
  if (state.shutdownDone || !host) return
  event.preventDefault()
  if (state.quitting) return
  state.quitting = true
  void (async () => {
    if (!state.restarting) {
      const n = await runningJobCount()
      if (n > 0) {
        const r = await dialog.showMessageBox({
          type: 'warning',
          title: s().quitConfirmTitle,
          message: s().quitConfirmTitle,
          detail: s().quitConfirm(n),
          buttons: [s().quitAnyway, s().cancel],
          defaultId: 1,
          cancelId: 1,
        })
        if (r.response !== 0) {
          state.quitting = false
          return
        }
      }
    }
    // 不等在跑的任务：它们留给下次启动的恢复逻辑。数据库和数据目录锁在服务关闭时释放。
    await host.stop({ graceful: false }).catch((err) => log('error', `stop failed: ${String(err)}`))
    state.shutdownDone = true
    app.quit()
  })()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (state.win || host?.state !== 'running' || !state.serverUrl) return
  createWindow(devUrl ?? state.serverUrl)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => app.quit())

// —— 启动 ——
async function main(): Promise<void> {
  if (!acquireSingleInstance(app, focusWindow)) return
  await app.whenReady()
  config = new ConfigStore(join(app.getPath('userData'), 'desktop.json'))
  lang = resolveLang(config.get().language, app.getLocale())

  const resolved = resolveDataDir({
    env: process.env,
    configured: config.get().dataDir,
    userData: app.getPath('userData'),
  })
  state.dataDir = resolved.dir
  log(
    'info',
    `dramai desktop ${app.getVersion()} (${process.platform}/${process.arch}), data: ${resolved.dir} (${resolved.source})`,
  )

  vault = new SecretVault(join(state.dataDir, 'secrets.json'), osCrypto, log)
  try {
    state.secretMode = await vault.init()
  } catch (err) {
    log('error', `secret vault init failed: ${String(err)}`)
  }

  const env = withToolDirs(process.env as Record<string, string | undefined>)
  host = new ServerHost({
    fork: () =>
      utilityProcess.fork(join(distDir, 'server', 'server.mjs'), [], {
        serviceName: 'dramai-server',
        stdio: 'pipe',
        env: env as Record<string, string>,
      }) as unknown as ReturnType<ConstructorParameters<typeof ServerHost>[0]['fork']>,
    secrets: vault,
    log,
  })
  host.on('crashed', () => void onServerCrashed())

  installSession(session.fromPartition(PARTITION))
  registerIpc()
  installMenu()

  for (;;) {
    try {
      await startServer()
      break
    } catch (err) {
      const choice = await showStartFailure(err)
      if (choice === 'retry') continue
      if (choice === 'choose' && (await chooseDataDirAndRestart())) return
      if (choice === 'choose') continue
      state.shutdownDone = true
      app.quit()
      return
    }
  }

  if (state.secretMode === 'plain' && !config.get().plainSecretsNoticeShown) {
    config.update({ plainSecretsNoticeShown: true })
    void dialog.showMessageBox({
      type: 'info',
      title: s().plainSecretsTitle,
      message: s().plainSecretsTitle,
      detail: s().plainSecrets,
      buttons: [s().ok],
    })
  }

  await seedDemoIfRequested()
  createWindow(devUrl ?? state.serverUrl!)
  scheduleUpdateCheck()
}

async function onServerCrashed(): Promise<void> {
  if (state.quitting) return
  const r = await dialog.showMessageBox({
    type: 'error',
    title: s().crashedTitle,
    message: s().crashedTitle,
    detail: s().crashed,
    buttons: [s().restartServer, s().openLogs, s().quit],
    defaultId: 0,
    cancelId: 2,
  })
  if (r.response === 1) void shell.openPath(app.getPath('logs'))
  if (r.response !== 0) {
    state.shutdownDone = true
    app.quit()
    return
  }
  for (;;) {
    try {
      await startServer()
      void state.win?.loadURL(devUrl ?? state.serverUrl!)
      return
    } catch (err) {
      const choice = await showStartFailure(err)
      if (choice === 'retry') continue
      state.shutdownDone = true
      app.quit()
      return
    }
  }
}

void main().catch((err) => {
  log('error', `fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  dialog.showErrorBox('Dramai', err instanceof Error ? err.message : String(err))
  state.shutdownDone = true
  app.exit(1)
})
