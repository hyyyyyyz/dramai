import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const iconButtonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-(--duration-fast) ease-standard',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        ghost: 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        secondary:
          'border border-border-strong bg-surface text-muted-foreground hover:bg-surface-2 hover:text-foreground',
      },
      size: {
        sm: 'size-7',
        md: 'size-8 max-[800px]:size-10',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
)

export interface IconButtonProps
  extends Omit<ComponentProps<'button'>, 'aria-label'>, VariantProps<typeof iconButtonVariants> {
  /** 必填：图标按钮没有文字，屏幕阅读器靠它。 */
  label: string
}

export function IconButton({
  label,
  variant,
  size,
  className,
  type = 'button',
  title,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
