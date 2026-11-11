import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/data-dir.ts'
import { localeFromAcceptLanguage, normalizeLocale, pick } from '../src/i18n.ts'
import {
  expandStyle,
  localizeStyleGroup,
  localizeStylePreset,
  localizeStyleSnapshot,
} from '../src/prompts/styles.ts'
import {
  localizeProviderConfig,
  localizeProviderPreset,
  PROVIDER_PRESETS,
  configFromPreset,
} from '../src/providers/presets.ts'

const catalog = loadCatalog()
const hasCjk = (s: string) => /[一-鿿]/.test(s)

describe('locale parsing', () => {
  it('normalizes language tags and Accept-Language', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh')
    expect(normalizeLocale('EN-us')).toBe('en')
    expect(normalizeLocale('fr')).toBeUndefined()
    expect(normalizeLocale('')).toBeUndefined()
    expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8')).toBe('en')
    expect(localeFromAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.5')).toBe('zh')
    expect(localeFromAcceptLanguage('en;q=0.2, zh;q=0.9')).toBe('zh')
    expect(localeFromAcceptLanguage(undefined)).toBeUndefined()
    expect(pick({ zh: '中', en: 'en' }, 'en')).toBe('en')
    expect(pick({ zh: '中' }, 'en')).toBe('中')
  })
})

describe('built-in data is bilingual (nothing Chinese leaks into the English UI)', () => {
  it('every bundled style group and preset has English text with no Chinese in it', () => {
    for (const g of catalog.styles.groups) {
      expect(hasCjk(localizeStyleGroup(g, 'en')), g.id).toBe(false)
      for (const p of g.presets) {
        const t = localizeStylePreset(p, 'en')
        expect(hasCjk(t.label) || hasCjk(t.description), p.id).toBe(false)
        expect(t.label.length).toBeGreaterThan(0)
        // 中文仍是源语言
        expect(localizeStylePreset(p, 'zh').label).toBe(p.label)
      }
    }
  })

  it('every provider preset has English label / notes / limitations (same number of limitations)', () => {
    for (const p of PROVIDER_PRESETS) {
      const t = localizeProviderPreset(p, 'en')
      expect(hasCjk(t.label) || hasCjk(t.notes) || t.knownLimitations.some(hasCjk), p.id).toBe(
        false,
      )
      expect(t.knownLimitations).toHaveLength(p.knownLimitations.length)
    }
  })
})

describe('localizing stored copies: built-in text is translated, user text is returned as written', () => {
  const now = 1
  it('a template style snapshot shows the English preset name; an edited name stays', () => {
    const snap = expandStyle(
      catalog.styles,
      { source: 'template', templateId: 'mystery_realistic' },
      now,
    )
    expect(localizeStyleSnapshot(snap, catalog.styles, 'en')).toMatchObject({
      label: 'Suspense realism',
    })
    expect(localizeStyleSnapshot(snap, catalog.styles, 'zh')).toEqual(snap)
    const renamed = { ...snap, label: '我自己起的名字' }
    expect(localizeStyleSnapshot(renamed, catalog.styles, 'en').label).toBe('我自己起的名字')
    expect(localizeStyleSnapshot(snap, catalog.styles, 'en').imageKeywords).toBe(snap.imageKeywords)
  })

  it('"unspecified / custom / reference" labels are translated, the user-written custom description is not', () => {
    expect(
      localizeStyleSnapshot(
        expandStyle(catalog.styles, { source: 'none' }, now),
        catalog.styles,
        'en',
      ).label,
    ).toBe('Unspecified')
    const custom = expandStyle(
      catalog.styles,
      { source: 'custom', description: '我想要的颜色很淡' },
      now,
    )
    const en = localizeStyleSnapshot(custom, catalog.styles, 'en')
    expect(en.label).toBe('Custom')
    expect(en.description).toBe('我想要的颜色很淡')
  })

  it('a provider config made from a preset is translated field by field unless the user changed it', () => {
    const preset = PROVIDER_PRESETS[0]!
    const cfg = configFromPreset(preset, { id: 'p1' })
    const en = localizeProviderConfig(cfg, 'en')
    expect(hasCjk(en.label) || hasCjk(en.notes ?? '')).toBe(false)
    const edited = localizeProviderConfig(
      { ...cfg, label: '我的 DeepSeek', notes: '自己的备注' },
      'en',
    )
    expect(edited.label).toBe('我的 DeepSeek')
    expect(edited.notes).toBe('自己的备注')
    expect(edited.knownLimitations).toEqual(localizeProviderPreset(preset, 'en').knownLimitations)
    // 不是由预设创建的：原样
    expect(localizeProviderConfig({ label: '手填', notes: '备注' }, 'en')).toEqual({
      label: '手填',
      notes: '备注',
      knownLimitations: undefined,
    })
  })
})
