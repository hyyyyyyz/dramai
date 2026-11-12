import type { ComponentProps, ReactNode } from 'react'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'
import { iconProps } from '../lib/icon'

const noticeVariants = cva(
  'flex gap-3 rounded-md px-4 py-3 text-sm leading-relaxed text-foreground',
  {
    variants: {
      tone: {
        warn: 'bg-warn-soft [&_svg]:text-warn',
        info: 'bg-info-soft [&_svg]:text-info',
        danger: 'bg-danger-soft [&_svg]:text-danger',
      },
    },
    defaultVariants: { tone: 'warn' },
  },
)

const icons = { warn: AlertTriangle, info: Info, danger: OctagonAlert } as const

export interface NoticeProps
  extends Omit<ComponentProps<'div'>, 'title'>, VariantProps<typeof noticeVariants> {
  title?: ReactNode
  /** 右侧或下方的操作按钮（「用新设定图重新生成」「保持现状」）。 */
  actions?: ReactNode
}

/**
 * 行内提示条：已过期（warn）、说明（info）、不能生成（danger）。图标加文字，从不只靠颜色。
 * 工作台里的 StaleNotice / BlockedNotice 在这个基础上组合。
 */
export function Notice({
  tone = 'warn',
  title,
  actions,
  className,
  children,
  ...props
}: NoticeProps) {
  const Icon = icons[tone ?? 'warn']
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(noticeVariants({ tone }), className)}
      {...props}
    >
      <Icon {...iconProps} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'text-muted-foreground')}>{children}</div>}
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  )
}
