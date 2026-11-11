import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Info, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { iconProps } from '../lib/icon'
import { IconButton } from './icon-button'
import { ToastContext, type ToastOptions } from './toast-context'

interface ToastItem extends ToastOptions {
  id: number
}

/** 在应用根部包一层，之后任何地方 `useToast()`。 */
export function ToastProvider({
  children,
  dismissLabel = '关闭',
}: {
  children: ReactNode
  dismissLabel?: string
}) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => setItems((s) => s.filter((t) => t.id !== id)), [])
  const toast = useCallback((options: ToastOptions) => {
    const id = ++seq.current
    setItems((s) => [...s.slice(-3), { ...options, id }])
    return id
  }, [])
  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          role="region"
          aria-label="通知"
          className="pointer-events-none fixed right-4 bottom-4 z-70 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
        >
          {items.map((t) => (
            <ToastView key={t.id} item={t} onDismiss={dismiss} dismissLabel={dismissLabel} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

function ToastView({
  item,
  onDismiss,
  dismissLabel,
}: {
  item: ToastItem
  onDismiss: (id: number) => void
  dismissLabel: string
}) {
  const { id, duration = 4000, tone = 'info' } = item
  useEffect(() => {
    if (duration === 0) return
    const timer = window.setTimeout(() => onDismiss(id), duration)
    return () => window.clearTimeout(timer)
  }, [id, duration, onDismiss])

  const Icon = tone === 'success' ? Check : Info
  return (
    <div
      role="status"
      className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-lg border border-border-strong bg-surface p-3 text-foreground shadow-pop"
    >
      <Icon
        {...iconProps}
        aria-hidden
        className={cn('mt-0.5 shrink-0', tone === 'success' ? 'text-success' : 'text-info')}
      />
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
        )}
      </div>
      <IconButton label={dismissLabel} size="sm" onClick={() => onDismiss(id)} className="-m-1">
        <X {...iconProps} aria-hidden />
      </IconButton>
    </div>
  )
}
