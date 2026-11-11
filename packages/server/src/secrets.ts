import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SecretStore } from '@dramai/core'

/**
 * API Key 的存放。
 *
 * - 只存在服务端：接口永远只返回掩码（`maskSecret`），明文只在服务商适配器发请求时从这里读取。
 * - 默认实现 `FileSecretStore`：`<dataDir>/secrets.json`，文件 0600、目录 0700，仅当前系统用户可读。
 * - **可替换点**：桌面版把 Electron `safeStorage` 包成 `SecretCipher` 传进来（密文落盘），
 *   或者整个换成自己的 `SecretStore`（系统钥匙串）——`createServer({ secretStore })`。
 *   WebUI / 容器场景没有系统加密可用，靠文件权限与数据目录隔离；这一点写在 README 里，不假装更安全。
 */
export interface SecretCipher {
  /** 标识，写进文件头；换了 cipher 但文件是旧的会给出明确错误，而不是读出乱码。 */
  readonly id: string
  encrypt(plain: string): string
  decrypt(stored: string): string
}

interface SecretsFile {
  version: 1
  cipher: string
  items: Record<string, string>
}

export class SecretCipherMismatchError extends Error {
  constructor(file: string, have: string, want: string) {
    super(`${file} 是用 "${have}" 方式加密保存的，当前配置为 "${want}"，无法读取`)
    this.name = 'SecretCipherMismatchError'
  }
}

export class FileSecretStore implements SecretStore {
  private readonly file: string
  private readonly cipher?: SecretCipher
  private cache?: SecretsFile
  /** 写入串行化（读-改-写不能交错）。 */
  private tail: Promise<unknown> = Promise.resolve()

  constructor(dataDir: string, cipher?: SecretCipher) {
    this.file = join(dataDir, 'secrets.json')
    this.cipher = cipher
  }

  private cipherId(): string {
    return this.cipher?.id ?? 'plain'
  }

  private async load(): Promise<SecretsFile> {
    if (this.cache) return this.cache
    let parsed: SecretsFile
    try {
      parsed = JSON.parse(await readFile(this.file, 'utf8')) as SecretsFile
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      parsed = { version: 1, cipher: this.cipherId(), items: {} }
    }
    if (parsed.cipher !== this.cipherId() && Object.keys(parsed.items).length > 0) {
      throw new SecretCipherMismatchError(this.file, parsed.cipher, this.cipherId())
    }
    parsed.cipher = this.cipherId()
    this.cache = parsed
    return parsed
  }

  private async save(data: SecretsFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.${randomBytes(4).toString('hex')}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
      await chmod(tmp, 0o600).catch(() => {}) // Windows 上无意义
      await rename(tmp, this.file)
    } catch (err) {
      await unlink(tmp).catch(() => {})
      throw err
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn)
    this.tail = next.catch(() => {})
    return next
  }

  async get(ref: string): Promise<string | undefined> {
    return this.serial(async () => {
      const stored = (await this.load()).items[ref]
      if (stored === undefined) return undefined
      return this.cipher ? this.cipher.decrypt(stored) : stored
    })
  }

  async set(ref: string, value: string): Promise<void> {
    await this.serial(async () => {
      const data = await this.load()
      const items = { ...data.items, [ref]: this.cipher ? this.cipher.encrypt(value) : value }
      const next = { ...data, items }
      await this.save(next)
      this.cache = next
    })
  }

  async delete(ref: string): Promise<void> {
    await this.serial(async () => {
      const data = await this.load()
      if (!(ref in data.items)) return
      const items = { ...data.items }
      delete items[ref]
      const next = { ...data, items }
      await this.save(next)
      this.cache = next
    })
  }

  async has(ref: string): Promise<boolean> {
    return this.serial(async () => ref in (await this.load()).items)
  }
}

/**
 * 掩码：接口里只出现这个。足够认出“是哪一把”，不足以还原。
 * 长度 ≥ 12：前 3 + … + 后 4；更短的只显示圆点。
 */
export function maskSecret(secret: string | undefined): string | undefined {
  if (!secret) return undefined
  const s = secret.trim()
  if (s.length >= 12) return `${s.slice(0, 3)}…${s.slice(-4)}`
  return '••••••••'
}
