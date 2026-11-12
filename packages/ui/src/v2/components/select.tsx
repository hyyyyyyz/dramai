import type { ComponentProps } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'
import { fieldAria, useFieldContext } from '../lib/field-context'
import { iconProps } from '../lib/icon'
import { controlBase } from './form-styles'

export interface SelectProps extends ComponentProps<'select'> {
  mono?: boolean
  invalid?: boolean
}

/** 原生 <select>（移动端体验和无障碍最好），去掉系统箭头，换成统一的线性箭头。 */
export function Select({ mono, invalid, className, children, ...props }: SelectProps) {
  const field = useFieldContext()
  const aria = fieldAria(field, { ...props, invalid })
  return (
    <div className="relative">
      <select
        {...props}
        {...aria}
        className={cn(
          controlBase,
          'h-9 appearance-none pr-8',
          mono && 'font-mono text-sm',
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown
        {...iconProps}
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-subtle"
      />
    </div>
  )
}
