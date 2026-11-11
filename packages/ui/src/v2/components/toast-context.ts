import { createContext, useContext, type ReactNode } from 'react'

export interface ToastOptions {
  title: ReactNode
  description?: ReactNode
  /** success：保存成功、复制成功；info：一般提示。失败不用 toast，进任务面板。 */
  tone?: 'success' | 'info'
  /** 毫秒，默认 4000；0 表示不自动消失。 */
  duration?: number
}

export interface ToastApi {
  toast: (options: ToastOptions) => number
  dismiss: (id: number) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内使用')
  return ctx
}
