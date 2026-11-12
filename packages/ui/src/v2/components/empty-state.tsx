import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** 可选的线性图标（24px）。 */
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** 一个主操作。 */
  action?: ReactNode
}

/** 空状态：标题（黑体 700）加一句话加一个主操作。不放插画和表情。 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      {icon && <div className="text-subtle">{icon}</div>}
      <h3 className="font-display text-title-sm font-bold">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
