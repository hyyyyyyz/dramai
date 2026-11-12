import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bundledDataDir, loadCatalog } from '../src/data-dir.ts'
import { LegacyImportError, parseLegacyBackup } from '../src/export/legacy-import.ts'
import { concatListEntry } from '../src/media/render.ts'
import { pathCandidates } from '../src/media/ffmpeg.ts'
import { parseMaterial } from '../src/parsers/material.ts'
import { PromptLibrary } from '../src/prompts/library.ts'
import { loadStyleCatalog } from '../src/prompts/styles.ts'
import { loadModelRegistryFromDir } from '../src/providers/catalog.ts'
import { isReservedFileName, retryBusy, safeFileName } from '../src/util/fs.ts'
import { decodeText, parseJsonText, stripBom, toLf } from '../src/util/text.ts'

/**
 * What differs on Windows, reproduced anywhere: CRLF line endings (git autocrlf), a UTF-8 BOM (Notepad), GBK-encoded
 * text files, drive-letter and backslash paths, device file names, and files that are briefly busy.
 */

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walkFiles(full)))
    else out.push(full)
  }
  return out
}

/** A copy of the bundled data directory as a Windows checkout would have it: every text file with CRLF line endings. */
let crlfDir = ''
beforeAll(async () => {
  crlfDir = await mkdtemp(join(tmpdir(), 'dramai-crlf-'))
  await cp(bundledDataDir(), crlfDir, { recursive: true })
  for (const f of await walkFiles(crlfDir)) {
    if (!/\.(prompt|json|md|txt)$/.test(f)) continue
    const text = await readFile(f, 'utf8')
    await writeFile(f, text.replace(/\r?\n/g, '\r\n'))
  }
})
afterAll(async () => {
  if (crlfDir) await rm(crlfDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})

describe('CRLF checkouts of the bundled data behave exactly like LF ones', () => {
  it('prompts: same ids, same rendered text', async () => {
    const lf = new PromptLibrary().loadDir(join(bundledDataDir(), 'prompts'))
    const crlf = new PromptLibrary().loadDir(join(crlfDir, 'prompts'))
    const vars = {
      targetChars: '2500',
      aspectRatio: '9:16',
      styleLabel: 'x',
      aspectHint: 'y',
      targetShotsMin: '3',
      targetShotsMax: '6',
      projectName: 'p',
      firstChapter: '0',
      lastChapter: '3',
      hasMore: '否',
      previousBlock: '',
      userInstructions: '',
      tocBlock: '[0] t',
    }
    for (const id of ['episodes.plan.system', 'episodes.plan.user', 'shots.breakdown.system']) {
      expect(crlf.render(id, vars), id).toBe(lf.render(id, vars))
    }
    // partials are found by their folder name with either kind of path separator
    expect(
      crlf.render('assets.sheet.character', {
        name: 'n',
        appearance: '',
        styleKeywords: '',
        multiView: true,
        viewName: '',
        originalsHint: '',
        wantsExclusion: false,
      }),
    ).toBe(
      lf.render('assets.sheet.character', {
        name: 'n',
        appearance: '',
        styleKeywords: '',
        multiView: true,
        viewName: '',
        originalsHint: '',
        wantsExclusion: false,
      }),
    )
  })

  it('the whole catalog (prompts, models, styles) loads from a CRLF directory with the same content', () => {
    const a = loadCatalog({ includeBundled: false, extraDirs: [bundledDataDir()] })
    const b = loadCatalog({ includeBundled: false, extraDirs: [crlfDir] })
    expect(b.styles.groups).toEqual(a.styles.groups)
    expect(b.models.all()).toEqual(a.models.all())
  })

  it('a prompt, a styles file and a model file that start with a UTF-8 BOM (Notepad) load too', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dramai-bom-'))
    try {
      await mkdir(join(dir, 'prompts'))
      await writeFile(
        join(dir, 'prompts', 'a.prompt'),
        '\uFEFF---\r\nid: bom.test\r\nlocale: zh\r\nschemaVersion: 1\r\n---\r\n你好 {{n}}\r\n',
      )
      expect(
        new PromptLibrary().loadDir(join(dir, 'prompts')).render('bom.test', { n: '世界' }),
      ).toBe('你好 世界')
      const styles = await readFile(join(bundledDataDir(), 'styles.json'), 'utf8')
      await writeFile(join(dir, 'styles.json'), '\uFEFF' + styles.replace(/\n/g, '\r\n'))
      expect(loadStyleCatalog(join(dir, 'styles.json')).presets.length).toBe(20)
      await mkdir(join(dir, 'models'))
      const models = await readFile(join(bundledDataDir(), 'models', 'models.json'), 'utf8')
      await writeFile(join(dir, 'models', 'models.json'), '\uFEFF' + models.replace(/\n/g, '\r\n'))
      expect(loadModelRegistryFromDir(join(dir, 'models')).all().length).toBeGreaterThan(3)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
    }
  })

  it('a v0.4 backup saved with a BOM and CRLF imports; garbage still gives the readable error', () => {
    const json = JSON.stringify(
      { format: 'dramai-backup', version: 1, projects: [] },
      null,
      2,
    ).replace(/\n/g, '\r\n')
    expect(() => parseLegacyBackup('\uFEFF' + json)).not.toThrow(/JSON/)
    expect(() => parseLegacyBackup('\uFEFF not json')).toThrow(LegacyImportError)
  })

  it('text helpers', () => {
    expect(stripBom('\uFEFFabc')).toBe('abc')
    expect(stripBom('abc')).toBe('abc')
    expect(toLf('a\r\nb\rc\n')).toBe('a\nb\nc\n')
    expect(parseJsonText('\uFEFF{"a":1}')).toEqual({ a: 1 })
  })
})

