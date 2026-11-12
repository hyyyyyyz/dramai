import * as nodePath from 'node:path'

/** 桌面桥接的参数校验和路径解析（纯函数，渲染进程来的参数一律当作不可信输入）。 */

const PROJECT_ID = /^[A-Za-z0-9_-]+$/
/** Characters Windows does not allow in a file name; `:` would also open NTFS alternate data streams / drive-relative paths. */
const WINDOWS_FORBIDDEN = /[:*?"<>|]/

/**
 * `<dataDir>/projects/<projectId>/<path>`, only if it stays inside the project folder.
 * `pathApi` is injectable so the Windows rules (drive letters, backslashes, case-insensitivity) are tested on every OS.
 */
export function resolveProjectPath(
  dataDir: string,
  projectId: unknown,
  path: unknown,
  pathApi: typeof nodePath.posix = nodePath,
): string | undefined {
  if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) return undefined
  const windows = pathApi.sep === '\\'
  const base = pathApi.resolve(dataDir, 'projects', projectId)
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
  if (windows && parts.some((p) => WINDOWS_FORBIDDEN.test(p) || /[. ]$/.test(p))) return undefined
  const full = pathApi.resolve(base, ...parts)
  return isInside(base, full, pathApi) ? full : undefined
}

/** Is `target` strictly inside `base`? Case-insensitive on Windows, where `C:\Data` and `c:\data` are the same folder. */
export function isInside(
  base: string,
  target: string,
  pathApi: typeof nodePath.posix = nodePath,
): boolean {
  const fold = (p: string) => (pathApi.sep === '\\' ? p.toLowerCase() : p)
  const rel = pathApi.relative(fold(base), fold(target))
  return rel !== '' && !rel.startsWith('..') && !pathApi.isAbsolute(rel)
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
