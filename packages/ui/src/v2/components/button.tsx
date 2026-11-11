import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'
import { buttonVariants, type ButtonVariants } from './button-variants'
import { BusyBar } from './progress'

export interface ButtonProps extends ComponentProps<'button'>, ButtonVariants {
  /** 提交中：禁用点击，底边出现不确定进度条，宽度不变。 */
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
      className={cn(
        buttonVariants({ variant, size }),
        loading && 'relative overflow-hidden',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
      {/* 提交中：贴在按钮底边的不确定进度条（系统里唯一的循环动画），按钮宽度不变 */}
      {loading && <BusyBar className="absolute inset-x-0 bottom-0 bg-transparent" />}
    </button>
  )
}
