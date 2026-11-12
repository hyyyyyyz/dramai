import { rename, rm } from 'node:fs/promises'

/**
 * Small file-system helpers for the places where Windows differs from POSIX.
 *
 * - File names: Windows refuses (or, for device names, silently redirects) names like `CON`, `nul.txt`, `a.` and
 *   anything containing `: * ? " < > |`. A file name we derive from user input must be safe on every platform.
 * - Busy files: on Windows a file that another process (an antivirus scan, the search indexer, a player that is still
 *   streaming it) has open cannot be removed or replaced right away (`EBUSY` / `EPERM` / `EACCES`) — retrying a few
 *   times with a short delay is the standard remedy and costs nothing elsewhere.
 */

const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

/** True for names Windows treats as devices (`CON`, `nul`, `COM1`, ... — with or without an extension). */
export function isReservedFileName(name: string): boolean {
  const stem = name.split('.')[0] ?? ''
  return RESERVED_DEVICE_NAMES.test(stem.trimEnd())
}

/**
 * A file name that is valid on Windows, macOS and Linux, derived from arbitrary user text. Keeps letters, digits,
 * CJK, `.`, `_`, `-`; everything else becomes `_`. Never empty, never a device name, no trailing dot or space,
 * bounded length.
 */
export function safeFileName(name: string, fallback = 'file'): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  let out = base
    .replace(/[. ]+$/, '')
    .replace(/[^\w.\u4e00-\u9fa5-]+/g, '_')
    .replace(/[. ]+$/, '')
  if (out.length > 120) {
    const dot = out.lastIndexOf('.')
    const ext = dot > 0 && out.length - dot <= 10 ? out.slice(dot) : ''
    out = out.slice(0, 120 - ext.length) + ext
  }
  if (!out || out === '.' || out === '..') out = fallback
  if (isReservedFileName(out)) out = `_${out}`
  return out
}

const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'])
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Run a file operation, retrying when the file is momentarily busy (Windows). Other errors propagate at once. */
export async function retryBusy<T>(
  op: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 6
  const delayMs = options.delayMs ?? 50
  for (let i = 1; ; i++) {
    try {
      return await op()
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (i >= attempts || code === undefined || !BUSY.has(code)) throw err
      await sleep(delayMs * i)
    }
  }
}

/** `fs.rename` that survives a briefly busy target on Windows. */
export const renameRetry = (from: string, to: string): Promise<void> =>
  retryBusy(() => rename(from, to))

/** Forced removal (recursive unless `recursive: false`) that survives briefly busy files on Windows. */
export const removeRetry = (path: string, options: { recursive?: boolean } = {}): Promise<void> =>
  rm(path, { recursive: options.recursive ?? true, force: true, maxRetries: 8, retryDelay: 100 })
