import { deflateSync } from 'node:zlib'
import { Canvas, hex } from './canvas.ts'
import type { Rgb } from './canvas.ts'
import { textWidth } from './font.ts'

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
  /** Decides the composition and the paper tone: the same seed gives the same picture. */
  seed: string
  /** `shot` = a storyboard frame, `sheet` = a character / location / prop design sheet. */
  kind: 'shot' | 'sheet'
  /** Running number of the generated image (printed in the footer). */
  serial: number
  /** Short code derived from the prompt (printed in the footer). */
  code: string
}

// Brand colours (design/DESIGN.md): ink, paper, cinnabar, plus low-saturation warm neutrals. No gradients.
const INK = hex('#100E0C')
const CINNABAR = hex('#DF500C')
const PAPER_TONES = [hex('#F6F2EA'), hex('#F1ECE2'), hex('#F8F5EF')]
const WALL_TONES = [hex('#DDD7CB'), hex('#D6D0C4'), hex('#E2DDD2')]
const FLOOR_TONES = [hex('#C7C0B2'), hex('#BFB8AA'), hex('#CDC6B8')]
const GUIDE = hex('#B9B2A5')
const MUTED = hex('#7E776C')
const FIGURE = hex('#3B3732')
const FIGURE_LIGHT = hex('#D9D2C5')

const SHOT_SIZES = [
  { label: 'WIDE', height: 0.2 },
  { label: 'FULL', height: 0.42 },
  { label: 'MEDIUM', height: 0.78 },
  { label: 'CLOSE', height: 1.35 },
] as const

type View = 'front' | 'side' | 'back'

/** A mannequin made of capsules, outlined in ink. `H` is the height from foot to crown. */
function figure(
  c: Canvas,
  x: number,
  foot: number,
  H: number,
  view: View,
  look: { hat: boolean; robe: boolean; wide: number },
  fill: Rgb,
  ink: number,
): void {
  const r = H * 0.068
  const headY = foot - H + r
  const shoulderY = headY + r * 2.1
  const hipY = foot - H * 0.46
  const sw = H * 0.1 * look.wide * (view === 'side' ? 0.62 : 1)
  const limb = H * 0.036
  const stroke = (x1: number, y1: number, x2: number, y2: number, t: number) => {
    c.line(x1, y1, x2, y2, t + ink * 2, INK)
    c.line(x1, y1, x2, y2, t, fill)
  }
  const outline = (draw: (grow: number, color: Rgb) => void) => {
    draw(ink, INK)
    draw(0, fill)
  }
  // legs first, so the body overlaps them
  const stride = view === 'side' ? H * 0.05 : H * 0.045
  stroke(x - stride, hipY, x - stride * 1.2, foot - limb / 2, limb * 1.25)
  stroke(x + stride, hipY, x + stride * 1.2, foot - limb / 2, limb * 1.25)
  // torso (or robe)
  const torsoT = sw * 1.35
  stroke(x, shoulderY + torsoT * 0.2, x, hipY, torsoT)
  if (look.robe) {
    const top = hipY - H * 0.06
    const bottom = foot - H * 0.1
    const half = sw * 1.9
    c.poly(
      [
        [x - sw * 0.7 - ink, top - ink],
        [x + sw * 0.7 + ink, top - ink],
        [x + half + ink, bottom + ink],
        [x - half - ink, bottom + ink],
      ],
      INK,
    )
    c.poly(
      [
        [x - sw * 0.7, top],
        [x + sw * 0.7, top],
        [x + half, bottom],
        [x - half, bottom],
      ],
      fill,
    )
  }
  // arms
  if (view === 'side') stroke(x, shoulderY + limb, x + sw * 0.5, hipY + H * 0.03, limb)
  else {
    stroke(x - sw * 1.05, shoulderY + limb * 0.5, x - sw * 1.3, hipY + H * 0.04, limb)
    stroke(x + sw * 1.05, shoulderY + limb * 0.5, x + sw * 1.3, hipY + H * 0.04, limb)
  }
  // neck and head
  stroke(x, headY + r, x, shoulderY, r * 0.6)
  outline((grow, color) => c.disc(x, headY, r + grow, color))
  if (view === 'back') c.disc(x, headY - r * 0.1, r * 0.92, FIGURE) // hair
  if (view === 'side')
    c.disc(x + r * 0.78, headY + r * 0.05, r * 0.28, fill === FIGURE ? INK : GUIDE) // nose
  if (look.hat) {
    c.line(x - r * 1.5, headY - r * 0.75, x + r * 1.5, headY - r * 0.75, ink * 2 + r * 0.28, INK)
    c.rect(x - r * 0.85, headY - r * 1.5, r * 1.7, r * 0.8, INK)
  }
}

