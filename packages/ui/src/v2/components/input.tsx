import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'
import { fieldAria, useFieldContext } from '../lib/field-context'
import { controlBase } from './form-styles'

export interface InputProps extends ComponentProps<'input'> {
  /** 等宽字体：Base URL、Model、Key、提示词、时间码。 */
  mono?: boolean
  invalid?: boolean
}

export function Input({ mono, invalid, className, ...props }: InputProps) {
  const field = useFieldContext()
  const aria = fieldAria(field, { ...props, invalid })
  return (
    <input
      {...props}
      {...aria}
      required={props.required ?? field?.required}
      className={cn(controlBase, 'h-9', mono && 'font-mono text-sm', className)}
    />
  )
}
