import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/data-dir.ts'
import { checkBaseUrl } from '../src/providers/base-url.ts'
import {
  configFromPreset,
  localizeProviderPreset,
  PROVIDER_PRESETS,
  PROVIDER_VENDORS,
} from '../src/providers/presets.ts'
import { getMediaProtocol } from '../src/providers/protocols/index.ts'

const catalog = loadCatalog()
const videoPresets = PROVIDER_PRESETS.filter((p) => p.kind === 'video')
const newOnes = videoPresets.filter((p) => p.id !== '302-i2v-wan-flash')
const models = catalog.models.all().filter((m) => m.capability.media === 'video')
const newProfiles = models.filter((m) =>
  ['ark-video', 'kling-contents', 'dashscope-video'].includes(m.protocol),
)

describe('video presets (P3c first batch): documented, not tested', () => {
  it('the six new presets and the one tested 302.AI preset', () => {
    expect(newOnes.map((p) => p.id).sort()).toEqual([
      'aliyun-wan3-cn',
      'aliyun-wan3-intl',
      'byteplus-seedance',
      'kling-video-cn',
      'kling-video-global',
      'volcengine-seedance',
    ])
    const tested = videoPresets.filter((p) => p.verification.status === 'tested')
    expect(tested.map((p) => p.id)).toEqual(['302-i2v-wan-flash'])
  })

  it('the tested Wan Flash preset is exactly what it was', () => {
    const p = PROVIDER_PRESETS.find((x) => x.id === '302-i2v-wan-flash')!
    expect(p).toMatchObject({
      kind: 'video',
      protocol: 'aliyun-video',
      baseUrl: 'https://api.302ai.cn',
      suggestedModel: 'wan2.2-i2v-flash',
      verification: { status: 'tested', testedAt: '2026-05-04' },
      verifiedAt: '2026-05-04',
    })
  })

  it.each(newOnes.map((p) => [p.id, p] as const))('%s', (_id, p) => {
    expect(p.verification).toMatchObject({ status: 'documented' })
    expect(p.verifiedAt).toBeUndefined() // none claims a test date
    expect((p.verification as { source: string }).source).toMatch(/^https:\/\//)
    expect(p.auth).toEqual({ type: 'api_key' })
    expect(['cn', 'global']).toContain(p.region)
    expect(PROVIDER_VENDORS.some((v) => v.id === p.vendor)).toBe(true)
    expect(p.notes).toContain('按官方文档接入，未实测')
    expect(p.knownLimitations.length).toBeGreaterThanOrEqual(4)
    // every language has the full set of texts, with the same number of limitations
    for (const lang of ['en', 'zh-Hant'] as const) {
      const t = localizeProviderPreset(p, lang)
      expect(t.knownLimitations, lang).toHaveLength(p.knownLimitations.length)
      expect(t.label, lang).not.toBe(p.label)
    }
    // the protocol is registered and the suggested model has a profile on that protocol
    expect(() => getMediaProtocol(p.protocol)).not.toThrow()
    expect(catalog.models.lookup({ protocol: p.protocol, model: p.suggestedModel }).declared).toBe(
      true,
    )
    // the address is complete unless it names its placeholder; and once filled it passes the address check
    const filled = p.baseUrl.replace(/\{(\w+)\}/g, 'ws1')
    expect(checkBaseUrl(filled).ok, filled).toBe(true)
    expect(checkBaseUrl(p.baseUrl).ok).toBe(!p.baseUrlPlaceholders)
    const cfg = configFromPreset(p, { id: 'x' })
    expect(cfg).toMatchObject({ kind: 'video', protocol: p.protocol, model: p.suggestedModel })
  })

  it('the decided defaults: Seedance 2.0 (2.5 is selectable), Kling 4.0, Wan 3.0', () => {
    const by = (id: string) => PROVIDER_PRESETS.find((p) => p.id === id)!
    expect(by('volcengine-seedance').suggestedModel).toBe('doubao-seedance-2-0-260128')
    expect(by('byteplus-seedance').suggestedModel).toBe('dreamina-seedance-2-0-260128')
    expect(by('volcengine-seedance').notes).toContain('doubao-seedance-2-5-260628')
    expect(by('kling-video-cn').suggestedModel).toBe('kling-4.0')
    expect(by('aliyun-wan3-cn').baseUrlPlaceholders).toEqual(['WorkspaceId'])
    expect(by('aliyun-wan3-intl').baseUrl).toContain('ap-southeast-1')
  })

  it('every preset says the real-person rule (Seedance) or the audio rule (Kling), in every language', () => {
    const texts = (id: string) => {
      const p = PROVIDER_PRESETS.find((x) => x.id === id)!
      return [p, localizeProviderPreset(p, 'en'), localizeProviderPreset(p, 'zh-Hant')].map((t) =>
        t.knownLimitations.join(' '),
      )
    }
    for (const t of texts('volcengine-seedance')) expect(t).toContain('PrivacyInformation')
    for (const t of texts('byteplus-seedance')) expect(t).toContain('PrivacyInformation')
    for (const id of ['kling-video-cn', 'kling-video-global'])
      for (const t of texts(id)) expect(t).toContain('native / original')
  })

  it('BytePlus is a vendor of its own, localized', () => {
    expect(PROVIDER_VENDORS.find((v) => v.id === 'byteplus')).toMatchObject({ name: 'BytePlus' })
  })
})

describe('video model profiles (P3c): everything is claimed, nothing is verified', () => {
  it('ten new profiles with unique ids and unique protocol:model keys', () => {
    expect(newProfiles).toHaveLength(10)
    const all = catalog.models.all()
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length)
    expect(new Set(all.map((m) => `${m.protocol}:${m.apiModel}`)).size).toBe(all.length)
  })

  it.each(newProfiles.map((m) => [m.id, m] as const))('%s', (_id, m) => {
    const c = m.capability
    expect(c.verifiedAt).toBeUndefined()
    for (const mode of ['t2v', 'i2v', 'first_last', 'omni_ref'] as const)
      expect(c.modes[mode], mode).toBe('unverified')
    for (const k of ['refImages', 'durations', 'resolutions', 'aspectRatios'] as const) {
      expect(c[k].support, k).toBe('unverified')
      expect(c[k].value, k).toBeDefined()
    }
    for (const k of ['firstFrame', 'lastFrame', 'nativeAudio'] as const)
      expect(c[k], k).toBe('unverified')
    // reference video / audio: the model can, this project cannot send local files yet
    expect(c.refVideos.support).toBe('unsupported')
    expect(c.refAudios.support).toBe('unsupported')
    expect(m.provenance).toContain('未验证')
    expect(m.quirks.length).toBeGreaterThan(0)
    expect(m.prompt.referenceBinding).toMatch(/\{n\}/)
    expect(m.prompt.referenceBinding).toMatch(/\{name\}/)
  })

  it('the frame-with-references and audio-toggle facts per family', () => {
    const cap = (protocol: string, model: string) =>
      catalog.models.lookup({ protocol: protocol as never, model }).capability
    for (const [p, m] of [
      ['ark-video', 'doubao-seedance-2-0-260128'],
      ['ark-video', 'dreamina-seedance-2-5-260628'],
      ['dashscope-video', 'wan3.0-video'],
      ['dashscope-video', 'wan3.0-video-prime'],
    ] as const)
      expect(cap(p, m).firstFrameWithRefs, m).toBe('unsupported') // official: mutually exclusive
    for (const m of ['kling-4.0', 'kling-4.0-flash']) {
      expect(cap('kling-contents', m).firstFrameWithRefs, m).toBe('unverified') // official examples combine them
      expect(cap('kling-contents', m).audioToggle, m).toBe('unsupported') // only native / original
    }
  })

  it('claimed ranges follow the official pages', () => {
    const cap = (protocol: string, model: string) =>
      catalog.models.lookup({ protocol: protocol as never, model }).capability
    expect(cap('ark-video', 'doubao-seedance-2-5-260628').durations.value).toEqual({
      min: 4,
      max: 30,
    })
    expect(cap('ark-video', 'doubao-seedance-2-0-260128').durations.value).toEqual({
      min: 4,
      max: 15,
    })
    expect(cap('ark-video', 'doubao-seedance-2-5-260628').refImages.value).toBe(30)
    expect(cap('ark-video', 'doubao-seedance-2-0-260128').refImages.value).toBe(9)
    expect(cap('ark-video', 'doubao-seedance-2-0-fast-260128').resolutions.value).toEqual([
      '480p',
      '720p',
    ])
    expect(cap('ark-video', 'doubao-seedance-2-0-260128').resolutions.value).toContain('4k')
    expect(cap('kling-contents', 'kling-4.0-flash').resolutions.value).toEqual(['720p'])
    expect(cap('kling-contents', 'kling-4.0-flash').durations.value).toEqual({ min: 3, max: 20 })
    expect(cap('kling-contents', 'kling-4.0').durations.value).toEqual({ min: 3, max: 30 })
    expect(cap('dashscope-video', 'wan3.0-video').resolutions.value).toEqual([
      '480P',
      '720P',
      '1080P',
    ])
    expect(cap('dashscope-video', 'wan3.0-video').durations.value).toEqual({ min: 2, max: 30 })
  })

  it('Wan 3.0 is priced per second in CNY (official page); Seedance and Kling are not priced', () => {
    const price = (model: string) =>
      catalog.models
        .all()
        .find((m) => m.apiModel === model && m.protocol === 'dashscope-video')!
        .pricing.map((x) => [x.dimensions?.resolution, x.amount, x.currency, x.unit])
    expect(price('wan3.0-video')).toEqual([
      ['480P', 0.3, 'CNY', 'per_second'],
      ['720P', 0.6, 'CNY', 'per_second'],
      ['1080P', 1.2, 'CNY', 'per_second'],
    ])
    expect(price('wan3.0-video-prime').map((x) => x[1])).toEqual([0.45, 0.9, 1.8])
    for (const m of newProfiles.filter((x) => x.protocol !== 'dashscope-video'))
      expect(m.pricing, m.id).toEqual([])
  })

  it('the old profiles are untouched', () => {
    const old = models.filter((m) => !newProfiles.includes(m))
    expect(old.map((m) => m.id).sort()).toEqual([
      'doubao-seedance-2-0-fast-260128',
      'wan2.2-i2v-flash',
      'wan2.2-i2v-plus',
      'wan2.5-i2v-preview',
      'wan2.7-i2v',
    ])
    expect(old.every((m) => m.capability.firstFrameWithRefs === undefined)).toBe(true)
  })
})
