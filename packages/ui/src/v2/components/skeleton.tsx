import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

/** 列表加载占位。不用旋转 spinner 占满整页；reduce-motion 下不闪烁。 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-skeleton rounded-md bg-surface-2 motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  )
}
