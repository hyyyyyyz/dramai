import { deflateSync } from 'node:zlib'
import { glyph, GLYPH_H, GLYPH_W, textWidth } from './font.ts'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** RGB 像素缓冲 → PNG 字节。 */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr[8] = 8 // 位深
  ihdr[9] = 2 // RGB
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

/** 稳定的 32 位哈希（同一个输入永远得到同一张图）。 */
export function hash32(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface PlaceholderOptions {
  width: number
  height: number
  /** 决定颜色和编号：同一个种子同一张图。 */
  seed: string
  /** 大标题，如 `SHOT` / `SHEET`。 */
  title: string
  /** 小字行（ASCII）。 */
  lines: string[]
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

/** 占位图：按种子取色的斜向渐变 + 对角线 + 大标题 + 小字。看得出是哪一张、什么尺寸，而且明显不是真实内容。 */
export function placeholderPng(opts: PlaceholderOptions): Uint8Array {
  const { width, height } = opts
  const h = hash32(opts.seed)
  const hue = h % 360
  const c1 = hsl(hue, 0.55, 0.42)
  const c2 = hsl((hue + 40) % 360, 0.55, 0.22)
  const buf = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2
      const stripe = (x + y) % 48 < 3 ? 14 : 0
      const i = (y * width + x) * 3
      buf[i] = Math.min(255, c1[0] * (1 - t) + c2[0] * t + stripe)
      buf[i + 1] = Math.min(255, c1[1] * (1 - t) + c2[1] * t + stripe)
      buf[i + 2] = Math.min(255, c1[2] * (1 - t) + c2[2] * t + stripe)
    }
  }
  // 白色边框
  const border = Math.max(2, Math.round(Math.min(width, height) / 90))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < border || y < border || x >= width - border || y >= height - border) {
        const i = (y * width + x) * 3
        buf[i] = buf[i + 1] = buf[i + 2] = 245
      }
    }
  }
  const draw = (text: string, cx: number, y: number, scale: number, color = 255) => {
    const w = textWidth(text, scale)
    let x0 = Math.round(cx - w / 2)
    for (const ch of text) {
      const g = glyph(ch)
      for (let gy = 0; gy < GLYPH_H; gy++) {
        for (let gx = 0; gx < GLYPH_W; gx++) {
          if (g[gy]![gx] !== '#') continue
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const px = x0 + gx * scale + dx
              const py = y + gy * scale + dy
              if (px < 0 || py < 0 || px >= width || py >= height) continue
              const i = (py * width + px) * 3
              buf[i] = buf[i + 1] = buf[i + 2] = color
            }
          }
        }
      }
      x0 += (GLYPH_W + 1) * scale
    }
  }
  const fit = (text: string, maxScale: number) => {
    let s = maxScale
    while (s > 1 && textWidth(text, s) > width - border * 8) s--
    return s
  }
  const titleScale = fit(opts.title, Math.max(2, Math.round(width / 60)))
  const lineScale = Math.max(1, Math.round(titleScale / 2.5))
  const gap = lineScale * 4
  const totalH = GLYPH_H * titleScale + opts.lines.length * (GLYPH_H * lineScale + gap) + gap
  let y = Math.round((height - totalH) / 2)
  draw(opts.title, width / 2, y, titleScale)
  y += GLYPH_H * titleScale + gap * 2
  for (const line of opts.lines) {
    draw(line, width / 2, y, fit(line, lineScale), 235)
    y += GLYPH_H * lineScale + gap
  }
  return encodePng(width, height, buf)
}

/** PNG 头里读宽高（读不出返回 undefined）。 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return undefined
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: v.getUint32(16), height: v.getUint32(20) }
}
