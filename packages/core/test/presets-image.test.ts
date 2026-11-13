import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/data-dir.ts'
import { loginEndpointProblem } from '../src/providers/auth.ts'
import {
  localizeProviderPreset,
  PROVIDER_PRESETS,
  PROVIDER_VENDORS,
} from '../src/providers/presets.ts'
import { getMediaProtocol } from '../src/providers/protocols/index.ts'
import { checkCapability } from '../src/providers/catalog.ts'

const catalog = loadCatalog()
const images = PROVIDER_PRESETS.filter(
  (p) => p.kind === 'image' && p.verification.status === 'documented',
)
const lookup = (p: (typeof images)[number]) =>
  catalog.models.lookup({ protocol: p.protocol, model: p.suggestedModel })

describe('image provider presets (first batch): documented, not tested', () => {
  it('the planned vendors are there, each documented with an official https source, none claiming a test date', () => {
    expect(images.map((p) => p.id).sort()).toEqual([
      'aliyun-qwen-image-cn',
      'aliyun-qwen-image-intl',
      'gemini-image-direct',
      'kling-image',
      'minimax-h3-image',
      'openai-gpt-image',
      'siliconflow-image',
      'volcengine-seedream',
    ])
    for (const p of images) {
      expect(p.verification.status === 'documented' && p.verification.source, p.id).toMatch(
        /^https:\/\//,
      )
      expect(p.verifiedAt, p.id).toBeUndefined()
      expect(p.auth, p.id).toEqual({ type: 'api_key' })
      expect(localizeProviderPreset(p, 'en').notes, p.id).toMatch(/not tested/i)
      expect(localizeProviderPreset(p, 'zh-Hant').notes, p.id).toMatch(/尚未實測/)
      expect(p.knownLimitations.length, p.id).toBeGreaterThan(0)
    }
  })

  it('each has a vendor (grouping) and a region; the protocol is registered; placeholders are declared', () => {
    const vendors = new Set(PROVIDER_VENDORS.map((v) => v.id))
    for (const p of images) {
      expect(vendors.has(p.vendor), p.id).toBe(true)
      expect(p.region, p.id).toMatch(/^(cn|global)$/)
      expect(() => getMediaProtocol(p.protocol), p.id).not.toThrow()
      const placeholders = [...p.baseUrl.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)
      expect(placeholders, p.id).toEqual(p.baseUrlPlaceholders ?? [])
      expect(() => new URL(p.baseUrl.replace(/\{\w+\}/g, 'x')), p.id).not.toThrow()
    }
    expect(PROVIDER_VENDORS.find((v) => v.id === 'kling')).toBeDefined()
  })

  it('every suggested model has a profile; nothing in it is claimed as verified; the reference-image claims match the official pages', () => {
    const claims: Record<string, number> = {
      'openai-gpt-image': 16,
      'minimax-h3-image': 16,
      'volcengine-seedream': 10,
      'aliyun-qwen-image-cn': 3,
      'aliyun-qwen-image-intl': 3,
      'gemini-image-direct': 14,
      'kling-image': 10,
    }
    for (const p of images) {
      const found = lookup(p)
      expect(found.declared, `${p.id}: no profile for ${p.suggestedModel}`).toBe(true)
      const c = found.capability
      expect(c.media).toBe('image')
      expect(c.verifiedAt, p.id).toBeUndefined() // never run end to end
      expect(c.modes.t2i === 'supported' || c.modes.i2i === 'supported', p.id).toBe(false) // unverified, not supported
      // 没有参考图能力的型号（硅基流动的 Qwen-Image 文生图）明确标不支持；其余一律是"未验证"，不是"支持"
      expect(c.refImages.support, p.id).toBe(
        p.id === 'siliconflow-image' ? 'unsupported' : 'unverified',
      )
      if (claims[p.id] !== undefined) expect(c.refImages.value, p.id).toBe(claims[p.id])
      expect(found.profile!.provenance, p.id).toMatch(/2026-11/)
      expect(found.profile!.provenance, p.id).toMatch(/未实测/)
    }
    // the single-reference models say so
    expect(
      catalog.models.lookup({ protocol: 'siliconflow-images', model: 'Qwen/Qwen-Image-Edit' })
        .capability.refImages.value,
    ).toBe(1)
    expect(
      catalog.models.lookup({ protocol: 'kling-image', model: 'kling-v3' }).capability.refImages
        .value,
    ).toBe(1)
  })

  it('references on an unverified model need the user to confirm (never silently spent); an unsupported one is refused', () => {
    const p = images.find((x) => x.id === 'openai-gpt-image')!
    const issues = checkCapability(lookup(p), p.suggestedModel, { mode: 'i2i', referenceImages: 3 })
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((i) => i.level === 'unverified')).toBe(true) // asks, does not block
    const qwen = catalog.models.lookup({ protocol: 'siliconflow-images', model: 'Qwen/Qwen-Image' })
    const refused = checkCapability(qwen, 'Qwen/Qwen-Image', { mode: 'i2i', referenceImages: 1 })
    expect(refused.some((i) => i.level === 'unsupported')).toBe(true)
  })

  it('prices come in the official unit and currency or stay empty (never estimated); the token-priced ones are empty', () => {
    for (const p of images) {
      for (const price of lookup(p).profile!.pricing) {
        expect(price.currency, p.id).toBe('USD')
        expect(price.unit, p.id).toBe('per_image')
        expect(price.note, p.id).toMatch(/官方/)
      }
    }
    for (const id of [
      'openai-gpt-image',
      'minimax-h3-image',
      'volcengine-seedream',
      'aliyun-qwen-image-cn',
      'siliconflow-image',
    ]) {
      const p = images.find((x) => x.id === id)!
      expect(lookup(p).profile!.pricing, id).toEqual([])
    }
  })

  it('the tested 302.AI presets and their profiles are untouched', () => {
    const seed = PROVIDER_PRESETS.find((p) => p.id === '302-image-seedream')!
    expect(seed).toMatchObject({
      protocol: 'openai-images',
      baseUrl: 'https://api.302.ai/doubao',
      verification: { status: 'tested' },
    })
    const profile = catalog.models.lookup({
      protocol: 'openai-images',
      model: 'doubao-seedream-5-0-260128',
    })
    expect(profile.capability.verifiedAt).toBe('2026-05-04')
    expect(profile.capability.refImages.support).toBe('unsupported') // the 302 path: URLs expected
    // the direct route is a separate profile with its own claims
    const direct = catalog.models.lookup({
      protocol: 'volcengine-images',
      model: 'doubao-seedream-5-0-260128',
    })
    expect(direct.declared).toBe(true)
    expect(direct.capability.refImages).toMatchObject({ support: 'unverified', value: 14 })
    expect(loginEndpointProblem).toBeDefined()
  })
})

describe('connection test for the image protocols', () => {
  it('those without a standard, documented list endpoint report "cannot verify" instead of guessing', async () => {
    const { testProvider } = await import('../src/providers/test-connection.ts')
    for (const protocol of [
      'kling-image',
      'dashscope-image',
      'volcengine-images',
      'siliconflow-images',
    ] as const) {
      const r = await testProvider({ baseUrl: 'https://x.example', protocol, model: 'm' }, 'k', {
        fetch: (async () => {
          throw new Error('must not be called')
        }) as never,
      })
      expect(r.outcome, protocol).toBe('unverifiable')
    }
  })
})
