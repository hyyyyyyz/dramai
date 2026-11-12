/**
 * 预加载脚本暴露给页面的 `window.dramaiDesktop`。刻意很小：页面能做的事仍然都走本地服务的 HTTP 接口，
 * 这里只放必须由桌面壳完成的原生能力。所有调用都返回 Promise，参数在主进程里重新校验。
 */
export interface DramaiDesktopInfo {
  /** 应用版本（和 About 里显示的一致）。 */
  version: string
  platform: 'darwin' | 'win32' | 'linux'
  arch: string
  /** 当前使用的数据目录（绝对路径）。 */
  dataDir: string
  /** API Key 的保存方式：`os` = 操作系统加密；`plain` = 没有系统加密可用，文件权限保护。 */
  secretStorage: 'os' | 'plain'
  /** 原生菜单和对话框当前用的语言（已解析）和用户的选择（`auto` = 跟随系统）。 */
  language: 'en' | 'zh-CN' | 'zh-TW'
  languagePreference: 'auto' | 'en' | 'zh-CN' | 'zh-TW'
}

export interface DramaiDesktopBridge {
  /** 版本、平台、数据目录等；页面据此判断自己是不是跑在桌面壳里（`window.dramaiDesktop !== undefined`）。 */
  getInfo(): Promise<DramaiDesktopInfo>
  /** 弹出系统的“选择文件夹”对话框；取消返回 null。 */
  selectFolder(options?: { title?: string; defaultPath?: string }): Promise<string | null>
  /**
   * 在访达 / 资源管理器里显示项目里的文件（`<数据目录>/projects/<projectId>/<path>`）。
   * 不给 path 就打开项目文件夹。文件不存在返回 false。路径必须在项目文件夹内。
   */
  revealProjectFile(target: { projectId: string; path?: string }): Promise<boolean>
  /** 系统通知（比如长任务完成）。窗口在前台时不弹，返回 false。点击通知会把窗口提到前面。 */
  notify(notification: { title: string; body?: string }): Promise<boolean>
  /**
   * 设置页切换界面语言时调用，让原生菜单和对话框跟着变（桌面端自己的菜单“视图 → 语言”也会改同一个值）。
   * 网页界面本身的语言仍由前端决定；`auto` = 跟随系统。参数不合法返回 false。
   */
  setLanguage(language: 'auto' | 'en' | 'zh-CN' | 'zh-TW'): Promise<boolean>
}

export const BRIDGE_CHANNELS = {
  getInfo: 'dramai:get-info',
  selectFolder: 'dramai:select-folder',
  revealProjectFile: 'dramai:reveal-project-file',
  notify: 'dramai:notify',
  setLanguage: 'dramai:set-language',
} as const
