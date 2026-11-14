import { beforeAll, describe, expect, it } from 'vitest'
import { evaluateTarget } from '../src/admission/index.ts'
import type { AdmissionContext } from '../src/admission/index.ts'
import { loadCatalog } from '../src/data-dir.ts'
import type { ModelRegistry } from '../src/providers/catalog.ts'
import { getMediaProtocol } from '../src/providers/protocols/index.ts'
import { judgeSpeech, speechInputSupportOf } from '../src/providers/speech.ts'
import type { ProviderConfig } from '../src/providers/types.ts'
import { makeWorld } from './helpers.ts'

/**
 * Exec 32: what a speech model takes (style instruction, language hint) and the numbers in the reasons come from the
 * protocols themselves - the same place the request builder reads - not from a second hand-written table.
 */

let models: ModelRegistry
beforeAll(() => {
  models = loadCatalog().models
})

const cfg = (
  protocol: ProviderConfig['protocol'],
  model: string,
  baseUrl: string,
): ProviderConfig => ({
  id: `${protocol}:${model}`,
  label: 'x',
  kind: 'tts',
  protocol,
  baseUrl,
  model,
  enabled: true,
  acceptedUnverified: ['mode:tts'],
})

const CASES: Array<[string, ProviderConfig, ReturnType<typeof speechInputSupportOf>]> = [
  [
    'OpenAI gpt-4o-mini-tts',
    cfg('openai-tts', 'gpt-4o-mini-tts', 'https://api.openai.com/v1'),
    {
      instructions: { supported: true, maxLength: 4096, counting: 'characters' },
      language: { supported: false },
    },
  ],
  [
    'OpenAI snapshot / any case of the name (a model without a profile still answers by its name)',
    cfg('openai-tts', 'GPT-4O-MINI-TTS-2025-12-15', 'https://relay.example.com/v1'),
    {
      instructions: { supported: true, maxLength: 4096, counting: 'characters' },
      language: { supported: false },
    },
  ],
  [
    'OpenAI tts-1',
    cfg('openai-tts', 'tts-1', 'https://api.openai.com/v1'),
    { instructions: { supported: false }, language: { supported: false } },
  ],
  [
    'SiliconFlow CosyVoice2 (openai-tts protocol, but the model does not take instructions)',
    cfg('openai-tts', 'FunAudioLLM/CosyVoice2-0.5B', 'https://api.siliconflow.cn/v1'),
    { instructions: { supported: false }, language: { supported: false } },
  ],
  [
    'a self-entered model name',
    cfg('openai-tts', 'my-own-model', 'https://relay.example.com/v1'),
    { instructions: { supported: false }, language: { supported: false } },
  ],
  [
    'MiniMax',
    cfg('minimax-t2a', 'speech-2.8-hd', 'https://api.minimax.cn/v1'),
    { instructions: { supported: false }, language: { supported: true } },
  ],
  [
    'MiniMax, self-entered model',
    cfg('minimax-t2a', 'my-speech', 'https://relay.example.com/v1'),
    { instructions: { supported: false }, language: { supported: true } },
  ],
  [
    'CosyVoice',
    cfg('dashscope-cosyvoice', 'cosyvoice-v3-flash', 'https://w.cn-beijing.maas.aliyuncs.com'),
    {
      instructions: { supported: true, maxLength: 100, counting: 'cjk_double' },
      language: { supported: true },
    },
  ],
]

describe('speech inputs a model takes - one source, the protocol', () => {
  it.each(CASES)('%s', (_name, config, expected) => {
    expect(speechInputSupportOf(config)).toEqual(expected)
  })

  it('a protocol that is not a speech protocol answers nothing', () => {
    expect(
      speechInputSupportOf(cfg('openai-images' as never, 'm', 'https://x.example.com')),
    ).toBeUndefined()
  })

  it.each(CASES)(
    '%s: what is declared is what is sent, dropped and reported',
    (_name, config, expected) => {
      const protocol = getMediaProtocol(config.protocol)
      const auth = { baseUrl: config.baseUrl, model: config.model, apiKey: 'k' }
      const input = { text: 'x', voice: 'v', instructions: '低沉一点', language: 'zh' }
      const body = JSON.stringify(
        (protocol.buildGenerateRequest(auth, input).body as { value: unknown }).value,
      )
      // instructions: sent exactly when declared supported, reported as dropped exactly when not
      expect(body.includes('低沉一点')).toBe(expected!.instructions.supported)
      const ignored = protocol.ignoredInputs!(auth, input)
      expect(ignored.includes('instructions')).toBe(!expected!.instructions.supported)
      // language: sent (mapped) exactly when declared supported ('zh' is mapped by every protocol that takes it)
      expect(ignored.includes('language')).toBe(!expected!.language.supported)
    },
  )

  it('the limit and the counting method come from the same declaration the check uses', () => {
    const cosy = cfg(
      'dashscope-cosyvoice',
      'cosyvoice-v3-flash',
      'https://w.cn-beijing.maas.aliyuncs.com',
    )
    const sup = speechInputSupportOf(cosy)!.instructions
    const protocol = getMediaProtocol(cosy.protocol)
    const auth = { baseUrl: cosy.baseUrl, model: cosy.model }
    // exactly at the declared limit passes (50 Chinese characters = 100), one more does not
    expect(
      protocol.inputProblem!(auth, { text: 'x', instructions: '字'.repeat(sup.maxLength! / 2) }),
    ).toBeUndefined()
    expect(
      protocol.inputProblem!(auth, {
        text: 'x',
        instructions: '字'.repeat(sup.maxLength! / 2 + 1),
      }),
    ).toMatchObject({ details: { limit: 100, actual: 102, counting: 'cjk_double' } })
    const oa = cfg('openai-tts', 'gpt-4o-mini-tts', 'https://api.openai.com/v1')
    const osup = speechInputSupportOf(oa)!.instructions
    expect(
      getMediaProtocol('openai-tts').inputProblem!(
        { baseUrl: oa.baseUrl, model: oa.model },
        { text: 'x', instructions: '字'.repeat(osup.maxLength! + 1) },
      ),
    ).toMatchObject({ details: { limit: 4096, actual: 4097, counting: 'characters' } })
  })
})

