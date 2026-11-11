import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export interface ChipProps extends Omit<ComponentProps<'button'>, 'type'> {
  /** 传了就是可选芯片（button + aria-pressed）；不传就是静态标签（span）。 */
  pressed?: boolean
}

/** 标签与可选项：4px 圆角、常规字重，和状态胶囊（Pill）是两种东西。 */
export function Chip({ pressed, className, children, onClick, ...props }: ChipProps) {
  const base =
    'inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-border bg-surface-2 px-2 text-xs text-muted-foreground'
  if (pressed === undefined && !onClick) {
    return (
      <span className={cn(base, className)} {...(props as ComponentProps<'span'>)}>
        {children}
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        base,
        'cursor-pointer transition-colors duration-(--duration-fast) ease-standard',
        'hover:border-border-strong hover:text-foreground',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        pressed && 'border-accent bg-accent-soft text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
