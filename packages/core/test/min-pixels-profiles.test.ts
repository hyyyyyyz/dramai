import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/data-dir.ts'
import { resolveOutputSize } from '../src/media/output-size.ts'
import { aspectParts, ASPECT_RATIOS } from '../src/domain/common.ts'

/**
 * 每个有官方总像素下限的画像：所有画幅 × 五档短边算出的尺寸都必须
 * 落在 [下限, 上限] 内、是步长的整数倍、比例零误差。
 * （项目只有三种画幅：9:16 / 16:9 / 1:1。）
 */
const SHORT_SIDES = [360, 480, 720, 1024, 1440]
const models = loadCatalog().models.all()
const withFloor = models.filter((m) => m.capability.minPixels !== undefined)

describe('image profiles with an official minimum pixel count', () => {
  it('lists every model whose floor the reviewer or the official pages name', () => {
    expect(withFloor.map((m) => m.id).sort()).toEqual(
      [
        'MiniMax-H3-Image',
        'MiniMax-H3-Image-Highspeed',
        'doubao-seedream-5-5-261028',
        'gpt-image-2.5-flare',
        'gpt-image-2.5-sunburst',
        'qwen-image-2.0',
        'qwen-image-2.0-pro',
        'volcengine-doubao-seedream-5-0-260128',
      ].sort(),
    )
    for (const m of withFloor) {
      // every floor is written down with its source (a quirk or the provenance mentions it)
      expect([...m.quirks, m.provenance].join(' '), m.id).toMatch(/下限|512|像素/)
    }
  })

  describe.each(withFloor.map((m) => [m.id, m] as const))('%s', (_id, m) => {
    const c = m.capability
    it.each(ASPECT_RATIOS.flatMap((r) => SHORT_SIDES.map((s) => [r, s] as const)))(
      '%s at short side %i',
      (ratio, short) => {
        const { width, height } = resolveOutputSize({
          aspectRatio: ratio,
          resolution: short,
          step: c.sizeStep ?? 16,
          maxLongSide: c.maxLongSide,
          maxPixels: c.maxPixels,
          minPixels: c.minPixels,
        })
        expect(width * height).toBeGreaterThanOrEqual(c.minPixels!)
        if (c.maxPixels) expect(width * height).toBeLessThanOrEqual(c.maxPixels)
        if (c.maxLongSide) expect(Math.max(width, height)).toBeLessThanOrEqual(c.maxLongSide)
        expect(width % (c.sizeStep ?? 16)).toBe(0)
        expect(height % (c.sizeStep ?? 16)).toBe(0)
        const { w, h } = aspectParts(ratio)
        expect(width * h).toBe(height * w)
      },
    )
  })
})
