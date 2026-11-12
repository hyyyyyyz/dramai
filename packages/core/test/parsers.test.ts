import { crc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  detectKind,
  MaterialTooLargeError,
  MAX_MATERIAL_SIZE,
  parseMaterial,
  UnsupportedMaterialError,
} from '../src/parsers/material.ts'
import { readImageSize } from '../src/parsers/image-size.ts'

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const le16 = (n: number) => [n & 255, (n >> 8) & 255]
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))

const png = (w: number, h: number) =>
  new Uint8Array([
    0x89,
    ...ascii('PNG'),
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    ...ascii('IHDR'),
    ...be32(w),
    ...be32(h),
    8,
    6,
    0,
    0,
    0,
  ])
const gif = (w: number, h: number) =>
  new Uint8Array([...ascii('GIF89a'), ...le16(w), ...le16(h), 0, 0, 0])
const jpeg = (w: number, h: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    ...ascii('JFIF'),
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0, // APP0
    0xff,
    0xdb,
    0x00,
    0x04,
    0x00,
    0x00, // DQT (dummy)
    0xff,
    0xc0,
    0x00,
    0x11,
    8,
    (h >> 8) & 255,
    h & 255,
    (w >> 8) & 255,
    w & 255,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1, // SOF0
  ])
const webpVp8x = (w: number, h: number) =>
  new Uint8Array([
    ...ascii('RIFF'),
    ...le32(22),
    ...ascii('WEBP'),
    ...ascii('VP8X'),
    ...le32(10),
    0,
    0,
    0,
    0,
    (w - 1) & 255,
    ((w - 1) >> 8) & 255,
    ((w - 1) >> 16) & 255,
    (h - 1) & 255,
    ((h - 1) >> 8) & 255,
    ((h - 1) >> 16) & 255,
  ])
const webpVp8l = (w: number, h: number) => {
  const bits = (w - 1) | ((h - 1) << 14)
  return new Uint8Array([
    ...ascii('RIFF'),
    ...le32(22),
    ...ascii('WEBP'),
    ...ascii('VP8L'),
    ...le32(10),
    0x2f,
    ...le32(bits),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ])
}
const webpVp8 = (w: number, h: number) =>
  new Uint8Array([
    ...ascii('RIFF'),
    ...le32(30),
    ...ascii('WEBP'),
    ...ascii('VP8 '),
    ...le32(18),
    0,
    0,
    0,
    0x9d,
    0x01,
    0x2a,
    ...le16(w),
    ...le16(h),
    0,
    0,
  ])

describe('readImageSize (no DOM, no dependencies)', () => {
  it.each([
    ['png', png(720, 1280), 'image/png'],
    ['gif', gif(300, 200), 'image/gif'],
    ['jpeg', jpeg(1024, 768), 'image/jpeg'],
    ['webp VP8X', webpVp8x(640, 480), 'image/webp'],
    ['webp VP8L', webpVp8l(321, 123), 'image/webp'],
    ['webp VP8', webpVp8(800, 600), 'image/webp'],
  ] as const)('%s', (_name, bytes, mime) => {
    const size = readImageSize(bytes)
    expect(size?.mime).toBe(mime)
    const expected = {
      png: [720, 1280],
      gif: [300, 200],
      jpeg: [1024, 768],
      'webp VP8X': [640, 480],
      'webp VP8L': [321, 123],
      'webp VP8': [800, 600],
    }[_name]
    expect([size?.width, size?.height]).toEqual(expected)
  })

  it('works on a Uint8Array view with a byte offset (e.g. a Node Buffer slice)', () => {
    const inner = png(33, 44)
    const padded = new Uint8Array(inner.length + 10)
    padded.set(inner, 10)
    expect(readImageSize(padded.subarray(10))).toMatchObject({ width: 33, height: 44 })
  })

  it('skips JPEG segments before SOF and returns undefined for junk', () => {
    expect(readImageSize(jpeg(5000, 3000))).toMatchObject({ width: 5000, height: 3000 })
    expect(readImageSize(new Uint8Array([1, 2, 3]))).toBeUndefined()
    expect(readImageSize(new Uint8Array())).toBeUndefined()
    expect(readImageSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeUndefined()
    expect(
      readImageSize(new TextEncoder().encode('just some text, not an image at all......')),
    ).toBeUndefined()
  })
})

/** 最小的 stored（不压缩）zip 写入器，只为在测试里造一个合法 .docx。 */
function zip(files: Record<string, string>): Uint8Array {
  const parts: number[][] = []
  const central: number[][] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = [...new TextEncoder().encode(text)]
    const nameBytes = ascii(name)
    const crc = crc32(Buffer.from(data))
    const local = [
      ...le32(0x04034b50),
      ...le16(20),
      ...le16(0),
      ...le16(0),
      ...le16(0),
      ...le16(0),
      ...le32(crc),
      ...le32(data.length),
      ...le32(data.length),
      ...le16(nameBytes.length),
      ...le16(0),
      ...nameBytes,
      ...data,
    ]
    parts.push(local)
    central.push([
      ...le32(0x02014b50),
      ...le16(20),
      ...le16(20),
      ...le16(0),
      ...le16(0),
      ...le16(0),
      ...le16(0),
      ...le32(crc),
      ...le32(data.length),
      ...le32(data.length),
      ...le16(nameBytes.length),
      ...le16(0),
      ...le16(0),
      ...le16(0),
      ...le16(0),
      ...le32(0),
      ...le32(offset),
      ...nameBytes,
    ])
    offset += local.length
  }
  const cd = central.flat()
  const end = [
    ...le32(0x06054b50),
    ...le16(0),
    ...le16(0),
    ...le16(central.length),
    ...le16(central.length),
    ...le32(cd.length),
    ...le32(offset),
    ...le16(0),
  ]
  return new Uint8Array([...parts.flat(), ...cd, ...end])
}