describe('text files saved by Windows editors', () => {
  const GBK_NIHAO = Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xca, 0xc0, 0xbd, 0xe7]) // 你好，世界 in GBK
  const BIG5_NIHAO = Uint8Array.from([0xa7, 0x41, 0xa6, 0x6e, 0xa1, 0x41, 0xa5, 0x40, 0xac, 0xc9]) // 你好，世界 in Big5

  it('decodes UTF-8 (with or without BOM), UTF-16, GBK and Big5', () => {
    const enc = new TextEncoder()
    expect(decodeText(enc.encode('你好，世界'))).toEqual({ text: '你好，世界', encoding: 'utf-8' })
    expect(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc.encode('你好')])).text).toBe('你好')
    expect(decodeText(Uint8Array.from([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]))).toEqual({
      text: '你好',
      encoding: 'utf-16le',
    })
    expect(decodeText(GBK_NIHAO)).toEqual({ text: '你好，世界', encoding: 'gb18030' })
    expect(decodeText(BIG5_NIHAO).text).toBe('你好，世界')
  })

  it('uploading a GBK-encoded .txt gives real text and chapters, not mojibake; CRLF is normalized', async () => {
    const gbkChapter = Uint8Array.from([
      ...[0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2], // 第一章
      0x0d,
      0x0a,
      ...GBK_NIHAO,
      0x0d,
      0x0a,
    ])
    const parsed = await parseMaterial({ name: '小说.txt', bytes: gbkChapter })
    expect(parsed.text).toBe('第一章\n你好，世界')
    expect(parsed.text).not.toContain('\r')
    expect(parsed.text).not.toContain('\uFFFD')
  })
})

