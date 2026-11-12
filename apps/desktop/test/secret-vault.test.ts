import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SecretVault } from '../src/main/secret-vault.ts'
import type { SecretCrypto } from '../src/main/secret-vault.ts'

/** 假的“系统加密”：反转字节再加前缀，足够证明落盘的不是明文。 */
function fakeCrypto(
  options: { available?: boolean; reEncrypt?: boolean; failDecrypt?: boolean } = {},
): SecretCrypto {
  return {
    available: async () => options.available ?? true,
    encrypt: async (plain) => Buffer.from('enc:' + [...plain].reverse().join('')),
    decrypt: async (data) => {
      if (options.failDecrypt || options.available === false)
        throw new Error('keychain unavailable')
      const text = Buffer.from(data).toString()
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext')
      return { plain: [...text.slice(4)].reverse().join(''), reEncrypt: options.reEncrypt ?? false }
    },
  }
}

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dramai-vault-'))
  file = join(dir, 'secrets.json')
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('SecretVault with OS encryption', () => {
  it('round-trips and never writes the key in clear', async () => {
    const v = new SecretVault(file, fakeCrypto())
    expect(await v.init()).toBe('os')
    await v.set('provider:a', 'sk-live-123')
    expect(await v.get('provider:a')).toBe('sk-live-123')
    expect(await v.has('provider:a')).toBe(true)
    const raw = await readFile(file, 'utf8')
    expect(raw).not.toContain('sk-live-123')
    expect(JSON.parse(raw).cipher).toBe('electron-safe-storage')
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('persists across instances and deletes', async () => {
    const a = new SecretVault(file, fakeCrypto())
    await a.init()
    await a.set('k', 'v')
    const b = new SecretVault(file, fakeCrypto())
    await b.init()
    expect(await b.get('k')).toBe('v')
    await b.delete('k')
    expect(await b.has('k')).toBe(false)
    expect(await b.get('k')).toBeUndefined()
  })

  it('treats a key that can no longer be decrypted as unset instead of failing', async () => {
    const a = new SecretVault(file, fakeCrypto())
    await a.init()
    await a.set('k', 'v')
    const logs: string[] = []
    const b = new SecretVault(file, fakeCrypto({ failDecrypt: true }), (_l, t) => logs.push(t))
    await b.init()
    expect(await b.get('k')).toBeUndefined()
    expect(logs.some((l) => /cannot decrypt/.test(l))).toBe(true)
  })

  it('re-encrypts when the system says the key rotated', async () => {
    const a = new SecretVault(file, fakeCrypto())
    await a.init()
    await a.set('k', 'v')
    const before = await readFile(file, 'utf8')
    const b = new SecretVault(file, fakeCrypto({ reEncrypt: true }))
    await b.init()
    expect(await b.get('k')).toBe('v')
    expect(JSON.parse(await readFile(file, 'utf8')).items.k).toBe(JSON.parse(before).items.k) // same fake ciphertext, but rewritten without error
  })

  it('serialises concurrent writes (no lost updates)', async () => {
    const v = new SecretVault(file, fakeCrypto())
    await v.init()
    await Promise.all(Array.from({ length: 20 }, (_, i) => v.set(`k${i}`, `v${i}`)))
    for (let i = 0; i < 20; i++) expect(await v.get(`k${i}`)).toBe(`v${i}`)
  })
})

describe('SecretVault without a system key store', () => {
  it('falls back to a 0600 plain file and says so (mode "plain")', async () => {
    const v = new SecretVault(file, fakeCrypto({ available: false }))
    expect(await v.init()).toBe('plain')
    await v.set('k', 'v')
    expect(await v.get('k')).toBe('v')
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      cipher: 'plain',
      items: { k: 'v' },
    })
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('upgrades plain keys to encrypted ones once the system store becomes available', async () => {
    const plain = new SecretVault(file, fakeCrypto({ available: false }))
    await plain.init()
    await plain.set('k', 'sk-secret')
    const os = new SecretVault(file, fakeCrypto())
    expect(await os.init()).toBe('os')
    expect(await readFile(file, 'utf8')).not.toContain('sk-secret')
    expect(await os.get('k')).toBe('sk-secret')
  })

  it('when the store disappears, old encrypted keys read as unset and new ones are saved plain', async () => {
    const os = new SecretVault(file, fakeCrypto())
    await os.init()
    await os.set('old', 'v')
    const plain = new SecretVault(file, fakeCrypto({ available: false }), () => {})
    await plain.init()
    expect(await plain.get('old')).toBeUndefined()
    await plain.set('new', 'w')
    expect(await plain.get('new')).toBe('w')
    expect(JSON.parse(await readFile(file, 'utf8')).cipher).toBe('plain')
  })

  it('does not overwrite a corrupted file', async () => {
    await writeFile(file, '{ not json')
    const v = new SecretVault(file, fakeCrypto(), () => {})
    await expect(v.init()).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('{ not json')
  })
})
