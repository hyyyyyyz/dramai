import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * API Key 的保险箱（在主进程里，服务进程通过消息来取）。
 *
 * - 操作系统有加密设施（macOS 钥匙串 / Windows DPAPI / Linux 的 libsecret、kwallet）时：密文落盘，
 *   模式 `os`，文件头标 `electron-safe-storage`。
 * - 没有（比如没装密码管理器的 Linux）：退回到明文文件 + 0600 权限，和 WebUI 一样，模式 `plain`；
 *   调用方应当告诉用户这一点。Electron 在 Linux 上退到的 `basic_text` 只是写死密码的混淆，不算加密。
 * - 文件格式和 `@dramai/server` 的 `FileSecretStore` 一致（`{ version, cipher, items }`）。
 */

export interface SecretCrypto {
  /** 系统加密可用吗（Linux 的 `basic_text` 算不可用）。 */
  available(): Promise<boolean>
  encrypt(plain: string): Promise<Uint8Array>
  /** `reEncrypt` 为 true 表示系统建议用新密钥重新加密一遍。 */
  decrypt(data: Uint8Array): Promise<{ plain: string; reEncrypt: boolean }>
}

export const OS_CIPHER_ID = 'electron-safe-storage'
export const PLAIN_CIPHER_ID = 'plain'

interface SecretsFile {
  version: 1
  cipher: string
  items: Record<string, string>
}

export type VaultMode = 'os' | 'plain'

export class SecretVault {
  private file: SecretsFile | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private modeValue: VaultMode = 'plain'

  private readonly path: string
  private readonly crypto: SecretCrypto
  private readonly log: (level: 'info' | 'error', text: string) => void

  constructor(
    path: string,
    crypto: SecretCrypto,
    log: (level: 'info' | 'error', text: string) => void = () => {},
  ) {
    this.path = path
    this.crypto = crypto
    this.log = log
  }

  get mode(): VaultMode {
    return this.modeValue
  }

  /** 决定模式；如果磁盘上是明文而系统加密可用，顺手升级成密文。 */
  async init(): Promise<VaultMode> {
    this.modeValue = (await this.crypto.available()) ? 'os' : 'plain'
    const file = await this.load()
    if (
      this.modeValue === 'os' &&
      file.cipher === PLAIN_CIPHER_ID &&
      Object.keys(file.items).length > 0
    ) {
      const items: Record<string, string> = {}
      for (const [ref, plain] of Object.entries(file.items)) items[ref] = await this.seal(plain)
      await this.save({ version: 1, cipher: OS_CIPHER_ID, items })
      this.log('info', 'secrets: migrated plain-text keys to OS-encrypted storage')
    }
    return this.modeValue
  }

  private cipherId(): string {
    return this.modeValue === 'os' ? OS_CIPHER_ID : PLAIN_CIPHER_ID
  }

  private async seal(plain: string): Promise<string> {
    if (this.modeValue === 'plain') return plain
    return Buffer.from(await this.crypto.encrypt(plain)).toString('base64')
  }

  private async unseal(
    stored: string,
    fileCipher: string,
  ): Promise<{ plain: string; reEncrypt: boolean }> {
    if (fileCipher === PLAIN_CIPHER_ID) return { plain: stored, reEncrypt: false }
    return this.crypto.decrypt(Buffer.from(stored, 'base64'))
  }

  private async load(): Promise<SecretsFile> {
    if (this.file) return this.file
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as SecretsFile
      this.file = {
        version: 1,
        cipher: typeof parsed.cipher === 'string' ? parsed.cipher : PLAIN_CIPHER_ID,
        items: parsed.items && typeof parsed.items === 'object' ? parsed.items : {},
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log('error', `secrets: cannot read ${this.path}: ${String(err)}`)
        // 文件损坏：不覆盖它（留给用户排查），本次当作空的；写入会失败并报出来。
        throw err
      }
      this.file = { version: 1, cipher: this.cipherId(), items: {} }
    }
    return this.file
  }

  private async save(next: SecretsFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const tmp = `${this.path}.${randomBytes(4).toString('hex')}.tmp`
    try {
      await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
      await chmod(tmp, 0o600).catch(() => {})
      await rename(tmp, this.path)
    } catch (err) {
      await unlink(tmp).catch(() => {})
      throw err
    }
    this.file = next
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn)
    this.tail = next.catch(() => {})
    return next
  }

  get(ref: string): Promise<string | undefined> {
    return this.serial(async () => {
      const file = await this.load()
      const stored = file.items[ref]
      if (stored === undefined) return undefined
      try {
        const { plain, reEncrypt } = await this.unseal(stored, file.cipher)
        if (reEncrypt && this.modeValue === 'os' && file.cipher === OS_CIPHER_ID) {
          await this.save({ ...file, items: { ...file.items, [ref]: await this.seal(plain) } })
        }
        return plain
      } catch (err) {
        // 钥匙串被重置、换了系统账户、数据目录是从别的电脑拷来的……：这把 Key 读不出来，当作没设置，让用户重新填。
        this.log('error', `secrets: cannot decrypt "${ref}" (${String(err)}); treating as unset`)
        return undefined
      }
    })
  }

  set(ref: string, value: string): Promise<void> {
    return this.serial(async () => {
      const file = await this.load()
      let items = file.items
      if (file.cipher !== this.cipherId()) {
        // 磁盘上是另一种格式：能读的先转成当前格式，读不出来的丢掉（本来也读不出来）。
        const converted: Record<string, string> = {}
        for (const [r, stored] of Object.entries(items)) {
          try {
            converted[r] = await this.seal((await this.unseal(stored, file.cipher)).plain)
          } catch {
            this.log('error', `secrets: dropping unreadable key "${r}"`)
          }
        }
        items = converted
      }
      await this.save({
        version: 1,
        cipher: this.cipherId(),
        items: { ...items, [ref]: await this.seal(value) },
      })
    })
  }

  delete(ref: string): Promise<void> {
    return this.serial(async () => {
      const file = await this.load()
      if (!(ref in file.items)) return
      const items = { ...file.items }
      delete items[ref]
      await this.save({ ...file, items })
    })
  }

  has(ref: string): Promise<boolean> {
    return this.serial(async () => ref in (await this.load()).items)
  }
}
