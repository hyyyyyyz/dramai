import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { FieldContext } from '../lib/field-context'

/** 字段标签：13px / 500。 */
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-foreground', className)} {...props} />
}

/** 字段说明：12px，subtle。 */
export function Hint({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-xs leading-normal text-subtle', className)} {...props} />
}

export interface FieldProps extends Omit<ComponentProps<'div'>, 'children'> {
  label?: ReactNode
  hint?: ReactNode
  /** 有错误文字就进入错误态：控件加 aria-invalid，文字用 danger。错误必须写出来，不只变红。 */
  error?: ReactNode
  required?: boolean
  disabled?: boolean
  children: ReactNode
}

/**
 * 字段：标签 + 控件 + 说明 + 错误，并把 id / aria-describedby 自动接到里面的 Input / Textarea / Select。
 */
export function Field({
  label,
  hint,
  error,
  required,
  disabled,
  className,
  children,
  ...props
}: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <FieldContext.Provider
      value={{ id, hintId, errorId, invalid: Boolean(error), required, disabled }}
    >
      <div className={cn('flex min-w-0 flex-col gap-2', className)} {...props}>
        {label && (
          <Label htmlFor={id}>
            {label}
            {required && (
              <span aria-hidden className="ml-1 text-danger">
                *
              </span>
            )}
          </Label>
        )}
        {children}
        {hint && <Hint id={hintId}>{hint}</Hint>}
        {error && (
          <p id={errorId} role="alert" className="text-xs leading-normal text-danger">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  )
}