describe('Windows paths, as arguments to ffmpeg', () => {
  it('finds ffmpeg on a Windows PATH: ; separators, quoted entries, extensions', () => {
    const path = 'C:\\Windows\\System32;"C:\\Program Files\\ffmpeg\\bin";;D:\\tools'
    expect(pathCandidates('ffmpeg', path, 'win32')).toEqual([
      'C:\\Windows\\System32\\ffmpeg.exe',
      'C:\\Windows\\System32\\ffmpeg.cmd',
      'C:\\Windows\\System32\\ffmpeg.bat',
      'C:\\Windows\\System32\\ffmpeg',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.cmd',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.bat',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg',
      'D:\\tools\\ffmpeg.exe',
      'D:\\tools\\ffmpeg.cmd',
      'D:\\tools\\ffmpeg.bat',
      'D:\\tools\\ffmpeg',
    ])
    expect(pathCandidates('ffmpeg', '/usr/bin:/opt/homebrew/bin', 'linux')).toEqual([
      '/usr/bin/ffmpeg',
      '/opt/homebrew/bin/ffmpeg',
    ])
    expect(pathCandidates('ffmpeg', undefined, 'win32')).toEqual([])
  })

  it('writes concat-list entries with forward slashes and a closed-escaped-reopened quote', () => {
    expect(
      concatListEntry('C:\\Users\\me\\AppData\\Local\\Temp\\dramai-cut-ab12\\clip_001.mp4'),
    ).toBe("file 'C:/Users/me/AppData/Local/Temp/dramai-cut-ab12/clip_001.mp4'")
    expect(concatListEntry("/tmp/it's here/a.mp4")).toBe("file '/tmp/it'\\''s here/a.mp4'")
    expect(concatListEntry('/tmp/中文 目录/a.mp4')).toBe("file '/tmp/中文 目录/a.mp4'")
  })
})

describe('file names that are valid on every platform', () => {
  it('knows the Windows device names', () => {
    for (const n of ['CON', 'con.txt', 'NUL', 'Prn.tar.gz', 'COM1', 'lpt9.log', 'aux'])
      expect(isReservedFileName(n), n).toBe(true)
    for (const n of ['console.txt', 'com10', 'nullable', 'a.con', ''])
      expect(isReservedFileName(n), n).toBe(false)
  })

  it('turns anything into a safe name: no separators or drive colons, no device names, no trailing dot or space', () => {
    expect(safeFileName('第一章 开端.txt')).toBe('第一章_开端.txt')
    expect(safeFileName('C:\\Users\\me\\小说.docx')).toBe('小说.docx') // a pasted full path keeps the file name
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('a:b*c?"d<e>f|g.txt')).toBe('a_b_c_d_e_f_g.txt')
    expect(safeFileName('CON.txt')).toBe('_CON.txt')
    expect(safeFileName('nul')).toBe('_nul')
    expect(safeFileName('story...')).toBe('story')
    expect(safeFileName('story. ')).toBe('story')
    expect(safeFileName('')).toBe('file')
    expect(safeFileName('...')).toBe('file')
    expect(safeFileName('???')).toBe('_')
    const long = safeFileName('x'.repeat(300) + '.mp4')
    expect(long.length).toBeLessThanOrEqual(120)
    expect(long.endsWith('.mp4')).toBe(true)
  })
})

describe('files that are briefly busy (Windows: antivirus, indexer, a player still reading)', () => {
  const busy = (code: string) => Object.assign(new Error(code), { code })

  it('retries EBUSY / EPERM / EACCES and then succeeds', async () => {
    let calls = 0
    const result = await retryBusy(
      async () => {
        calls++
        if (calls < 3) throw busy(calls === 1 ? 'EBUSY' : 'EPERM')
        return 'done'
      },
      { delayMs: 1 },
    )
    expect(result).toBe('done')
    expect(calls).toBe(3)
  })

  it('gives up after the attempts, and never retries real errors', async () => {
    let calls = 0
    await expect(
      retryBusy(
        async () => {
          calls++
          throw busy('EBUSY')
        },
        { attempts: 3, delayMs: 1 },
      ),
    ).rejects.toThrow('EBUSY')
    expect(calls).toBe(3)
    calls = 0
    await expect(
      retryBusy(
        async () => {
          calls++
          throw busy('ENOENT')
        },
        { delayMs: 1 },
      ),
    ).rejects.toThrow('ENOENT')
    expect(calls).toBe(1)
    calls = 0
    await expect(
      retryBusy(
        async () => {
          calls++
          throw new Error('plain')
        },
        { delayMs: 1 },
      ),
    ).rejects.toThrow('plain')
    expect(calls).toBe(1)
  })
})
