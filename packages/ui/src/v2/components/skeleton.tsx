import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

/** 列表加载占位：静态的表面色块。规范不做呼吸、脉冲、闪烁，也不整页转圈。 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden className={cn('rounded-md bg-surface-2', className)} {...props} />
}
