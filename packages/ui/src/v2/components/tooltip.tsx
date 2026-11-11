import {
  cloneElement,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'
import { useAnchored, type Placement } from '../lib/use-anchored'

export interface TooltipProps {
  content: ReactNode
  /** 必须是单个可聚焦元素（按钮、链接）。 */
  children: ReactElement<Record<string, unknown>>
  placement?: Placement
  /** 悬停多久后出现，ms。键盘聚焦立即出现。 */
  delay?: number
}

/** 提示：只放补充说明，不放必须读到的信息（触屏没有悬停）。鼠标悬停与键盘聚焦都会出现，Esc 收起。 */
export function Tooltip({ content, children, placement = 'top', delay = 400 }: TooltipProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const floating = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const id = useId()
  const pos = useAnchored(open, anchor, floating, placement)

  const show = (immediate: boolean) => {
    window.clearTimeout(timer.current)
    if (immediate) setOpen(true)
    else timer.current = window.setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }

  const trigger = cloneElement(children, {
    'aria-describedby': open ? id : children.props['aria-describedby'],
  })

  return (
    <>
      {/* 事件挂在包裹层上：mouseenter / focusin 冒泡，不需要改动触发元素的 ref */}
      <span
        ref={anchor}
        className="inline-flex"
        onMouseEnter={() => show(false)}
        onMouseLeave={hide}
        onFocus={() => show(true)}
        onBlur={hide}
        onKeyDown={(e: ReactKeyboardEvent) => {
          if (e.key === 'Escape') hide()
        }}
      >
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={floating}
            id={id}
            role="tooltip"
            style={{ top: pos.top, left: pos.left, visibility: pos.ready ? 'visible' : 'hidden' }}
            className={cn(
              'pointer-events-none fixed z-60 max-w-64 rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-xs text-foreground shadow-pop',
            )}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  )
}