/**
 * Placeholder pictures for the demo: a storyboard-paper draft in the product's own colours (ink, paper, cinnabar and
 * quiet warm neutrals; no gradients). It must read as "a placeholder, not a result" at a glance: a cinnabar DEMO stamp,
 * a "PLACEHOLDER" caption, the number of the image and its size. A shot is a framed composition (set, mannequin, thirds
 * guides, shot size); a sheet is three turnaround views on a baseline. The composition and the paper tone come from the
 * seed, so different shots and assets look different, and the same one always looks the same.
 */
export function placeholderPng(opts: PlaceholderOptions): Uint8Array {
  const { width, height, kind } = opts
  const h = hash32(opts.seed)
  const pick = <T>(list: readonly T[], shift: number): T => list[(h >>> shift) % list.length]!
  const paper = pick(PAPER_TONES, 0)
  const wall = pick(WALL_TONES, 3)
  const floor = pick(FLOOR_TONES, 6)
  const c = new Canvas(width, height, paper)
  const short = Math.min(width, height)
  const line = Math.max(1, Math.round(short / 240))
  const margin = Math.round(short * 0.05)
  const band = Math.round(short * 0.085) // header / footer height
  const dot = Math.max(1, Math.round(band / 16)) // text scale
  const fit = (text: string, scale: number, room: number) => {
    let s = scale
    while (s > 1 && textWidth(text, s) > room) s--
    return s
  }

  const drawHeader = () => {
    const stampText = 'DEMO'
    const stampScale = fit(stampText, dot, width * 0.3)
    const stampW = textWidth(stampText, stampScale) + stampScale * 6
    c.rect(margin, top, stampW, band, CINNABAR)
    c.text(
      stampText,
      margin + stampW / 2,
      top + (band - 7 * stampScale) / 2,
      stampScale,
      paper,
      'center',
    )
    const label = `${kind === 'shot' ? 'SHOT' : 'SHEET'} ${String(opts.serial).padStart(4, '0')}`
    const labelScale = fit(label, dot, width * 0.4)
    c.text(label, width - margin, top + (band - 7 * labelScale) / 2, labelScale, INK, 'right')
    const captionRoom = width - 2 * margin - stampW - textWidth(label, labelScale) - band
    const caption = 'PLACEHOLDER - NOT A REAL RESULT'
    const captionScale = fit(caption, Math.max(1, Math.round(dot * 0.7)), captionRoom)
    if (textWidth(caption, captionScale) <= captionRoom && captionRoom > 0)
      c.text(
        caption,
        margin + stampW + band * 0.4,
        top + (band - 7 * captionScale) / 2,
        captionScale,
        MUTED,
      )
  }

  // --- stage ----------------------------------------------------------------------------------------------------
  const sx = margin
  const top = margin
  const sy = top + band + Math.round(band * 0.4)
  const footerH = band
  const sw = width - 2 * margin
  const sh = height - sy - margin - footerH - Math.round(band * 0.4)
  const footerY = sy + sh + Math.round(band * 0.4)

  if (kind === 'shot') {
    const horizon = sy + sh * (0.56 + ((h >>> 9) % 14) / 100)
    c.rect(sx, sy, sw, horizon - sy, wall)
    c.rect(sx, horizon, sw, sy + sh - horizon, floor)
    // set dressing: a gate, a window wall or a row of pillars
    const set = (h >>> 12) % 3
    const ink = INK
    if (set === 0) {
      const gw = sw * 0.42
      const gx = sx + sw * (0.12 + ((h >>> 14) % 3) * 0.2)
      c.frame(gx, horizon - sh * 0.46, gw, sh * 0.46, line * 2, ink)
      c.line(gx - gw * 0.08, horizon - sh * 0.46, gx + gw / 2, horizon - sh * 0.58, line * 2, ink)
      c.line(gx + gw * 1.08, horizon - sh * 0.46, gx + gw / 2, horizon - sh * 0.58, line * 2, ink)
      c.line(gx + gw / 2, horizon - sh * 0.46, gx + gw / 2, horizon, line, ink)
    } else if (set === 1) {
      for (let i = 0; i < 3; i++) {
        const wx = sx + sw * (0.1 + i * 0.3)
        c.frame(wx, horizon - sh * 0.4, sw * 0.2, sh * 0.26, line * 2, ink)
        c.line(wx + sw * 0.1, horizon - sh * 0.4, wx + sw * 0.1, horizon - sh * 0.14, line, ink)
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const px = sx + sw * (0.12 + i * 0.25)
        c.rect(px, horizon - sh * 0.5, sw * 0.04, sh * 0.5, GUIDE)
        c.frame(px, horizon - sh * 0.5, sw * 0.04, sh * 0.5, line * 2, ink)
        c.frame(px - sw * 0.01, horizon - sh * 0.5, sw * 0.06, sh * 0.025, line * 2, ink)
      }
    }
    c.line(sx, horizon, sx + sw, horizon, line * 2, INK)
    // the mannequin, scaled by the shot size
    const size = SHOT_SIZES[(h >>> 16) % SHOT_SIZES.length]!
    const figH = sh * size.height
    const third = (h >>> 19) % 2 === 0 ? 1 / 3 : 2 / 3
    const foot = size.height > 1 ? sy + sh + figH * 0.18 : horizon + sh * (0.1 + size.height * 0.2)
    figure(
      c,
      sx + sw * third,
      foot,
      figH,
      'front',
      {
        hat: (h >>> 20) % 3 === 0,
        robe: (h >>> 22) % 2 === 0,
        wide: 0.9 + ((h >>> 24) % 4) * 0.08,
      },
      FIGURE,
      line,
    )
    // cover whatever the figure drew outside the stage (close shots are cropped by the frame)
    c.rect(0, sy + sh, width, height - (sy + sh), paper)
    c.rect(0, 0, width, sy, paper)
    // viewfinder: thirds, centre cross, corner marks
    for (const f of [1 / 3, 2 / 3]) {
      c.dashed(sx + sw * f, sy, sx + sw * f, sy + sh, line, line * 4, line * 4, GUIDE)
      c.dashed(sx, sy + sh * f, sx + sw, sy + sh * f, line, line * 4, line * 4, GUIDE)
    }
    const cross = short * 0.025
    c.line(sx + sw / 2 - cross, sy + sh / 2, sx + sw / 2 + cross, sy + sh / 2, line, INK)
    c.line(sx + sw / 2, sy + sh / 2 - cross, sx + sw / 2, sy + sh / 2 + cross, line, INK)
    c.frame(sx, sy, sw, sh, line * 2, INK)
    const corner = short * 0.07
    for (const [cx, cy, dx, dy] of [
      [sx, sy, 1, 1],
      [sx + sw, sy, -1, 1],
      [sx, sy + sh, 1, -1],
      [sx + sw, sy + sh, -1, -1],
    ] as const) {
      c.line(cx, cy, cx + dx * corner, cy, line * 4, INK)
      c.line(cx, cy, cx, cy + dy * corner, line * 4, INK)
    }
    const footLeft = size.label
    c.text(`${footLeft}`, sx, footerY + (footerH - 7 * dot) / 2, dot, INK)
  } else {
    // sheet: three turnaround views on a baseline, with a height ruler
    c.rect(sx, sy, sw, sh, hex('#FBF9F4'))
    const base = sy + sh * 0.86
    const colW = sw / 3
    const views: View[] = ['front', 'side', 'back']
    const look = {
      hat: (h >>> 20) % 3 === 0,
      robe: (h >>> 22) % 2 === 0,
      wide: 0.9 + ((h >>> 24) % 4) * 0.08,
    }
    const figH = Math.min(sh * 0.7, colW * 2.2)
    views.forEach((v, i) => {
      const cx = sx + colW * (i + 0.5)
      if (i > 0)
        c.dashed(
          sx + colW * i,
          sy + sh * 0.06,
          sx + colW * i,
          sy + sh * 0.94,
          line,
          line * 4,
          line * 4,
          GUIDE,
        )
      figure(c, cx, base, figH, v, look, FIGURE_LIGHT, line)
      const name = v.toUpperCase()
      const ns = fit(name, dot, colW * 0.8)
      c.text(name, cx, base + sh * 0.05, ns, MUTED, 'center')
    })
    c.line(sx + colW * 0.06, base, sx + sw - colW * 0.06, base, line * 2, INK)
    // height ruler on the left edge
    const rx = sx + sw * 0.03
    c.line(rx, base - figH, rx, base, line, INK)
    for (let t = 0; t <= 8; t++) {
      const ty = base - (figH * t) / 8
      c.line(rx, ty, rx + (t % 4 === 0 ? short * 0.025 : short * 0.014), ty, line, INK)
    }
    c.frame(sx, sy, sw, sh, line * 2, INK)
    c.text('3 VIEWS', sx, footerY + (footerH - 7 * dot) / 2, dot, INK)
  }

  drawHeader()
  // --- footer: code, serial, size ----------------------------------------------------------------------------------
  const sizeText = `${width}X${height}`
  c.text(
    sizeText,
    width - margin,
    footerY + (footerH - 7 * dot) / 2,
    fit(sizeText, dot, width * 0.4),
    MUTED,
    'right',
  )
  const codeText = `#${opts.code}`
  const codeScale = fit(codeText, dot, width * 0.25)
  c.text(codeText, width / 2, footerY + (footerH - 7 * codeScale) / 2, codeScale, MUTED, 'center')
  return encodePng(width, height, c.toRgb())
}

/** PNG 头里读宽高（读不出返回 undefined）。 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return undefined
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: v.getUint32(16), height: v.getUint32(20) }
}
