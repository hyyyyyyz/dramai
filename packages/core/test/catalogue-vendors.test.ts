import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/data-dir.ts'
import {
  localizeProviderPreset,
  localizeVendor,
  PROVIDER_PRESETS,
  PROVIDER_VENDORS,
} from '../src/providers/presets.ts'

/** The resale platform that used to have a vendor group and four presets. Its name and addresses are gone. */
const REMOVED_ID = /^302/i
const REMOVED_TEXT = /302\.?ai|302ai|api\.302|\/\/[^/\s]*302/i

describe('the preset catalogue', () => {
  it('has the expected numbers of presets, vendors and kinds', () => {
    const count = (kind: string) => PROVIDER_PRESETS.filter((p) => p.kind === kind).length
    expect(PROVIDER_PRESETS).toHaveLength(36)
    expect(PROVIDER_VENDORS).toHaveLength(15)
    expect([count('llm'), count('image'), count('video'), count('tts')]).toEqual([16, 8, 6, 6])
    // every vendor has at least one preset, every preset a known vendor
    const used = new Set(PROVIDER_PRESETS.map((p) => p.vendor))
    expect([...used].sort()).toEqual(PROVIDER_VENDORS.map((v) => v.id).sort())
  })

  it('has no preset, vendor id, vendor name or label of the removed platform, in any language', () => {
    for (const v of PROVIDER_VENDORS) {
      expect(v.id, v.id).not.toMatch(REMOVED_ID)
      for (const lang of ['zh', 'zh-Hant', 'en'] as const)
        expect(localizeVendor(v.id, lang).label, `${v.id}/${lang}`).not.toMatch(REMOVED_TEXT)
    }
    for (const p of PROVIDER_PRESETS) {
      expect(p.id, p.id).not.toMatch(REMOVED_ID)
      expect(p.vendor, p.id).not.toMatch(REMOVED_ID)
      expect(p.baseUrl, p.id).not.toMatch(REMOVED_TEXT)
      for (const lang of ['zh', 'zh-Hant', 'en'] as const) {
        const t = localizeProviderPreset(p, lang)
        const text = [t.label, t.notes, ...t.knownLimitations, p.suggestedModel].join('\n')
        expect(text, `${p.id}/${lang}`).not.toMatch(REMOVED_TEXT)
      }
    }
  })

  it('names the removed platform nowhere in the bundled model data either', () => {
    const raw = readFileSync(new URL('../data/models/models.json', import.meta.url), 'utf8')
    expect(raw).not.toMatch(REMOVED_TEXT)
    expect(JSON.stringify(loadCatalog().models.all())).not.toMatch(REMOVED_TEXT)
  })

  it('keeps the only tested preset: its verification status is untouched', () => {
    expect(
      PROVIDER_PRESETS.filter((p) => p.verification.status === 'tested').map((p) => [
        p.id,
        p.verification,
      ]),
    ).toEqual([['deepseek-llm', { status: 'tested', testedAt: '2026-05-04' }]])
  })
})
