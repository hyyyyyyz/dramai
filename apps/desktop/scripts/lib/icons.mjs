// Icons are always generated from the brand sources in packages/ui/src/brand/ — nothing derived is committed.
//   app-icon-1024.png         macOS artwork (rounded square with transparent margin)
//   app-icon-square-1024.png  full-bleed square artwork (Windows and Linux)
// The resampler is an area average on premultiplied alpha: pure JS (pngjs), identical on every OS, and it
// keeps small sizes clean (no ringing, no halo at the transparent edges).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

export const brandDir = fileURLToPath(
  new URL('../../../../packages/ui/src/brand/', import.meta.url),
)
export const MAC_ART = join(brandDir, 'app-icon-1024.png')
export const SQUARE_ART = join(brandDir, 'app-icon-square-1024.png')

export function readPng(file) {
  return PNG.sync.read(readFileSync(file))
}

/** Downscale (or copy) a PNG to size x size with an area average on premultiplied alpha. */
export function resizePng(src, size) {
  if (src.width !== src.height) throw new Error('icon artwork must be square')
  if (size === src.width) return src
  const out = new PNG({ width: size, height: size })
  const scale = src.width / size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = x * scale
      const x1 = (x + 1) * scale
      const y0 = y * scale
      const y1 = (y + 1) * scale
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let wsum = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0)
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const w = wy * (Math.min(sx + 1, x1) - Math.max(sx, x0))
          const i = (sy * src.width + sx) * 4
          const alpha = src.data[i + 3] / 255
          r += src.data[i] * alpha * w
          g += src.data[i + 1] * alpha * w
          b += src.data[i + 2] * alpha * w
          a += alpha * w
          wsum += w
        }
      }
      const o = (y * size + x) * 4
      if (a > 0) {
        out.data[o] = Math.round(r / a)
        out.data[o + 1] = Math.round(g / a)
        out.data[o + 2] = Math.round(b / a)
      }
      out.data[o + 3] = Math.round((a / wsum) * 255)
    }
  }
  return out
}

export function writePngSizes(sourceFile, sizes, nameOf) {
  const src = readPng(sourceFile)
  return sizes.map((size) => ({
    size,
    name: nameOf(size),
    data: PNG.sync.write(resizePng(src, size)),
  }))
}

/** Bounding box of the non-transparent pixels, as a fraction of the canvas (used to check margins). */
export function opaqueBounds(png, threshold = 8) {
  let minX = png.width
  let minY = png.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return maxX < 0
    ? undefined
    : {
        left: minX / png.width,
        top: minY / png.height,
        right: 1 - (maxX + 1) / png.width,
        bottom: 1 - (maxY + 1) / png.height,
      }
}

/** Write the PNG sizes into outDir as <size>.png. */
export function writeIconDir(sourceFile, sizes, outDir) {
  mkdirSync(outDir, { recursive: true })
  for (const icon of writePngSizes(sourceFile, sizes, (s) => `${s}.png`))
    writeFileSync(join(outDir, icon.name), icon.data)
}

/** macOS only: build an .icns from the macOS artwork with `iconutil` (used for the source-run dev app). */
export function makeIcns(outFile, sourceFile = MAC_ART) {
  const work = mkdtempSync(join(tmpdir(), 'dramai-iconset-'))
  try {
    const set = join(work, 'icon.iconset')
    mkdirSync(set)
    const src = readPng(sourceFile)
    for (const base of [16, 32, 128, 256, 512]) {
      writeFileSync(join(set, `icon_${base}x${base}.png`), PNG.sync.write(resizePng(src, base)))
      writeFileSync(
        join(set, `icon_${base}x${base}@2x.png`),
        PNG.sync.write(resizePng(src, base * 2)),
      )
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', outFile])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
