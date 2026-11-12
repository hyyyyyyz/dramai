import { contextBridge, ipcRenderer } from 'electron'
import { BRIDGE_CHANNELS } from '../shared/bridge.ts'
import type { DramaiDesktopBridge } from '../shared/bridge.ts'

/**
 * 预加载（沙箱内运行）。只暴露一个冻结的小对象，不把 ipcRenderer 或任何 Electron 对象交给页面。
 */
const bridge: DramaiDesktopBridge = {
  getInfo: () => ipcRenderer.invoke(BRIDGE_CHANNELS.getInfo),
  selectFolder: (options) => ipcRenderer.invoke(BRIDGE_CHANNELS.selectFolder, options),
  revealProjectFile: (target) => ipcRenderer.invoke(BRIDGE_CHANNELS.revealProjectFile, target),
  notify: (notification) => ipcRenderer.invoke(BRIDGE_CHANNELS.notify, notification),
}

contextBridge.exposeInMainWorld('dramaiDesktop', Object.freeze(bridge))
