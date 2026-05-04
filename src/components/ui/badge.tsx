import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider',
  {
    variants: {
      variant: {
        accent: 'border-accent/40 bg-accent/15 text-accent',
        muted: 'border-border bg-background-soft text-muted-foreground',
        success: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
        warn: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
      },
    },
    defaultVariants: {
      variant: 'accent',
    },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
