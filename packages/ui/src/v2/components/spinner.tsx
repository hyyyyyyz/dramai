import { Loader } from 'lucide-react'
import { cn } from '../lib/cn'
import { iconProps } from '../lib/icon'

/** 按钮内的加载指示。只用在按钮里；页面级加载用 Skeleton，不整页转圈。 */
export function Spinner({ className }: { className?: string }) {
  return (
    <Loader
      {...iconProps}
      className={cn('animate-spin motion-reduce:animate-none', className)}
      aria-hidden
    />
  )
}