describe('reasons and warnings that carry numbers say them in a structure', () => {
  const nv = (voice: string, extra: object = {}) => ({ providerConfigId: 'x', voice, ...extra })

  it('TEXT_TOO_LONG: limit, actual, counting - as a block on the official address and as a warning elsewhere', () => {
    const official = cfg('openai-tts', 'gpt-4o-mini-tts', 'https://api.openai.com/v1')
    const relay = cfg('openai-tts', 'gpt-4o-mini-tts', 'https://relay.example.com/v1')
    const text = '字'.repeat(5000)
    const a = judgeSpeech(official, models, { text, narrationVoice: nv('alloy') })
    expect(a.problems.find((p) => p.code === 'TEXT_TOO_LONG')?.details).toEqual({
      limit: 4096,
      actual: 5000,
      counting: 'characters',
    })
    const b = judgeSpeech(relay, models, { text, narrationVoice: nv('alloy') })
    expect(b.problems).toEqual([])
    expect(b.warnings.find((p) => p.code === 'TEXT_TOO_LONG')?.details).toEqual({
      limit: 4096,
      actual: 5000,
      counting: 'characters',
    })
  })

  it('INSTRUCTION_TOO_LONG: OpenAI counts characters (4096), CosyVoice counts a Chinese character as 2 (100) - the numbers differ and say so', () => {
    const oa = judgeSpeech(
      cfg('openai-tts', 'gpt-4o-mini-tts', 'https://api.openai.com/v1'),
      models,
      {
        text: 'x',
        narrationVoice: nv('alloy', { instructions: 'a'.repeat(4100) }),
      },
    )
    expect(oa.problems[0]).toMatchObject({
      code: 'INSTRUCTION_TOO_LONG',
      details: { limit: 4096, actual: 4100, counting: 'characters' },
    })
    const cosy = judgeSpeech(
      cfg('dashscope-cosyvoice', 'cosyvoice-v3-flash', 'https://w.cn-beijing.maas.aliyuncs.com'),
      models,
      { text: 'x', narrationVoice: nv('longanyang', { instructions: '字'.repeat(60) }) },
    )
    expect(cosy.problems[0]).toMatchObject({
      code: 'INSTRUCTION_TOO_LONG',
      details: { limit: 100, actual: 120, counting: 'cjk_double' },
    })
  })

  it('end to end through the pre-flight: the details are on the reason', async () => {
    const w = await makeWorld()
    const p = (await w.ports.store.projects.get(w.project.id))!
    await w.ports.store.projects.put({
      ...p,
      narrationVoice: { providerConfigId: 'x', voice: 'alloy', instructions: 'a'.repeat(4097) },
    })
    await w.ports.store.shots.put({ ...w.shot, narration: '字'.repeat(4097) })
    const ctx: AdmissionContext = {
      projection: await w.reload(),
      models,
      jobs: [],
      fileExists: (pid, path) => w.ports.files.exists(pid, path),
    }
    const v = await evaluateTarget(ctx, {
      target: { kind: 'shot_audio', shotId: w.shot.id },
      provider: cfg('openai-tts', 'gpt-4o-mini-tts', 'https://api.openai.com/v1'),
      confirmUnverified: true,
    })
    expect(v.reasons.map((r) => [r.code, r.details])).toEqual([
      ['INSTRUCTION_TOO_LONG', { limit: 4096, actual: 4097, counting: 'characters' }],
      ['TEXT_TOO_LONG', { limit: 4096, actual: 4097, counting: 'characters' }],
    ])
  })
})
