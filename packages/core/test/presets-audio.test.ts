import { describe, expect, it } from 'vitest'
import { estimateCost } from '../src/providers/catalog.ts'
import { loadCatalog } from '../src/data-dir.ts'
import { checkBaseUrl } from '../src/providers/base-url.ts'
import {
  configFromPreset,
  localizeProviderPreset,
  PROVIDER_PRESETS,
  PROVIDER_VENDORS,
  providerRegionOf,
} from '../src/providers/presets.ts'
import { getMediaProtocol } from '../src/providers/protocols/index.ts'
import { testProvider } from '../src/providers/test-connection.ts'

const catalog = loadCatalog()
const ttsPresets = PROVIDER_PRESETS.filter((p) => p.kind === 'tts')
const audioModels = catalog.models.all().filter((m) => m.capability.media === 'audio')

describe('speech presets (P3d first batch): documented, not tested', () => {
  it('the seven presets', () => {
    expect(ttsPresets.map((p) => p.id).sort()).toEqual([
      'aliyun-cosyvoice-cn',
      'minimax-tts-cn',
      'minimax-tts-global',
      'openai-tts-key',
      'siliconflow-tts-cn',
      'siliconflow-tts-global',
    ])
  })

  it.each(ttsPresets.map((p) => [p.id, p] as const))('%s', (_id, p) => {
    expect(p.verification).toMatchObject({ status: 'documented' })
    expect(p.verifiedAt).toBeUndefined() // nothing claims a test date
    expect((p.verification as { source: string }).source).toMatch(/^https:\/\//)
    expect(p.auth).toEqual({ type: 'api_key' })
    expect(['cn', 'global']).toContain(p.region)
    expect(PROVIDER_VENDORS.some((v) => v.id === p.vendor)).toBe(true)
    expect(p.notes).toContain('按官方文档接入，未实测')
    expect(p.knownLimitations.length).toBeGreaterThanOrEqual(2)
    for (const lang of ['en', 'zh-Hant'] as const) {
      const t = localizeProviderPreset(p, lang)
      expect(t.knownLimitations, lang).toHaveLength(p.knownLimitations.length)
      expect(t.label, lang).not.toBe(p.label)
      expect(t.notes, lang).not.toBe(p.notes)
    }
    expect(() => getMediaProtocol(p.protocol)).not.toThrow()
    expect(getMediaProtocol(p.protocol).media).toBe('audio')
    // the suggested model has a profile, with a voice list and a default voice that is in it
    const lookup = catalog.models.lookup({ protocol: p.protocol, model: p.suggestedModel })
    expect(lookup.declared, p.suggestedModel).toBe(true)
    const voices = lookup.capability.voices?.value ?? []
    expect(voices.length).toBeGreaterThan(0)
    expect(voices.map((v) => v.id)).toContain(lookup.capability.defaultVoice)
    // the address is complete unless it names its placeholder
    const filled = p.baseUrl.replace(/\{(\w+)\}/g, 'ws1')
    expect(checkBaseUrl(filled).ok, filled).toBe(true)
    expect(checkBaseUrl(p.baseUrl).ok).toBe(!p.baseUrlPlaceholders)
    expect(configFromPreset(p, { id: 'x' })).toMatchObject({
      kind: 'tts',
      protocol: p.protocol,
      model: p.suggestedModel,
    })
    // never a current choice on its own: creating a config from a preset does not set any default
    expect(configFromPreset(p, { id: 'x' }).acceptedUnverified).toBeUndefined()
  })

  it('every new profile is documented, not run: no verifiedAt, tts mode unverified, nothing marked supported', () => {
    const fresh = audioModels
    expect(fresh.length).toBe(14)
    for (const m of fresh) {
      expect(m.capability.verifiedAt, m.id).toBeUndefined()
      expect(m.capability.modes.tts, m.id).toBe('unverified')
      expect(m.provenance, m.id).toMatch(/未实测/)
      expect(m.capability.nativeAudio, m.id).toBe('unsupported')
    }
  })

  it('tts-1 and tts-1-hd have no profile on purpose: an existing config using them behaves exactly as before', () => {
    for (const model of ['tts-1', 'tts-1-hd']) {
      const l = catalog.models.lookup({ protocol: 'openai-tts', model })
      expect(l.declared).toBe(false)
      expect(l.capability.modes.tts).toBe('supported')
      expect(l.capability.voices).toBeUndefined()
      expect(l.capability.maxPromptChars).toBeUndefined()
    }
  })

  it('text limits come from the official pages; CosyVoice has none because the page states none', () => {
    const limit = (protocol: 'openai-tts' | 'minimax-t2a' | 'dashscope-cosyvoice', model: string) =>
      catalog.models.lookup({ protocol, model }).capability.maxPromptChars
    expect(limit('openai-tts', 'gpt-4o-mini-tts')).toBe(4096)
    expect(limit('minimax-t2a', 'speech-2.8-hd')).toBe(9999)
    expect(limit('openai-tts', 'FunAudioLLM/CosyVoice2-0.5B')).toBe(128000)
    expect(limit('dashscope-cosyvoice', 'cosyvoice-v3-flash')).toBeUndefined()
  })

  it('the MiniMax limit 9999 says in every language that how it is counted is not verified (billing counts a Chinese character as 2)', () => {
    for (const m of audioModels.filter((x) => x.protocol === 'minimax-t2a'))
      expect(m.quirks.join(' '), m.id).toMatch(/没有写这个上限按什么计数/)
    for (const id of ['minimax-tts-cn']) {
      const p = PROVIDER_PRESETS.find((x) => x.id === id)!
      expect(p.knownLimitations.join(' ')).toContain('官方没有写这个上限按什么计数')
      expect(localizeProviderPreset(p, 'zh-Hant').knownLimitations.join(' ')).toContain(
        '官方沒有寫這個上限按什麼計數',
      )
      expect(localizeProviderPreset(p, 'en').knownLimitations.join(' ')).toContain(
        'do not say how this limit is counted',
      )
    }
  })

  it('voice lists: OpenAI is a closed list of 13; the others are open; v3.5 has no system voices', () => {
    const v = (protocol: 'openai-tts' | 'minimax-t2a' | 'dashscope-cosyvoice', model: string) =>
      catalog.models.lookup({ protocol, model }).capability
    expect(v('openai-tts', 'gpt-4o-mini-tts').voices).toMatchObject({ support: 'supported' })
    expect(v('openai-tts', 'gpt-4o-mini-tts').voices!.value).toHaveLength(13)
    expect(v('minimax-t2a', 'speech-2.8-hd').voices).toMatchObject({ support: 'unverified' })
    expect(v('dashscope-cosyvoice', 'cosyvoice-v3-flash').voices).toMatchObject({
      support: 'unverified',
    })
    expect(v('dashscope-cosyvoice', 'cosyvoice-v3.5-plus').voices).toMatchObject({
      support: 'unsupported',
      value: [],
    })
    expect(v('dashscope-cosyvoice', 'cosyvoice-v3.5-plus').defaultVoice).toBeUndefined()
    expect(v('dashscope-cosyvoice', 'cosyvoice-v2').defaultVoice).toBeUndefined()
    // the SiliconFlow voices carry the model prefix the API wants
    const sf = v('openai-tts', 'FunAudioLLM/CosyVoice2-0.5B')
    expect(sf.defaultVoice).toBe('FunAudioLLM/CosyVoice2-0.5B:alex')
    expect(sf.voices!.value!.every((x) => x.id.startsWith('FunAudioLLM/CosyVoice2-0.5B:'))).toBe(
      true,
    )
  })
})

describe('speech prices: the official unit and currency, per site', () => {
  const price = (model: string, region: 'cn' | 'global' | undefined, chars = 1000) =>
    estimateCost(catalog.models.lookup({ protocol: 'minimax-t2a', model }).profile, {
      chars,
      region,
    })

  it('MiniMax international: USD per 1k characters', () => {
    expect(price('speech-2.8-hd', 'global')).toMatchObject({
      priced: true,
      currency: 'USD',
      amount: 0.1,
    })
    expect(price('speech-2.8-turbo', 'global')).toMatchObject({ currency: 'USD', amount: 0.06 })
  })

  it('MiniMax China: CNY, a range because one Chinese character counts as 2', () => {
    const hd = price('speech-2.8-hd', 'cn')
    expect(hd).toMatchObject({ priced: true, currency: 'CNY', amount: 0.35, approx: true })
    expect(hd).toMatchObject({ range: [0.35, 0.7] })
    expect(price('speech-2.8-turbo', 'cn')).toMatchObject({ amount: 0.2, range: [0.2, 0.4] })
  })

  it('a site that cannot be told gets no price instead of the wrong one', () => {
    expect(price('speech-2.8-hd', undefined)).toMatchObject({ priced: false })
  })

  it('CosyVoice v3-flash: Beijing only, 1 CNY per 10k characters; other models are left unpriced', () => {
    const q = (model: string, region: 'cn' | 'global' | undefined) =>
      estimateCost(catalog.models.lookup({ protocol: 'dashscope-cosyvoice', model }).profile, {
        chars: 10000,
        region,
      })
    expect(q('cosyvoice-v3-flash', 'cn')).toMatchObject({
      priced: true,
      currency: 'CNY',
      amount: 1,
    })
    expect(q('cosyvoice-v3-flash', 'global')).toMatchObject({ priced: false })
    expect(q('cosyvoice-v3-plus', 'cn')).toMatchObject({ priced: false })
  })

  it('OpenAI gpt-4o-mini-tts (per token) and SiliconFlow (per byte, no list price) are not estimated', () => {
    for (const [protocol, model] of [
      ['openai-tts', 'gpt-4o-mini-tts'],
      ['openai-tts', 'FunAudioLLM/CosyVoice2-0.5B'],
    ] as const) {
      expect(
        estimateCost(catalog.models.lookup({ protocol, model }).profile, { chars: 1000 }),
      ).toMatchObject({ priced: false })
    }
  })
})

describe('sites of self-entered addresses (only addresses read from the official pages)', () => {
  const region = (baseUrl: string) => providerRegionOf({ baseUrl })
  it('the four new hosts', () => {
    expect(region('https://api.minimax.cn/v1')).toBe('cn')
    expect(region('https://api.minimax.io/v1')).toBe('global')
    expect(region('https://api.siliconflow.cn/v1')).toBe('cn')
    expect(region('https://api.siliconflow.com/v1')).toBe('global')
  })
  it('lookalikes and unchecked hosts are not guessed', () => {
    for (const u of [
      'https://api.minimaxi.com/v1',
      'https://api-bj.minimaxi.com/v1',
      'https://api.minimax.cn.evil.example/v1',
      'https://evil-api.minimax.io/v1',
      'https://api.siliconflow.cn.example.com/v1',
      'https://gw.example.com/siliconflow/v1',
    ])
      expect(region(u), u).toBeUndefined()
  })
})

describe('connection test: no cheap read-only probe for the new protocols', () => {
  it.each(['minimax-t2a', 'dashscope-cosyvoice'] as const)(
    '%s is unverifiable, and sends nothing',
    async (protocol) => {
      let called = 0
      const r = await testProvider(
        { baseUrl: 'https://x.example.com', protocol, model: 'm' },
        'sk-secret',
        {
          fetch: async () => {
            called++
            return new Response('{}')
          },
        },
      )
      expect(r.outcome).toBe('unverifiable')
      expect(called).toBe(0)
    },
  )
})
