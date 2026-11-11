import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'
import { useAnchored, type Placement } from '../lib/use-anchored'
import { useControllable } from '../lib/use-controllable'

export interface PopoverProps {
  /** 触发元素（按钮）。 */
  trigger: ReactElement<Record<string, unknown>>
  children: ReactNode | ((close: () => void) => ReactNode)
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: Placement
  className?: string
  /** 浮层的无障碍角色，Menu 用 "menu"。 */
  role?: 'dialog' | 'menu'
  'aria-label'?: string
}

/** 弹出层：点外部或按 Esc 关闭，关闭后焦点回到触发元素。内容自由，用于筛选、简短表单。 */
export function Popover({
  trigger,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  placement = 'bottom-start',
  className,
  role = 'dialog',
  ...rest
}: PopoverProps) {
  const [isOpen, setOpen] = useControllable(open, defaultOpen, onOpenChange)
  const anchor = useRef<HTMLSpanElement>(null)
  const floating = useRef<HTMLDivElement>(null)
  const id = useId()
  const pos = useAnchored(isOpen, anchor, floating, placement)
  const close = () => setOpen(false)

  useEffect(() => {
    if (!isOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (floating.current?.contains(t) || anchor.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        anchor.current?.querySelector<HTMLElement>('button, [href], [tabindex]')?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen, setOpen])

  // 打开后把焦点移进浮层（菜单由 Menu 自己处理第一项）
  useEffect(() => {
    if (isOpen && pos.ready && role === 'dialog') floating.current?.focus({ preventScroll: true })
  }, [isOpen, pos.ready, role])

  const el = cloneElement(trigger, {
    'aria-haspopup': role,
    'aria-expanded': isOpen,
    'aria-controls': isOpen ? id : undefined,
    onClick: (e: ReactMouseEvent<HTMLElement>) => {
      ;(trigger.props.onClick as ((e: ReactMouseEvent<HTMLElement>) => void) | undefined)?.(e)
      setOpen(!isOpen)
    },
  })

  return (
    <>
      <span ref={anchor} className="inline-flex">
        {el}
      </span>
      {isOpen &&
        createPortal(
          <div
            ref={floating}
            id={id}
            role={role}
            tabIndex={-1}
            aria-label={rest['aria-label']}
            style={{ top: pos.top, left: pos.left, visibility: pos.ready ? 'visible' : 'hidden' }}
            className={cn(
              'fixed z-50 min-w-40 animate-fade-in rounded-lg border border-border-strong bg-surface p-1 text-foreground shadow-pop outline-none',
              className,
            )}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </>
  )
}
