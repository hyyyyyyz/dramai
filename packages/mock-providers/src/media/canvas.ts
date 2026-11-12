import { glyph, GLYPH_H, GLYPH_W, textWidth } from './font.ts'

export type Rgb = readonly [number, number, number]

export const hex = (value: string): Rgb => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
]

/**
 * A tiny anti-aliased raster canvas (no dependencies): everything is drawn at twice the size and averaged down.
 * Coordinates are in output pixels (floats are fine). Shapes are rectangles, round-capped lines, discs and polygons —
 * enough for storyboard-style line drawings.
 */
export class Canvas {
  static readonly SS = 2
  readonly width: number
  readonly height: number
  private readonly w: number
  private readonly h: number
  private readonly buf: Uint8Array

  constructor(width: number, height: number, background: Rgb) {
    this.width = width
    this.height = height
    this.w = width * Canvas.SS
    this.h = height * Canvas.SS
    this.buf = new Uint8Array(this.w * this.h * 3)
    for (let i = 0; i < this.buf.length; i += 3) {
      this.buf[i] = background[0]
      this.buf[i + 1] = background[1]
      this.buf[i + 2] = background[2]
    }
  }

  private paint(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: Rgb,
    inside: (x: number, y: number) => boolean,
  ): void {
    const s = Canvas.SS
    const ax = Math.max(0, Math.floor(x0 * s))
    const ay = Math.max(0, Math.floor(y0 * s))
    const bx = Math.min(this.w, Math.ceil(x1 * s))
    const by = Math.min(this.h, Math.ceil(y1 * s))
    for (let y = ay; y < by; y++) {
      for (let x = ax; x < bx; x++) {
        if (!inside((x + 0.5) / s, (y + 0.5) / s)) continue
        const i = (y * this.w + x) * 3
        this.buf[i] = color[0]
        this.buf[i + 1] = color[1]
        this.buf[i + 2] = color[2]
      }
    }
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    this.paint(
      x,
      y,
      x + w,
      y + h,
      color,
      (px, py) => px >= x && px < x + w && py >= y && py < y + h,
    )
  }

  /** A hollow rectangle whose stroke lies inside the given box. */
  frame(x: number, y: number, w: number, h: number, thick: number, color: Rgb): void {
    this.rect(x, y, w, thick, color)
    this.rect(x, y + h - thick, w, thick, color)
    this.rect(x, y + thick, thick, h - 2 * thick, color)
    this.rect(x + w - thick, y + thick, thick, h - 2 * thick, color)
  }

  /** A thick line with round caps (thickness in pixels). */
  line(x1: number, y1: number, x2: number, y2: number, thick: number, color: Rgb): void {
    const r = thick / 2
    const dx = x2 - x1
    const dy = y2 - y1
    const len2 = dx * dx + dy * dy || 1
    this.paint(
      Math.min(x1, x2) - r,
      Math.min(y1, y2) - r,
      Math.max(x1, x2) + r,
      Math.max(y1, y2) + r,
      color,
      (px, py) => {
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
        const cx = x1 + t * dx
        const cy = y1 + t * dy
        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
      },
    )
  }

  /** A dashed straight line with square ends. */
  dashed(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    thick: number,
    dash: number,
    gap: number,
    color: Rgb,
  ): void {
    const len = Math.hypot(x2 - x1, y2 - y1)
    const ux = (x2 - x1) / len
    const uy = (y2 - y1) / len
    for (let d = 0; d < len; d += dash + gap) {
      const e = Math.min(len, d + dash)
      this.line(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e, thick, color)
    }
  }

  disc(cx: number, cy: number, r: number, color: Rgb): void {
    this.paint(
      cx - r,
      cy - r,
      cx + r,
      cy + r,
      color,
      (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r,
    )
  }

  /** A filled polygon (even-odd). */
  poly(points: ReadonlyArray<readonly [number, number]>, color: Rgb): void {
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    this.paint(
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
      color,
      (px, py) => {
        let inside = false
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i]!
          const [xj, yj] = points[j]!
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
        }
        return inside
      },
    )
  }

  /** Bitmap text (the 5x7 font), `scale` pixels per dot. `align` is relative to x. */
  text(
    value: string,
    x: number,
    y: number,
    scale: number,
    color: Rgb,
    align: 'left' | 'center' | 'right' = 'left',
  ): void {
    const w = textWidth(value, scale)
    let x0 = align === 'left' ? x : align === 'center' ? x - w / 2 : x - w
    for (const ch of value) {
      const g = glyph(ch)
      for (let gy = 0; gy < GLYPH_H; gy++)
        for (let gx = 0; gx < GLYPH_W; gx++)
          if (g[gy]![gx] === '#') this.rect(x0 + gx * scale, y + gy * scale, scale, scale, color)
      x0 += (GLYPH_W + 1) * scale
    }
  }

  /** Average the supersampled buffer down to the output size. */
  toRgb(): Uint8Array {
    const s = Canvas.SS
    const out = new Uint8Array(this.width * this.height * 3)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let r = 0
        let g = 0
        let b = 0
        for (let dy = 0; dy < s; dy++)
          for (let dx = 0; dx < s; dx++) {
            const i = ((y * s + dy) * this.w + x * s + dx) * 3
            r += this.buf[i]!
            g += this.buf[i + 1]!
            b += this.buf[i + 2]!
          }
        const o = (y * this.width + x) * 3
        out[o] = Math.round(r / (s * s))
        out[o + 1] = Math.round(g / (s * s))
        out[o + 2] = Math.round(b / (s * s))
      }
    }
    return out
  }
}
