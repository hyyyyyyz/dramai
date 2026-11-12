// Icons are always generated from the brand sources in packages/ui/src/brand/ — nothing derived is committed.
//   app-icon-1024.png         macOS artwork (rounded square with transparent margin)
//   app-icon-square-1024.png  full-bleed square artwork (Windows and Linux)
// The resampler is an area average on premultiplied alpha: pure JS (pngjs), identical on every OS, and it
// keeps small sizes clean (no ringing, no halo at the transparent edges).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

export const brandDir = fileURLToPath(
  new URL('../../../../packages/ui/src/brand/', import.meta.url),
)

/**
 * One artwork per platform plus a small-size variant (see packages/ui/src/brand/README.md):
 *   mac      app-icon-1024.png          824 px plate, continuous corners, drop shadow, 100 px margin
 *   windows  app-icon-windows-1024.png  976 px plate, small corner radius
 *   linux    app-icon-linux-1024.png    928 px plate, continuous corners
 *   small    app-icon-small-*.png       used for every rendered size up to 48 px, on every platform
 */
export const ART = {
  mac: join(brandDir, 'app-icon-1024.png'),
  windows: join(brandDir, 'app-icon-windows-1024.png'),
  linux: join(brandDir, 'app-icon-linux-1024.png'),
  small: join(brandDir, 'app-icon-small-1024.png'),
}
export const SMALL_MAX = 48
const platformArt = (platform) =>
  ART[platform === 'darwin' ? 'mac' : platform === 'win32' ? 'windows' : platform]

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

/**
 * The PNG for one rendered size on one platform: the small variant up to 48 px (its pre-rendered exact sizes when the
 * brand folder has them), the platform artwork above that. Never a downscale of the 1024 px plate for small sizes.
 */
export function iconPng(platform, size) {
  if (size <= SMALL_MAX) {
    const exact = join(brandDir, `app-icon-small-${size}.png`)
    if (existsSync(exact)) return readFileSync(exact)
    return PNG.sync.write(resizePng(readPng(ART.small), size))
  }
  return PNG.sync.write(resizePng(readPng(platformArt(platform)), size))
}

/** macOS .icns (needs `iconutil`, so macOS only): 16–512 px at 1x and 2x. */
export function makeIcns(outFile) {
  const work = mkdtempSync(join(tmpdir(), 'dramai-iconset-'))
  try {
    const set = join(work, 'icon.iconset')
    mkdirSync(set)
    for (const base of [16, 32, 128, 256, 512]) {
      writeFileSync(join(set, `icon_${base}x${base}.png`), iconPng('darwin', base))
      writeFileSync(join(set, `icon_${base}x${base}@2x.png`), iconPng('darwin', base * 2))
    }
    mkdirSync(dirname(outFile), { recursive: true })
    execFileSync('iconutil', ['-c', 'icns', set, '-o', outFile])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Windows .ico: PNG-compressed images (Vista and later), exact sizes so Windows rarely has to rescale. */
export const ICO_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256]
export function icoBuffer(sizes = ICO_SIZES) {
  const images = sizes.map((size) => ({ size, data: iconPng('win32', size) }))
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((image, i) => {
    const e = 6 + i * 16
    header.writeUInt8(image.size >= 256 ? 0 : image.size, e)
    header.writeUInt8(image.size >= 256 ? 0 : image.size, e + 1)
    header.writeUInt16LE(1, e + 4) // planes
    header.writeUInt16LE(32, e + 6) // bits per pixel
    header.writeUInt32LE(image.data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += image.data.length
  })
  return Buffer.concat([header, ...images.map((i) => i.data)])
}
export function makeIco(outFile) {
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, icoBuffer())
}

/** Linux: <size>x<size>.png files (electron-builder takes a folder of these; the local install copies them into hicolor). */
export const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
export function linuxIcons(sizes = LINUX_SIZES) {
  return sizes.map((size) => ({ size, data: iconPng('linux', size) }))
}
export function writeLinuxIconDir(outDir) {
  mkdirSync(outDir, { recursive: true })
  for (const { size, data } of linuxIcons())
    writeFileSync(join(outDir, `${size}x${size}.png`), data)
}

/** Everything the build needs for the platform it runs on, under apps/desktop/build/generated/. */
export function generateAppIcons(generatedDir) {
  if (process.platform === 'darwin') makeIcns(join(generatedDir, 'icon.icns'))
  else if (process.platform === 'win32') makeIco(join(generatedDir, 'icon.ico'))
  else writeLinuxIconDir(join(generatedDir, 'linux-icons'))
}
