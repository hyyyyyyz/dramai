import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'
import { buttonVariants, type ButtonVariants } from './button-variants'
import { BusyBar } from './progress'

export interface ButtonProps extends ComponentProps<'button'>, ButtonVariants {
  /** 提交中：禁用点击，底边出现不确定进度条，宽度不变。 */
  loading?: boolean
  /**
   * 提交中也保持焦点：用 aria-disabled 加"忽略点击"代替 disabled（disabled 的按钮会丢掉焦点，键盘用户要从头 Tab）。
   * 默认 false：和以前一样，提交中直接禁用。
   */
  keepFocusWhenLoading?: boolean
}

export function Button({
  className,
  variant,
  size,
  type = 'button',
  loading = false,
  keepFocusWhenLoading = false,
  disabled,
  onClick,
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
      disabled={disabled || (loading && !keepFocusWhenLoading)}
      aria-disabled={loading && keepFocusWhenLoading ? true : undefined}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (loading && keepFocusWhenLoading) {
          e.preventDefault()
          return
        }
        onClick?.(e)
      }}
      {...props}
    >
      {children}
      {/* 提交中：贴在按钮底边的不确定进度条（系统里唯一的循环动画），按钮宽度不变 */}
      {loading && <BusyBar className="absolute inset-x-0 bottom-0 bg-transparent" />}
    </button>
  )
}
