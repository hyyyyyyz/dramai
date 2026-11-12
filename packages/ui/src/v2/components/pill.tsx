import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const pillVariants = cva(
  'inline-flex h-6 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-2 text-xs',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-2 text-muted-foreground',
        info: 'bg-info-soft text-info',
        success: 'bg-success-soft text-success',
        warn: 'bg-warn-soft text-warn',
        danger: 'bg-danger-soft text-danger',
        // 进行中：用 accent-text 而不是 accent，文字对比度才够
        accent: 'bg-accent-soft text-accent-text',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface PillProps extends ComponentProps<'span'>, VariantProps<typeof pillVariants> {
  /** 空心圆点：表示「未开始」。 */
  hollow?: boolean
  /** 不要圆点（纯文字胶囊）。 */
  dot?: boolean
}

/** 状态胶囊：圆点加文字。颜色从不单独传递含义，文字必须写出状态。 */
export function Pill({
  tone,
  hollow = false,
  dot = true,
  className,
  children,
  ...props
}: PillProps) {
  return (
    <span className={cn(pillVariants({ tone }), className)} {...props}>
      {dot && (
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full bg-current',
            hollow && 'bg-transparent shadow-[inset_0_0_0_1.5px_currentColor]',
          )}
        />
      )}
      {children}
    </span>
  )
}
