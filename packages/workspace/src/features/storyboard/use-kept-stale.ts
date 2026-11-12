import { useCallback, useState } from 'react'
import type { ArtifactReport } from '@dramai/api'

/**
 * “保持现状”：用户看过过期提示、决定继续用旧版本。服务端没有这个状态（没有对应的接口），
 * 所以只记在本机浏览器里（localStorage，按“产物 + 变化内容”）；上游再变一次，提示会重新出现。
 * 临时做法：等接口提供后换成服务端状态。
 */
const KEY = 'dramai.stale.kept'

const signature = (r: ArtifactReport) => `${r.key}|${JSON.stringify(r.changes)}`

function read(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function useKeptStale() {
  const [kept, setKept] = useState<Set<string>>(read)
  const keep = useCallback((r: ArtifactReport) => {
    setKept((cur) => {
      const next = new Set(cur).add(signature(r))
      try {
        localStorage.setItem(KEY, JSON.stringify([...next].slice(-500)))
      } catch {
        /* 存储不可用：本次会话内仍然生效 */
      }
      return next
    })
  }, [])
  const isKept = useCallback((r: ArtifactReport) => kept.has(signature(r)), [kept])
  return { keep, isKept }
}
