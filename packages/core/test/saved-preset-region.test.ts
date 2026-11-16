import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/data-dir.ts'
import { estimateCost } from '../src/providers/catalog.ts'
import { providerRegionOf } from '../src/providers/presets.ts'

const catalog = loadCatalog()

/**
 * Providers saved from presets that were removed keep a `presetId` that no longer matches anything. Their site
 * (region) used to come from the preset (`global`); it is now unknown. The region only picks region-specific price
 * entries, and none of these models has one, so the estimate must not change.
 */
describe('a saved provider whose preset was removed', () => {
  const saved = [
    {
      presetId: '302-image-seedream',
      baseUrl: 'https://api.302.ai/doubao',
      protocol: 'openai-images',
      model: 'doubao-seedream-5-0-260128',
      query: { count: 3 },
    },
    {
      presetId: '302-image-nano-banana',
      baseUrl: 'https://api.302.ai',
      protocol: 'gemini-image',
      model: 'gemini-2.5-flash-image',
      query: { count: 2 },
    },
    {
      presetId: '302-i2v-wan-flash',
      baseUrl: 'https://api.302ai.cn',
      protocol: 'aliyun-video',
      model: 'wan2.2-i2v-flash',
      query: { seconds: 5, resolution: '720P' },
    },
  ] as const

  it('has no known region any more', () => {
    for (const s of saved) expect(providerRegionOf(s), s.presetId).toBeUndefined()
  })

  it('gets the same cost estimate as with the region it used to have', () => {
    for (const s of saved) {
      const profile = catalog.models.lookup({ protocol: s.protocol, model: s.model }).profile!
      expect(
        profile.pricing.some((p) => p.dimensions?.region),
        s.presetId,
      ).toBe(false)
      const before = estimateCost(profile, { ...s.query, region: 'global' })
      const after = estimateCost(profile, { ...s.query, region: providerRegionOf(s) })
      expect(before.priced, s.presetId).toBe(true)
      expect(after, s.presetId).toEqual(before)
    }
  })
})
