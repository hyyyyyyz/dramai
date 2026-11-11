import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'dramai.theme'

/** 工作台默认深色（剪辑室）；用户选择记在 localStorage（读写都包 try/catch：隐私模式下会抛）。 */
export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* 存储不可用 */
  }
  return 'dark'
}

const listeners = new Set<() => void>()

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* 存储不可用：本次会话内仍然生效 */
  }
  for (const fn of listeners) fn()
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'),
  )
  return [theme, applyTheme]
}
