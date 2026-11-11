import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '../lib/cn'
import { fieldAria, useFieldContext } from '../lib/field-context'

export interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type' | 'size'> {
  /** 部分选中（批量选择里「选了一部分」）。 */
  indeterminate?: boolean
  /** 复选框右侧的文字；不传就是纯框，调用方必须自己给 aria-label。 */
  label?: ReactNode
}

/** 原生 checkbox 加自绘外观：键盘、表单提交、屏幕阅读器都是原生行为。 */
export function Checkbox({ indeterminate = false, label, className, ...props }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)
  const field = useFieldContext()
  const aria = fieldAria(field, props)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  const box = (
    <span className="relative inline-flex size-4 shrink-0">
      <input
        ref={ref}
        type="checkbox"
        {...props}
        {...aria}
        className={cn(
          'peer size-4 cursor-pointer appearance-none rounded-sm border border-border-strong bg-sunken',
          'transition-colors duration-(--duration-fast) ease-standard',
          'hover:border-subtle',
          'checked:border-accent checked:bg-accent indeterminate:border-accent indeterminate:bg-accent',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      />
      <Check
        size={12}
        strokeWidth={1.5}
        aria-hidden
        className="pointer-events-none absolute inset-0 m-auto text-accent-foreground opacity-0 peer-checked:opacity-100 peer-indeterminate:hidden"
      />
      <Minus
        size={12}
        strokeWidth={1.5}
        aria-hidden
        className="pointer-events-none absolute inset-0 m-auto hidden text-accent-foreground peer-indeterminate:block"
      />
    </span>
  )
  if (!label) return box
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-base has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
      {box}
      {label}
    </label>
  )
}
