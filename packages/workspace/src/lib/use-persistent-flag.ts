import { useCallback, useState } from 'react'

/** 记在 localStorage 的布尔开关（读写都包 try/catch：隐私模式下存储会抛）。 */
export function usePersistentFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key)
      if (v === '1') return true
      if (v === '0') return false
    } catch {
      /* 存储不可用 */
    }
    return initial
  })
  const set = useCallback(
    (v: boolean) => {
      setValue(v)
      try {
        localStorage.setItem(key, v ? '1' : '0')
      } catch {
        /* 存储不可用 */
      }
    },
    [key],
  )
  return [value, set]
}
