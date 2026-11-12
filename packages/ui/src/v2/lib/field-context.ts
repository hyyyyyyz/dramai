import { createContext, useContext } from 'react'

export interface FieldContextValue {
  id: string
  hintId?: string
  errorId?: string
  invalid?: boolean
  required?: boolean
  disabled?: boolean
}

export const FieldContext = createContext<FieldContextValue | null>(null)

/** 表单控件读取外层 Field 提供的 id / aria 关联；没有 Field 时返回 null。 */
export function useFieldContext() {
  return useContext(FieldContext)
}

/** 把 Field 的关联合并进控件自己的 props。 */
export function fieldAria(
  field: FieldContextValue | null,
  own: {
    id?: string
    'aria-describedby'?: string
    'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling'
    invalid?: boolean
    disabled?: boolean
  },
) {
  const describedBy =
    [own['aria-describedby'], field?.hintId, field?.invalid ? field.errorId : undefined]
      .filter(Boolean)
      .join(' ') || undefined
  const invalid = own.invalid ?? field?.invalid
  return {
    id: own.id ?? field?.id,
    'aria-describedby': describedBy,
    'aria-invalid': own['aria-invalid'] ?? (invalid ? true : undefined),
    disabled: own.disabled ?? field?.disabled,
  }
}
