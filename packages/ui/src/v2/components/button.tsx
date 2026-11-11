import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'
import { buttonVariants, type ButtonVariants } from './button-variants'
import { Spinner } from './spinner'

export interface ButtonProps extends ComponentProps<'button'>, ButtonVariants {
  /** 提交中：显示指示、禁用点击，宽度不变（图标位被占用）。 */
  loading?: boolean
}

export function Button({
  className,
  variant,
  size,
  type = 'button',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}
