/**
 * 读图片宽高，不依赖 DOM / 第三方库。支持 PNG / JPEG / GIF / WebP（VP8、VP8L、VP8X）。
 * 读不出来返回 undefined（不阻断上传）。
 */
export interface ImageSize {
  width: number
  height: number
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
}

export function readImageSize(bytes: Uint8Array): ImageSize | undefined {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const n = bytes.byteLength
  const ascii = (off: number, len: number) =>
    String.fromCharCode(...bytes.subarray(off, Math.min(n, off + len)))

  // PNG: 8 字节签名，IHDR 在 16 起
  if (n >= 24 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG') {
    return { width: dv.getUint32(16), height: dv.getUint32(20), mime: 'image/png' }
  }
  // GIF
  if (n >= 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true), mime: 'image/gif' }
  }
  // JPEG: 扫描段标记，找 SOFn
  if (n >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let off = 2
    while (off + 9 < n) {
      if (bytes[off] !== 0xff) {
        off++
        continue
      }
      const marker = bytes[off + 1]
      if (marker === 0xff) {
        off++
        continue
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        off += 2
        continue
      }
      const len = dv.getUint16(off + 2)
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) {
        return {
          height: dv.getUint16(off + 5),
          width: dv.getUint16(off + 7),
          mime: 'image/jpeg',
        }
      }
      off += 2 + len
    }
    return undefined
  }
  // WebP: RIFF....WEBP
  if (n >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const fourcc = ascii(12, 4)
    if (fourcc === 'VP8X') {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
      return { width: w, height: h, mime: 'image/webp' }
    }
    if (fourcc === 'VP8 ') {
      return {
        width: dv.getUint16(26, true) & 0x3fff,
        height: dv.getUint16(28, true) & 0x3fff,
        mime: 'image/webp',
      }
    }
    if (fourcc === 'VP8L') {
      const b = dv.getUint32(21, true)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, mime: 'image/webp' }
    }
  }
  return undefined
}
