import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { isReservedFileName, removeRetry, renameRetry } from '@dramai/core'
import type { FileInfo, FileStore } from '@dramai/core'

/**
 * 项目文件夹：`<dataDir>/projects/<项目 id>/<相对路径>`。每个项目一个文件夹，里面是普通文件，
 * 图片和视频可以直接用其他软件打开。写入先写临时文件再改名（崩溃时不会留下半截文件）。
 */
export class UnsafePathError extends Error {
  constructor(path: string) {
    super(`unsafe file path: ${path}`)
    this.name = 'UnsafePathError'
  }
}

// eslint-disable-next-line no-control-regex -- control characters are exactly what is being rejected
const WINDOWS_HOSTILE = /[\u0000-\u001f\u007f:<>"|?*]/

export class FsFileStore implements FileStore {
  readonly root: string
  constructor(dataDir: string) {
    this.root = join(dataDir, 'projects')
  }

  projectDir(projectId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new UnsafePathError(projectId)
    return join(this.root, projectId)
  }

  /**
   * 把项目内相对路径解析成绝对路径；拒绝绝对路径、`..`、空段、NUL。
   *
   * Also rejects anything that means something special on Windows, whatever platform we run on, so a project
   * folder stays valid when it is copied between machines and a path that is harmless here cannot be an attack there:
   * `:` (drive letters `C:`, alternate data streams `a.txt:stream`), `< > " | ? *`, control characters, a segment
   * that ends in a dot or space (Windows silently strips it), and device names (`CON`, `nul.txt`, `COM1` ...).
   */
  resolve(projectId: string, path: string): string {
    if (!path || path.startsWith('/') || path.includes('\\') || WINDOWS_HOSTILE.test(path))
      throw new UnsafePathError(path)
    const parts = path.split('/')
    if (
      parts.some(
        (p) => p === '' || p === '.' || p === '..' || /[. ]$/.test(p) || isReservedFileName(p),
      )
    )
      throw new UnsafePathError(path)
    const base = resolve(this.projectDir(projectId))
    const full = resolve(base, ...parts)
    if (full !== base && !full.startsWith(base + sep)) throw new UnsafePathError(path)
    return full
  }

  async put(projectId: string, path: string, data: Uint8Array): Promise<FileInfo> {
    const full = this.resolve(projectId, path)
    await mkdir(dirname(full), { recursive: true })
    const tmp = `${full}.${randomBytes(4).toString('hex')}.tmp`
    try {
      await writeFile(tmp, data)
      await renameRetry(tmp, full)
    } catch (err) {
      await unlink(tmp).catch(() => {})
      throw err
    }
    return { bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') }
  }

  async get(projectId: string, path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(projectId, path)))
  }

  async exists(projectId: string, path: string): Promise<boolean> {
    try {
      return (await stat(this.resolve(projectId, path))).isFile()
    } catch {
      return false
    }
  }

  async remove(projectId: string, path: string): Promise<void> {
    await removeRetry(this.resolve(projectId, path), { recursive: false })
  }

  async localPath(projectId: string, path: string): Promise<string> {
    const full = this.resolve(projectId, path)
    await stat(full)
    return full
  }

  async stat(
    projectId: string,
    path: string,
  ): Promise<{ size: number; mtimeMs: number } | undefined> {
    try {
      const s = await stat(this.resolve(projectId, path))
      return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : undefined
    } catch {
      return undefined
    }
  }

  /** 读一段（含两端）。给分段下载用。 */
  createReadStream(projectId: string, path: string, range?: { start: number; end: number }) {
    return createReadStream(this.resolve(projectId, path), range)
  }

  async removeProject(projectId: string): Promise<void> {
    await removeRetry(this.projectDir(projectId), { recursive: true })
  }

  async readHead(projectId: string, path: string, bytes: number): Promise<Uint8Array> {
    const fh = await open(this.resolve(projectId, path), 'r')
    try {
      const buf = Buffer.alloc(bytes)
      const { bytesRead } = await fh.read(buf, 0, bytes, 0)
      return new Uint8Array(buf.subarray(0, bytesRead))
    } finally {
      await fh.close()
    }
  }
}
