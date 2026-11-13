import { describe, expect, it } from 'vitest'
import { loginEndpointProblem } from '../src/providers/auth.ts'
import {
  configFromPreset,
  localizeProviderPreset,
  localizeVendor,
  PROVIDER_PRESETS,
  PROVIDER_VENDORS,
} from '../src/providers/presets.ts'

const documented = PROVIDER_PRESETS.filter(
  (p) => p.verification.status === 'documented' && p.kind === 'llm',
)

describe('text provider presets (first batch): documented, not tested', () => {
  it('every new text preset is "documented" with an official https source, and none claims a test date', () => {
    expect(documented.length).toBeGreaterThanOrEqual(15)
    expect(
      PROVIDER_PRESETS.filter((p) => p.verification.status === 'documented').length,
    ).toBeGreaterThanOrEqual(23)
    for (const p of documented) {
      expect(p.verification.status === 'documented' && p.verification.source, p.id).toMatch(
        /^https:\/\//,
      )
      expect(p.verifiedAt, p.id).toBeUndefined()
      expect(p.notes, p.id).toMatch(/未实测/)
      expect(localizeProviderPreset(p, 'en').notes, p.id).toMatch(/not tested/i)
      expect(localizeProviderPreset(p, 'zh-Hant').notes, p.id).toMatch(/尚未實測/)
    }
  })

  it('the vendors named in the request are all there', () => {
    const ids = new Set(PROVIDER_PRESETS.map((p) => p.id))
    for (const id of [
      'deepseek-llm',
      'aliyun-bailian-cn',
      'aliyun-bailian-intl',
      'volcengine-ark',
      'zhipu-glm',
      'moonshot-kimi',
      'minimax-m',
      'siliconflow',
      'openrouter',
      'openrouter-login',
      '302ai-chat',
      'ollama-local',
      'lmstudio-local',
      'openai-responses-key',
      'openai-responses-login',
      'anthropic-messages',
      'gemini-generate-content',
    ]) {
      expect(ids.has(id), id).toBe(true)
    }
    expect(new Set(PROVIDER_PRESETS.map((p) => p.id)).size).toBe(PROVIDER_PRESETS.length)
  })

  it('every preset has a known vendor (for grouping), localized vendor names, and a region', () => {
    const known = new Set(PROVIDER_VENDORS.map((v) => v.id))
    for (const p of PROVIDER_PRESETS) {
      expect(known.has(p.vendor), `${p.id}: vendor ${p.vendor}`).toBe(true)
      expect(p.region, p.id).toMatch(/^(cn|global|local)$/)
    }
    expect(localizeVendor('aliyun', 'zh').label).toBe('阿里云百炼')
    expect(localizeVendor('aliyun', 'zh-Hant').label).toBe('阿里雲百煉')
    expect(localizeVendor('aliyun', 'en').label).toBe('Alibaba Cloud Model Studio')
    expect(localizeVendor('openai', 'en').label).toBe('OpenAI')
    expect(localizeVendor('nope', 'en')).toEqual({ id: 'nope', label: 'nope' })
  })

  it('only local models are "no authentication"; login presets are pinned to their official endpoint', () => {
    for (const p of documented) {
      if (p.auth.type === 'none') expect(p.region, p.id).toBe('local')
      if (p.region === 'local') expect(p.auth.type, p.id).toBe('none')
      if (p.auth.type === 'account_login') {
        expect(loginEndpointProblem(p.auth.channel, p), p.id).toBeUndefined()
      }
    }
  })

  it('addresses are well-formed; {placeholders} are declared; models are set (LM Studio: the user picks)', () => {
    for (const p of documented) {
      const placeholders = [...p.baseUrl.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)
      expect(placeholders, p.id).toEqual(p.baseUrlPlaceholders ?? [])
      expect(() => new URL(p.baseUrl.replace(/\{\w+\}/g, 'x')), p.id).not.toThrow()
      if (p.id !== 'lmstudio-local') expect(p.suggestedModel.length, p.id).toBeGreaterThan(0)
      expect(p.knownLimitations.length, p.id).toBeGreaterThan(0)
      expect(p.protocol, p.id).toMatch(
        /^(openai-chat|openai-responses|anthropic-messages|gemini-chat)$/,
      )
    }
  })

  it('thinking is switched off in the preset where the model thinks by default and the docs allow it', () => {
    const by = Object.fromEntries(PROVIDER_PRESETS.map((p) => [p.id, p]))
    expect(by['aliyun-bailian-cn']!.dialect).toEqual({
      maxTokensField: 'max_completion_tokens',
      extraBody: { enable_thinking: false },
    })
    expect(by['volcengine-ark']!.dialect!.extraBody).toEqual({ thinking: { type: 'disabled' } })
    expect(by['siliconflow']!.dialect!.extraBody).toEqual({ enable_thinking: false })
    expect(by['minimax-m']!.dialect!.extraBody).toEqual({ thinking: { type: 'disabled' } }) // an object, not a string (checked against the official page)
    expect(by['moonshot-kimi']!.dialect!.extraBody).toEqual({ reasoning_effort: 'low' }) // K3 cannot be turned off
    expect(by['moonshot-kimi']!.dialect!.maxTokensField).toBe('max_completion_tokens')
    expect(by['lmstudio-local']!.dialect!.jsonMode).toBe('prompt_only')
    // and each says so in its limitations
    expect(by['zhipu-glm']!.knownLimitations.join('')).toContain('不能关闭')
  })

  it('the four tested presets are untouched: no dialect, same auth, same dates', () => {
    for (const id of [
      'deepseek-llm',
      '302-image-seedream',
      '302-image-nano-banana',
      '302-i2v-wan-flash',
    ]) {
      const p = PROVIDER_PRESETS.find((x) => x.id === id)!
      expect(p.dialect, id).toBeUndefined()
      expect(p.verification).toEqual({ status: 'tested', testedAt: '2026-05-04' })
    }
    expect(PROVIDER_PRESETS.find((x) => x.id === 'deepseek-llm')).toMatchObject({
      baseUrl: 'https://api.deepseek.com',
      suggestedModel: 'deepseek-chat',
    })
  })

  it('a config made from a preset carries its own copy of the dialect (editing it does not change the preset)', () => {
    const preset = PROVIDER_PRESETS.find((p) => p.id === 'aliyun-bailian-cn')!
    const cfg = configFromPreset(preset, { id: 'c1' })
    expect(cfg.dialect).toEqual(preset.dialect)
    ;(cfg.dialect!.extraBody as Record<string, unknown>).enable_thinking = true
    expect((preset.dialect!.extraBody as Record<string, unknown>).enable_thinking).toBe(false)
    expect(
      configFromPreset(PROVIDER_PRESETS.find((p) => p.id === 'ollama-local')!, { id: 'c2' }),
    ).toMatchObject({ auth: { type: 'none' } })
  })
})
