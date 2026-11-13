import { describe, expect, it } from 'vitest'
import { normalizeShortSide, OutputSizeError, resolveOutputSize } from '../src/media/output-size.ts'

describe('normalizeShortSide', () => {
  it('maps tier names, WxH, numbers and defaults', () => {
    expect(normalizeShortSide('720P')).toBe(720)
    expect(normalizeShortSide('1080p')).toBe(1080)
    expect(normalizeShortSide('2K')).toBe(1440)
    expect(normalizeShortSide('4k')).toBe(2160)
    expect(normalizeShortSide('1920x1080')).toBe(1080)
    expect(normalizeShortSide('1080x1920')).toBe(1080)
    expect(normalizeShortSide(900)).toBe(900)
    expect(normalizeShortSide('none')).toBe(720)
    expect(normalizeShortSide(undefined)).toBe(720)
    expect(normalizeShortSide('garbage')).toBe(720)
  })
})

describe('resolveOutputSize', () => {
  it.each([
    ['16:9', '720p', 2, 1280, 720],
    ['9:16', '720p', 2, 720, 1280],
    ['9:16', '1080p', 2, 1080, 1920],
    ['16:9', '1080p', 2, 1920, 1080],
    ['1:1', '720p', 2, 720, 720],
    // 480p 在步长 2 下取比例零误差的最近值：18t≈480 → t=27 → 864x486
    ['16:9', '480p', 2, 864, 486],
  ] as const)('%s @ %s step %i → %ix%i', (ratio, res, step, w, h) => {
    expect(resolveOutputSize({ aspectRatio: ratio, resolution: res, step })).toEqual({
      width: w,
      height: h,
    })
  })

  it('ignores the ratio carried by a user "WxH" resolution — the project ratio always wins', () => {
    const size = resolveOutputSize({ aspectRatio: '9:16', resolution: '1920x1080' })
    expect(size).toEqual({ width: 1080, height: 1920 })
  })

  it('keeps the ratio exact and dimensions divisible by the model step', () => {
    for (const ratio of ['9:16', '16:9', '1:1'] as const) {
      for (const step of [2, 8, 16, 64]) {
        for (const res of ['480p', '720p', '1080p', 1000]) {
          const { width, height } = resolveOutputSize({ aspectRatio: ratio, resolution: res, step })
          expect(width % step).toBe(0)
          expect(height % step).toBe(0)
          const [aw, ah] = ratio.split(':').map(Number)
          expect(width * ah).toBe(height * aw) // 比例零误差
        }
      }
    }
  })

  it('clamps by max long side and max pixels, shrinking in whole steps', () => {
    const a = resolveOutputSize({ aspectRatio: '16:9', resolution: '1080p', maxLongSide: 1280 })
    expect(a).toEqual({ width: 1280, height: 720 })
    const b = resolveOutputSize({ aspectRatio: '1:1', resolution: '1080p', maxPixels: 1024 * 1024 })
    expect(b.width * b.height).toBeLessThanOrEqual(1024 * 1024)
    expect(b.width).toBe(b.height)
  })

  it('throws when even the smallest valid size breaks the limits', () => {
    expect(() => resolveOutputSize({ aspectRatio: '9:16', step: 64, maxLongSide: 100 })).toThrow(
      OutputSizeError,
    )
  })

  it('defaults to 720 short side and step 2', () => {
    expect(resolveOutputSize({ aspectRatio: '9:16' })).toEqual({ width: 720, height: 1280 })
  })
})

describe('resolveOutputSize: minimum total pixels', () => {
  it('raises the size to the floor, keeps the ratio and the step, and never goes under it', () => {
    // the reviewer's cases: gpt-image-2.5 floor 655,360 (1:1 @ short side 720 used to give 720x720)
    const a = resolveOutputSize({
      aspectRatio: '1:1',
      resolution: 720,
      step: 16,
      minPixels: 655_360,
    })
    expect(a).toEqual({ width: 816, height: 816 })
    const b = resolveOutputSize({
      aspectRatio: '9:16',
      resolution: 480,
      step: 16,
      minPixels: 655_360,
    })
    expect(b.width * b.height).toBeGreaterThanOrEqual(655_360)
    expect(b.width / b.height).toBeCloseTo(9 / 16, 10)
    expect(b.width % 16).toBe(0)
    expect(b.height % 16).toBe(0)
    // no floor: unchanged
    expect(resolveOutputSize({ aspectRatio: '1:1', resolution: 720, step: 16 })).toEqual({
      width: 720,
      height: 720,
    })
  })

  it('a size already above the floor is untouched', () => {
    expect(
      resolveOutputSize({ aspectRatio: '16:9', resolution: 1080, step: 16, minPixels: 655_360 }),
    ).toEqual(resolveOutputSize({ aspectRatio: '16:9', resolution: 1080, step: 16 }))
  })

  it('a floor above the ceiling is an error, not a size the backend will reject', () => {
    expect(() =>
      resolveOutputSize({
        aspectRatio: '1:1',
        resolution: 720,
        step: 16,
        minPixels: 1_000_000,
        maxPixels: 500_000,
      }),
    ).toThrow(OutputSizeError)
    expect(() =>
      resolveOutputSize({
        aspectRatio: '16:9',
        resolution: 720,
        step: 16,
        minPixels: 1_000_000,
        maxLongSide: 1000,
      }),
    ).toThrow(OutputSizeError)
  })
})
