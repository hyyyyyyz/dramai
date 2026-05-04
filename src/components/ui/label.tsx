import type { LabelHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('flex flex-col gap-1.5 text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  )
}
