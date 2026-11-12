import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'
import { fieldAria, useFieldContext } from '../lib/field-context'
import { controlBase } from './form-styles'

export interface TextareaProps extends ComponentProps<'textarea'> {
  mono?: boolean
  invalid?: boolean
}

export function Textarea({ mono, invalid, className, ...props }: TextareaProps) {
  const field = useFieldContext()
  const aria = fieldAria(field, { ...props, invalid })
  return (
    <textarea
      {...props}
      {...aria}
      required={props.required ?? field?.required}
      className={cn(
        controlBase,
        'min-h-22 resize-y py-2 leading-relaxed',
        mono && 'font-mono text-sm',
        className,
      )}
    />
  )
}