const docx = (paragraphs: string[]) =>
  zip({
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
  })

describe('parseMaterial', () => {
  const enc = (s: string) => new TextEncoder().encode(s)

  it('detects kinds by extension, then by mime', () => {
    expect(detectKind('a.TXT')).toBe('txt')
    expect(detectKind('a.markdown')).toBe('md')
    expect(detectKind('a.docx')).toBe('doc')
    expect(detectKind('a.jpeg')).toBe('image')
    expect(detectKind('noext', 'image/avif')).toBe('image')
    expect(detectKind('noext', 'text/plain')).toBe('txt')
    expect(detectKind('a.exe')).toBeUndefined()
  })

  it('parses txt and md as UTF-8, strips a BOM, keeps markdown as-is', async () => {
    const t = await parseMaterial({ name: 'a.txt', bytes: enc('﻿  你好，世界  \n') })
    expect(t).toMatchObject({ kind: 'txt', text: '你好，世界', mimeType: 'text/plain' })
    const m = await parseMaterial({ name: 'a.md', bytes: enc('# 标题\n- 列表') })
    expect(m).toMatchObject({ kind: 'md', text: '# 标题\n- 列表', mimeType: 'text/markdown' })
  })

  it('reads image size without a DOM and leaves the text empty', async () => {
    const p = await parseMaterial({ name: 'ref.png', bytes: png(640, 960) })
    expect(p).toMatchObject({
      kind: 'image',
      text: '',
      size: { width: 640, height: 960 },
      mimeType: 'image/png',
    })
    const unreadable = await parseMaterial({ name: 'broken.png', bytes: enc('not an image') })
    expect(unreadable.size).toBeUndefined() // 读不出尺寸不阻断上传
  })

  it('extracts text from a .docx in Node (mammoth)', async () => {
    const p = await parseMaterial({
      name: '剧本.docx',
      bytes: docx(['第一场', '雨夜，她追着那个背影。']),
    })
    expect(p.kind).toBe('doc')
    expect(p.text).toBe('第一场\n\n雨夜，她追着那个背影。')
    expect(p.mimeType).toContain('wordprocessingml')
  })

  it('reports an unreadable .docx (e.g. old OLE .doc) with the file name', async () => {
    await expect(
      parseMaterial({ name: 'old.doc', bytes: enc('\xD0\xCF\x11\xE0 not a zip') }),
    ).rejects.toThrow(/无法解析文档 old\.doc/)
  })

  it('rejects unsupported types and oversized files', async () => {
    await expect(parseMaterial({ name: 'a.exe', bytes: enc('x') })).rejects.toBeInstanceOf(
      UnsupportedMaterialError,
    )
    await expect(
      parseMaterial({ name: 'a.txt', bytes: new Uint8Array(MAX_MATERIAL_SIZE + 1) }),
    ).rejects.toBeInstanceOf(MaterialTooLargeError)
  })
})
