import { useEffect, useState } from 'react'

/** 每隔 intervalMs 刷新的“现在”，用于“已进行 1 分 12 秒”这类显示。`active` 为 false 时不跑定时器。 */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, active])
  return now
}
