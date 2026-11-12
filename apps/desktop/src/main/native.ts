import { resolve, sep } from 'node:path'

/** 桌面桥接的参数校验和路径解析（纯函数，渲染进程来的参数一律当作不可信输入）。 */

const PROJECT_ID = /^[A-Za-z0-9_-]+$/

export function resolveProjectPath(
  dataDir: string,
  projectId: unknown,
  path: unknown,
): string | undefined {
  if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) return undefined
  const base = resolve(dataDir, 'projects', projectId)
  if (path === undefined || path === '') return base
  if (
    typeof path !== 'string' ||
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/')
  )
    return undefined
  const parts = path.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return undefined
  const full = resolve(base, ...parts)
  return full.startsWith(base + sep) ? full : undefined
}

export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
    })
    .join('')
    .trim()
  return text ? text.slice(0, max) : undefined
}

export interface FolderRequest {
  title?: string
  defaultPath?: string
}

export function parseFolderRequest(value: unknown): FolderRequest {
  if (typeof value !== 'object' || value === null) return {}
  const v = value as Record<string, unknown>
  return {
    title: cleanText(v.title, 120),
    defaultPath:
      typeof v.defaultPath === 'string' && v.defaultPath.length < 1024 ? v.defaultPath : undefined,
  }
}
