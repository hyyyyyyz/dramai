import { describe, expect, it } from 'vitest'
import {
  compressionTiers,
  DEFAULT_COMPRESSION_LIMITS,
  fitReferenceImages,
  jpegQualityToQscale,
  ReferenceTooLargeError,
} from '../src/media/reference-images.ts'
import type { ImageEncoder, ReferenceImageInput } from '../src/media/reference-images.ts'

const MB = 1024 * 1024
const img = (
  id: string,
  bytes: number,
  extra: Partial<ReferenceImageInput> = {},
): ReferenceImageInput => ({
  id,
  bytes: new Uint8Array(bytes),
  mime: 'image/png',
  width: 1000,
  height: 1000,
  ...extra,
})

/** 假编码器：输出大小 = 输入大小 × 质量系数 × (缩放比)²，并记录每次调用。 */
function fakeEncoder() {
  const calls: Array<{ id: string; quality: number; maxLongSide?: number }> = []
  const encode: ImageEncoder = async (input, options) => {
    calls.push({ id: input.id, quality: options.quality, maxLongSide: options.maxLongSide })
    const long = Math.max(input.width ?? 1, input.height ?? 1)
    const scale = options.maxLongSide ? Math.min(1, options.maxLongSide / long) : 1
    const size = Math.max(
      1,
      Math.round(input.bytes.byteLength * (options.quality / 100) * scale * scale * 0.5),
    )
    return { bytes: new Uint8Array(size), mime: 'image/jpeg' }
  }
  return { encode, calls }
}

describe('compression tiers (A3, ADR 0012)', () => {
  it('lowers quality first (92 → 86 → 80) at long side 2048, then the resolution at the quality floor', () => {
    expect(compressionTiers()).toEqual([
      { longSide: 2048, quality: 92 },
      { longSide: 2048, quality: 86 },
      { longSide: 2048, quality: 80 },
      { longSide: 1536, quality: 80 },
      { longSide: 1024, quality: 80 },
      { longSide: 768, quality: 80 },
    ])
  })

  it('has the conservative default limits: 8 MB total, 4 MB per image, long side ≤ 2048, q92 → q80', () => {
    expect(DEFAULT_COMPRESSION_LIMITS).toEqual({
      maxTotalBytes: 8 * MB,
      maxImageBytes: 4 * MB,
      maxLongSide: 2048,
      startQuality: 92,
      minQuality: 80,
    })
  })

  it('maps JPEG quality to ffmpeg qscale monotonically', () => {
    expect(jpegQualityToQscale(100)).toBe(2)
    expect(jpegQualityToQscale(92)).toBeLessThan(jpegQualityToQscale(80))
    expect(jpegQualityToQscale(1)).toBe(31)
  })
})

describe('fitReferenceImages', () => {
  it('leaves images within budget alone (no pointless re-encode)', async () => {
    const { encode, calls } = fakeEncoder()
    const res = await fitReferenceImages([img('a', 1 * MB), img('b', 2 * MB)], encode)
    expect(calls).toEqual([])
    expect(res.images.every((i) => !i.reencoded)).toBe(true)
    expect(res.tier).toBe(0)
  })

  it('downsizes references whose long side exceeds 2048, at q92 first', async () => {
    const { encode, calls } = fakeEncoder()
    const res = await fitReferenceImages(
      [img('big', 3 * MB, { width: 4000, height: 3000 })],
      encode,
    )
    expect(calls).toEqual([{ id: 'big', quality: 92, maxLongSide: 2048 }])
    expect(res.images[0]).toMatchObject({ reencoded: true, mime: 'image/jpeg' })
  })

  it('re-encodes a single image over the 4 MB per-image budget', async () => {
    const { encode, calls } = fakeEncoder()
    const res = await fitReferenceImages([img('fat', 6 * MB)], encode)
    expect(calls[0]).toMatchObject({ id: 'fat', quality: 92 })
    expect(res.images[0].bytes.byteLength).toBeLessThanOrEqual(4 * MB)
  })

  it('steps down a tier when the total is still over 8 MB, re-encoding every reference at the tighter tier', async () => {
    // 6 张各 3 MB（都在单张预算内、不需要缩放）= 18 MB 总量
    const inputs = Array.from({ length: 6 }, (_, i) => img(`r${i}`, 3 * MB))
    const { encode, calls } = fakeEncoder()
    const res = await fitReferenceImages(inputs, encode)
    expect(res.totalBytes).toBeLessThanOrEqual(8 * MB)
    expect(res.tier).toBeGreaterThan(0)
    expect(res.images.every((i) => i.reencoded)).toBe(true)
    // 先试 tier 0 的结果超限，才会走到后面的档位：最后一次调用的质量/尺寸不高于第一次
    expect(calls.at(-1)!.quality).toBeLessThanOrEqual(calls[0].quality)
  })

  it('never goes below the quality floor of 80', async () => {
    const { encode, calls } = fakeEncoder()
    await fitReferenceImages(
      Array.from({ length: 8 }, (_, i) => img(`r${i}`, 3 * MB)),
      encode,
    ).catch(() => {})
    expect(Math.min(...calls.map((c) => c.quality))).toBeGreaterThanOrEqual(80)
  })

  it('a single first/last frame is only re-encoded when over the byte budget, and NEVER resized', async () => {
    const { encode, calls } = fakeEncoder()
    const ok = await fitReferenceImages(
      [img('f', 3 * MB, { role: 'frame', width: 4000, height: 3000 })],
      encode,
    )
    expect(calls).toEqual([]) // 尺寸再大也不动：保护 i2v 首帧
    expect(ok.images[0].reencoded).toBe(false)

    const big = await fitReferenceImages(
      [img('f2', 6 * MB, { role: 'frame', width: 4000, height: 3000 })],
      encode,
    )
    expect(big.images[0].reencoded).toBe(true)
    expect(calls.every((c) => c.maxLongSide === undefined)).toBe(true)
  })

  it('after an HTTP 413, startTier moves down a notch and forces a re-encode', async () => {
    const { encode, calls } = fakeEncoder()
    const first = await fitReferenceImages([img('a', 1 * MB)], encode)
    expect(first.tier).toBe(0)
    expect(calls).toEqual([])
    const retry = await fitReferenceImages([img('a', 1 * MB)], encode, {
      startTier: first.tier + 1,
    })
    expect(calls).toEqual([{ id: 'a', quality: 86, maxLongSide: 2048 }])
    expect(retry.tier).toBe(1)
    expect(retry.images[0].reencoded).toBe(true)
  })

  it('gives up with a clear error when even the lowest tier is too big, or no tier is left after a 413', async () => {
    const stubborn: ImageEncoder = async (input) => ({
      bytes: new Uint8Array(input.bytes.byteLength),
      mime: 'image/jpeg',
    })
    await expect(fitReferenceImages([img('x', 20 * MB)], stubborn)).rejects.toBeInstanceOf(
      ReferenceTooLargeError,
    )
    await expect(fitReferenceImages([img('x', 1)], stubborn, { startTier: 99 })).rejects.toThrow(
      /413/,
    )
  })

  it('honours per-provider limits', async () => {
    const { encode, calls } = fakeEncoder()
    await fitReferenceImages([img('a', 2 * MB)], encode, {
      limits: { ...DEFAULT_COMPRESSION_LIMITS, maxImageBytes: 1 * MB, maxTotalBytes: 2 * MB },
    })
    expect(calls.length).toBeGreaterThan(0)
  })
})
