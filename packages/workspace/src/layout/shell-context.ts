import { createContext, useContext } from 'react'

/** 外框提供给页面的少量能力：比如“查看任务”要把任务面板打开。 */
export interface ShellApi {
  openTasks: () => void
}
export const ShellContext = createContext<ShellApi>({ openTasks: () => {} })
export const useShell = () => useContext(ShellContext)
