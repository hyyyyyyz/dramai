import type { ButtonHTMLAttributes } from 'react'
import { type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'
import { buttonVariants } from '@/components/ui/button-variants'

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}
