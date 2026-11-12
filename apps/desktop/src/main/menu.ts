import type { MenuItemConstructorOptions } from 'electron'
import type { Strings } from './strings.ts'

export interface MenuActions {
  about(): void
  checkForUpdates(): void
  toggleAutoCheck(next: boolean): void
  changeDataDir(): void
  showDataDir(): void
  openLogs(): void
  openExternal(url: string): void
}

export interface MenuInput {
  platform: NodeJS.Platform
  strings: Strings
  /** 开发形态才有开发者工具。 */
  devTools: boolean
  autoCheck: boolean
  homepage: string
  issuesUrl: string
  actions: MenuActions
}

/** 应用菜单的模板。纯数据，不碰 electron 的运行时，方便测试。 */
export function buildMenuTemplate(input: MenuInput): MenuItemConstructorOptions[] {
  const { platform, strings: s, actions } = input
  const mac = platform === 'darwin'

  const aboutItem: MenuItemConstructorOptions = {
    label: s.menu.about,
    click: () => actions.about(),
  }

  const appMenu: MenuItemConstructorOptions[] = mac
    ? [
        {
          label: s.appName,
          submenu: [
            aboutItem,
            { label: s.menu.checkUpdates, click: () => actions.checkForUpdates() },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
      ]
    : []

  const file: MenuItemConstructorOptions = {
    label: s.menu.file,
    submenu: [
      { label: s.menu.changeDataDir, click: () => actions.changeDataDir() },
      { label: s.menu.openDataDir, click: () => actions.showDataDir() },
      ...(mac ? [] : ([{ type: 'separator' }, { role: 'quit' }] as MenuItemConstructorOptions[])),
    ],
  }

  const edit: MenuItemConstructorOptions = {
    label: s.menu.edit,
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  }

  const view: MenuItemConstructorOptions = {
    label: s.menu.view,
    submenu: [
      { role: 'reload' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(input.devTools
        ? ([{ type: 'separator' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
        : []),
    ],
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: s.menu.window,
    submenu: mac
      ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'close' }],
  }

  const help: MenuItemConstructorOptions = {
    label: s.menu.help,
    role: 'help',
    submenu: [
      { label: s.menu.homepage, click: () => actions.openExternal(input.homepage) },
      { label: s.menu.reportIssue, click: () => actions.openExternal(input.issuesUrl) },
      { type: 'separator' },
      { label: s.menu.openLogs, click: () => actions.openLogs() },
      { type: 'separator' },
      { label: s.menu.checkUpdates, click: () => actions.checkForUpdates() },
      {
        label: s.menu.autoCheck,
        type: 'checkbox',
        checked: input.autoCheck,
        click: (item) => actions.toggleAutoCheck(item.checked),
      },
      ...(mac ? [] : ([{ type: 'separator' }, aboutItem] as MenuItemConstructorOptions[])),
    ],
  }

  return [...appMenu, file, edit, view, windowMenu, help]
}
