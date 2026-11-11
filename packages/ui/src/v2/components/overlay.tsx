import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../lib/cn'
import { iconProps } from '../lib/icon'
import { useOverlayBehavior } from '../lib/use-focus-trap'
import { IconButton } from './icon-button'

export interface OverlayProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
  /** 默认 true：点击遮罩关闭。涉及不可逆操作的确认框请设为 false。 */
  dismissOnBackdrop?: boolean
  closeLabel?: string
}

interface OverlayShellProps extends OverlayProps {
  /** 容器类：决定是居中弹窗还是侧边抽屉。 */
  frameClassName: string
  panelClassName: string
}

function OverlayShell({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  dismissOnBackdrop = true,
  closeLabel = '关闭',
  frameClassName,
  panelClassName,
}: OverlayShellProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  useOverlayBehavior(open, ref, onClose)
  if (!open) return null

  return createPortal(
    <div
      className={cn('fixed inset-0 z-50 animate-fade-in bg-scrim', frameClassName)}
      onMouseDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'flex flex-col overflow-hidden bg-surface text-foreground shadow-pop outline-none',
          panelClassName,
          className,
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between gap-3 border-b border-border py-4 pr-4 pl-6">
            <div className="min-w-0">
              {title && (
                <h2 id={titleId} className="font-display text-title-md font-bold">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="mt-1 text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <IconButton label={closeLabel} onClick={onClose} className="-my-1">
              <X {...iconProps} aria-hidden />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

export interface ModalProps extends OverlayProps {
  size?: 'sm' | 'md' | 'lg'
}

const modalSize = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const

/** 弹窗：12px 圆角、shadow-pop、标题黑体 700 18px；焦点陷阱、Esc、关闭后焦点归还。 */
export function Modal({ size = 'md', ...props }: ModalProps) {
  return (
    <OverlayShell
      {...props}
      frameClassName="flex items-center justify-center p-4"
      panelClassName={cn(
        'w-full animate-pop-in rounded-xl max-h-[calc(100dvh-32px)]',
        modalSize[size],
      )}
    />
  )
}

export interface DrawerProps extends OverlayProps {
  /** right：任务面板（≤1180px）；bottom：手机上的任务抽屉。 */
  side?: 'right' | 'bottom'
}

export function Drawer({ side = 'right', ...props }: DrawerProps) {
  return (
    <OverlayShell
      {...props}
      frameClassName={side === 'right' ? 'flex justify-end' : 'flex items-end'}
      panelClassName={
        side === 'right'
          ? 'h-full w-full max-w-sm animate-slide-in-right border-l border-border'
          : 'max-h-[85dvh] w-full animate-slide-in-bottom rounded-t-xl border-t border-border'
      }
    />
  )
}
