import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { placeholderPng, pngSize } from '../src/media/png.ts'
import {
  locateMedia,
  renderPlaceholderVideo,
  videoBar,
  videoBarHeight,
} from '../src/media/video.ts'

/** Decode our own PNGs (8-bit RGB, filter type 0 only). */
function decode(png: Uint8Array): { width: number; height: number; rgb: Uint8Array } {
  const { width, height } = pngSize(png)!
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const idat: Uint8Array[] = []
  for (let off = 8; off < png.length; ) {
    const len = view.getUint32(off)
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8))
    if (type === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len))
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++)
    rgb.set(raw.subarray(y * (width * 3 + 1) + 1, (y + 1) * (width * 3 + 1)), y * width * 3)
  return { width, height, rgb }
}

const hcl = (r: number, g: number, b: number): { h: number; c: number; l: number } => {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, c: 0, l }
  const h0 = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4
  return { h: (h0 * 60 + 360) % 360, c: d, l }
}

const make = (seed: string, kind: 'shot' | 'sheet', n = 1, width = 288, height = 512) =>
  placeholderPng({ width, height, seed, kind, serial: n, code: 'A1B2' })
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')

describe('demo placeholder pictures', () => {
  it('are valid PNGs of the requested size, and deterministic', () => {
    const a = make('s#1', 'shot')
    expect(pngSize(a)).toEqual({ width: 288, height: 512 })
    expect(make('s#1', 'shot')).toEqual(a)
    expect(pngSize(make('s#1', 'sheet', 1, 512, 288))).toEqual({ width: 512, height: 288 })
  })

  it('differ between shots, between assets, between kinds, and between two runs of the same prompt', () => {
    expect(new Set(['a#1', 'b#2', 'c#3', 'd#4', 'e#5'].map((s) => b64(make(s, 'shot')))).size).toBe(
      5,
    )
    expect(
      new Set(['hero#1', 'guard#2', 'room#3'].map((s) => b64(make(s, 'sheet', 1, 512, 288)))).size,
    ).toBe(3)
    expect(b64(make('x#1', 'shot', 1, 400, 400))).not.toBe(b64(make('x#1', 'sheet', 1, 400, 400)))
    expect(b64(make('x#1', 'shot', 1))).not.toBe(b64(make('x#1', 'shot', 2)))
  })

  it('stay inside the brand palette: ink, paper, quiet neutrals, and cinnabar only as the DEMO stamp', () => {
    for (const [seed, kind, w, h] of [
      ['a#1', 'shot', 288, 512],
      ['b#2', 'shot', 360, 640],
      ['hero#3', 'sheet', 512, 288],
    ] as const) {
      const { rgb, width, height } = decode(make(seed, kind, 3, w, h))
      let cinnabar = 0
      let offBrand = 0
      for (let i = 0; i < rgb.length; i += 3) {
        const { h: hh, c, l } = hcl(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!)
        if (c < 0.2) continue // ink, paper and the warm greys (chroma, not HSL saturation, which is inflated near white)
        // anything saturated must be cinnabar (orange-red); never purple, magenta, blue or green
        if (hh >= 8 && hh <= 45 && l > 0.2 && l < 0.7) cinnabar++
        else offBrand++
      }
      const total = width * height
      expect(offBrand / total, `${seed}: off-brand pixels`).toBeLessThan(0.0005)
      expect(cinnabar / total, `${seed}: cinnabar share`).toBeGreaterThan(0.002) // the stamp is there
      expect(cinnabar / total, `${seed}: cinnabar share`).toBeLessThan(0.05) // and it is an accent, not a wash
    }
  })

  it('have no gradient: a few flat colours plus anti-aliased edges', () => {
    const { rgb } = decode(make('flat#1', 'shot'))
    const counts = new Map<number, number>()
    for (let i = 0; i < rgb.length; i += 3) {
      const key = (rgb[i]! << 16) | (rgb[i + 1]! << 8) | rgb[i + 2]!
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const top = [...counts.values()].sort((a, b) => b - a).slice(0, 12)
    expect(top.reduce((a, b) => a + b, 0) / (rgb.length / 3)).toBeGreaterThan(0.9)
  })

  it('say they are placeholders in the picture itself: the DEMO stamp sits top-left on paper', () => {
    const { rgb, width } = decode(make('stamp#1', 'shot'))
    const px = (x: number, y: number) => [0, 1, 2].map((k) => rgb[(y * width + x) * 3 + k]!)
    const margin = Math.round(288 * 0.05)
    expect(px(margin + 2, margin + 2)).toEqual([0xdf, 0x50, 0x0c]) // cinnabar #DF500C
    expect(px(2, 2).every((v) => v > 230)).toBe(true) // paper around it
  })
})

describe('demo placeholder videos', () => {
  it('draw an ink control bar with a cinnabar record square and a growing timeline (drawbox only, no fonts)', () => {
    const f = videoBar(270, 480, 3)
    expect(f).toMatch(/^pad=270:480:0:0:color=0x100E0C/)
    expect(f).toContain('color=0xDF500C')
    expect(f).toContain("enable='lt(mod(t,1),0.6)'") // the record square blinks
    expect((f.match(/gte\(t,/g) ?? []).length).toBe(24) // the timeline fills in 24 steps
    expect(f).not.toContain('drawtext')
    expect(videoBarHeight(480) % 2).toBe(0)
    expect(videoBarHeight(100)).toBeGreaterThanOrEqual(12)
  })

  it('render with and without a start frame', async (ctx) => {
    const env = await locateMedia()
    if (!env) return ctx.skip()
    for (const image of [make('v#1', 'shot', 1, 270, 480), undefined]) {
      const bytes = await renderPlaceholderVideo(env, {
        image,
        durationSec: 1,
        width: 270,
        height: 480,
        withAudio: false,
      })
      expect(String.fromCharCode(...bytes.subarray(4, 8))).toBe('ftyp')
      expect(bytes.byteLength).toBeGreaterThan(1000)
    }
  }, 60_000)
})
