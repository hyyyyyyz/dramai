import { beforeAll, describe, expect, it } from 'vitest'
import { evaluateTarget } from '../src/admission/index.ts'
import type { AdmissionContext } from '../src/admission/index.ts'
import { loadCatalog } from '../src/data-dir.ts'
import type { NarrationVoice } from '../src/domain/index.ts'
import type { ModelRegistry } from '../src/providers/catalog.ts'
import type { ProviderConfig } from '../src/providers/types.ts'
import { isOfficialSpeechAddress } from '../src/providers/official-hosts.ts'
import { getMediaProtocol } from '../src/providers/protocols/index.ts'
import { judgeSpeech } from '../src/providers/speech.ts'
import { makeWorld } from './helpers.ts'
import type { World } from './helpers.ts'

/**
 * P3d: the voice and the text length are judged at admission - before any money is spent - for every speech provider,
 * with stable reason codes. Switching provider and keeping an old voice name is stopped, not sent.
 */

let models: ModelRegistry
beforeAll(() => {
  models = loadCatalog().models
})

/** Is there a model profile for this configuration? (a capability override alone does not count) */
const lookupDeclared = (p: ProviderConfig) => models.lookup(p).profile !== undefined

const tts = (
  id: string,
  protocol: ProviderConfig['protocol'],
  model: string,
  baseUrl = 'https://x.example.com/v1',
  over: Partial<ProviderConfig> = {},
): ProviderConfig => ({
  id,
  label: id,
  kind: 'tts',
  protocol,
  baseUrl,
  model,
  enabled: true,
  acceptedUnverified: ['mode:tts'],
  ...over,
})
const OPENAI = tts('openai', 'openai-tts', 'gpt-4o-mini-tts', 'https://api.openai.com/v1')
const OPENAI_OLD = tts('openai-old', 'openai-tts', 'tts-1', 'https://api.openai.com/v1')
const MINIMAX = tts('minimax', 'minimax-t2a', 'speech-2.8-hd', 'https://api.minimax.cn/v1')
const COSY = tts(
  'cosy',
  'dashscope-cosyvoice',
  'cosyvoice-v3-flash',
  'https://w.cn-beijing.maas.aliyuncs.com',
)
const COSY_V35 = { ...COSY, id: 'cosy35', model: 'cosyvoice-v3.5-plus' }
const COSY_V2 = { ...COSY, id: 'cosy2', model: 'cosyvoice-v2' }
const SF_MODEL = 'FunAudioLLM/CosyVoice2-0.5B'
const SF = tts('sf', 'openai-tts', SF_MODEL, 'https://api.siliconflow.cn/v1')
const GATEWAY = tts('gw', 'openai-tts', 'some-gateway-model', 'https://gateway.example.com/v1')

async function verdict(
  w: World,
  provider: ProviderConfig,
  over: { voice?: NarrationVoice | null; narration?: string } = {},
) {
  const project = (await w.ports.store.projects.get(w.project.id))!
  const next = { ...project }
  if (over.voice === null) delete next.narrationVoice
  else if (over.voice) next.narrationVoice = over.voice
  await w.ports.store.projects.put(next)
  if (over.narration !== undefined)
    await w.ports.store.shots.put({ ...w.shot, narration: over.narration })
  const ctx: AdmissionContext = {
    projection: await w.reload(),
    models,
    jobs: [],
    fileExists: (pid, path) => w.ports.files.exists(pid, path),
  }
  return evaluateTarget(ctx, {
    target: { kind: 'shot_audio', shotId: w.shot.id },
    provider,
    confirmUnverified: true,
  })
}
const nv = (
  providerConfigId: string,
  voice: string,
  extra: Partial<NarrationVoice> = {},
): NarrationVoice => ({
  providerConfigId,
  voice,
  ...extra,
})
const codes = (v: { reasons: Array<{ code: string }> }) => v.reasons.map((r) => r.code)
// the confirmed-unverified notice is not what these tests are about
const wcodes = (v: { warnings: Array<{ code: string }> }) =>
  v.warnings.map((r) => r.code).filter((c) => c !== 'CAPABILITY_UNVERIFIED')

describe('a voice that does not exist on this provider is stopped at admission', () => {
  it('OpenAI is a closed list: a made-up name is stopped, a listed one passes', async () => {
    const w = await makeWorld()
    const bad = await verdict(w, OPENAI, { voice: nv('openai', 'zhangsan') })
    expect(bad.status).toBe('blocked')
    expect(codes(bad)).toEqual(['VOICE_NOT_AVAILABLE'])
    expect(bad.reasons[0]!.message).toContain('alloy') // says what can be chosen
    for (const ok of ['alloy', 'marin', 'cedar']) {
      const v = await verdict(w, OPENAI, { voice: nv('openai', ok) })
      expect(v.status, ok).toBe('accepted')
      expect(v.reasons).toEqual([])
    }
  })

  it('switching provider and keeping the old voice: alloy on MiniMax / CosyVoice, a MiniMax voice on OpenAI', async () => {
    const w = await makeWorld()
    for (const p of [MINIMAX, COSY]) {
      const v = await verdict(w, p, { voice: nv('openai', 'alloy') })
      expect(v.status, p.id).toBe('blocked')
      expect(codes(v), p.id).toEqual(['VOICE_FROM_ANOTHER_SERVICE'])
      expect(v.reasons[0]!.message).toContain('重新选择旁白音色')
    }
    const back = await verdict(w, OPENAI, {
      voice: nv('minimax', 'Chinese (Mandarin)_News_Anchor'),
    })
    expect(codes(back)).toEqual(['VOICE_NOT_AVAILABLE'])
    // and a CosyVoice voice on MiniMax
    expect(codes(await verdict(w, MINIMAX, { voice: nv('cosy', 'longanyang') }))).toEqual([
      'VOICE_FROM_ANOTHER_SERVICE',
    ])
  })

  it('SiliconFlow: the voice must be "model:name" (or a speech: address); an OpenAI voice name is stopped', async () => {
    const w = await makeWorld()
    const bad = await verdict(w, SF, { voice: nv('sf', 'alloy') })
    expect(codes(bad)).toEqual(['VOICE_FORMAT_INVALID'])
    expect(bad.reasons[0]!.message).toContain(`${SF_MODEL}:alex`)
    for (const ok of [`${SF_MODEL}:alex`, `${SF_MODEL}:anna`, 'speech:mine:abc:def']) {
      const v = await verdict(w, SF, { voice: nv('sf', ok) })
      expect(v.reasons, ok).toEqual([])
    }
    // a listed-looking but made-up name with the right shape is allowed with a warning (it may be the user's own)
    const own = await verdict(w, SF, { voice: nv('sf', `${SF_MODEL}:zed`) })
    expect(own.status).toBe('accepted')
    expect(wcodes(own)).toContain('VOICE_UNLISTED')
  })

  it('an open list does not stop other names, it warns once; listed names have no warning', async () => {
    const w = await makeWorld()
    const mine = await verdict(w, MINIMAX, { voice: nv('minimax', 'my_cloned_voice_01') })
    expect(mine.status).toBe('accepted')
    expect(wcodes(mine)).toEqual(['VOICE_UNLISTED'])
    const listed = await verdict(w, MINIMAX, {
      voice: nv('minimax', 'Chinese (Mandarin)_News_Anchor'),
    })
    expect(listed.status).toBe('accepted')
    expect(wcodes(listed)).toEqual([])
    const cosyOwn = await verdict(w, COSY, { voice: nv('cosy', 'my_clone_voice') })
    expect(cosyOwn.status).toBe('accepted')
    expect(wcodes(cosyOwn)).toEqual(['VOICE_UNLISTED'])
  })

  it('an address nobody has a profile for (a gateway) is never second-guessed: any voice name passes, as before', async () => {
    const w = await makeWorld()
    for (const voice of ['alloy', 'Chinese (Mandarin)_News_Anchor', 'whatever']) {
      const v = await verdict(w, GATEWAY, { voice: nv('gw', voice) })
      expect(v.status, voice).toBe('accepted')
      expect(v.reasons).toEqual([])
      expect(wcodes(v)).toEqual([])
    }
  })

  it('the user can widen a closed list with a capability override', async () => {
    const w = await makeWorld()
    const custom = {
      ...OPENAI,
      capabilityOverrides: { voices: { support: 'unverified' as const } },
    }
    const v = await verdict(w, custom, { voice: nv('openai', 'custom_voice_1') })
    expect(v.reasons).toEqual([])
  })
})

describe('no narration voice set in the project', () => {
  it('providers with a default voice: a warning, as for openai-tts today', async () => {
    const w = await makeWorld()
    for (const p of [OPENAI, OPENAI_OLD, MINIMAX, COSY, SF, GATEWAY]) {
      const v = await verdict(w, p, { voice: null })
      expect(v.status, p.id).toBe('accepted')
      expect(wcodes(v), p.id).toEqual(['NARRATION_VOICE_DEFAULTED'])
    }
  })

  it('models with no default voice cannot guess one: stopped with NARRATION_VOICE_REQUIRED', async () => {
    const w = await makeWorld()
    for (const p of [COSY_V35, COSY_V2]) {
      const v = await verdict(w, p, { voice: null })
      expect(v.status, p.id).toBe('blocked')
      expect(codes(v), p.id).toEqual(['NARRATION_VOICE_REQUIRED'])
      expect(wcodes(v), p.id).toEqual([]) // no "will use the default" when there is none
    }
  })
})

describe('text longer than the single-request limit is stopped before generation', () => {
  const text = (n: number) => '字'.repeat(n)

  it('OpenAI 4096 / MiniMax 9999 / SiliconFlow 128000 - at the limit passes, one over is stopped', async () => {
    const w = await makeWorld()
    const cases: Array<[ProviderConfig, string, number]> = [
      [OPENAI, 'alloy', 4096],
      [MINIMAX, 'Chinese (Mandarin)_News_Anchor', 9999],
      [SF, `${SF_MODEL}:alex`, 128000],
    ]
    for (const [p, voice, limit] of cases) {
      const atLimit = await verdict(w, p, { voice: nv(p.id, voice), narration: text(limit) })
      expect(atLimit.reasons, `${p.id} at ${limit}`).toEqual([])
      const over = await verdict(w, p, { voice: nv(p.id, voice), narration: text(limit + 1) })
      expect(over.status, p.id).toBe('blocked')
      expect(codes(over), p.id).toEqual(['TEXT_TOO_LONG'])
      expect(over.reasons[0]!.message).toContain(String(limit + 1))
      expect(over.reasons[0]!.message).toContain(String(limit))
    }
  })

  it('CosyVoice: the official page states no limit, so none is invented', async () => {
    const w = await makeWorld()
    const v = await verdict(w, COSY, { voice: nv('cosy', 'longanyang'), narration: text(50000) })
    expect(v.reasons).toEqual([])
  })

  it('the old tts-1 configs (no profile) are unchanged: no limit is applied to them', async () => {
    const w = await makeWorld()
    const v = await verdict(w, OPENAI_OLD, { voice: nv('openai', 'alloy'), narration: text(9000) })
    expect(v.reasons).toEqual([])
  })

  it('both problems are reported together, voice first', async () => {
    const w = await makeWorld()
    const v = await verdict(w, OPENAI, { voice: nv('openai', 'zhangsan'), narration: text(5000) })
    expect(codes(v)).toEqual(['VOICE_NOT_AVAILABLE', 'TEXT_TOO_LONG'])
  })
})

describe('the instruction of CosyVoice (100 characters, a Chinese character counts 2)', () => {
  it('50 Chinese characters pass, 51 are stopped before any request', async () => {
    const w = await makeWorld()
    const ok = await verdict(w, COSY, {
      voice: nv('cosy', 'longanyang', { instructions: '字'.repeat(50) }),
    })
    expect(ok.reasons).toEqual([])
    const bad = await verdict(w, COSY, {
      voice: nv('cosy', 'longanyang', { instructions: '字'.repeat(51) }),
    })
    expect(codes(bad)).toEqual(['INSTRUCTION_TOO_LONG'])
  })
})

describe('judgeSpeech is the one judgement (the job calls it too)', () => {
  it('same answers as admission, no side effects', () => {
    const a = judgeSpeech(MINIMAX, models, { text: 'x', narrationVoice: nv('openai', 'alloy') })
    expect(a.problems.map((p) => p.code)).toEqual(['VOICE_FROM_ANOTHER_SERVICE'])
    expect(a.voice).toBe('alloy')
    const d = judgeSpeech(MINIMAX, models, { text: 'x' })
    expect(d).toMatchObject({
      voice: 'Chinese (Mandarin)_News_Anchor',
      defaulted: true,
      problems: [],
    })
    const none = judgeSpeech(COSY_V35, models, { text: 'x' })
    expect(none.voice).toBeUndefined()
    expect(none.problems.map((p) => p.code)).toEqual(['NARRATION_VOICE_REQUIRED'])
  })
})

describe('exec 31: blocking is only for rules with an official basis that will certainly fail; the rest only warns', () => {
  const OFFICIAL_OPENAI = OPENAI
  const RELAY_OPENAI = tts('relay', 'openai-tts', 'gpt-4o-mini-tts', 'https://relay.example.com/v1')
  const RELAY_SF = tts('relay-sf', 'openai-tts', SF_MODEL, 'https://relay.example.com/v1')
  const SF_UNDECLARED = tts(
    'sf-own',
    'openai-tts',
    'fishaudio/fish-speech-1.5',
    'https://api.siliconflow.cn/v1',
  )

  it('blank voice (empty or only spaces) means "not chosen" for MiniMax and CosyVoice - the same answer admission and the job give', async () => {
    const w = await makeWorld()
    for (const blank of ['', '   ', '\t']) {
      for (const p of [MINIMAX, COSY]) {
        const v = await verdict(w, p, { voice: nv(p.id, blank) })
        expect(v.status, `${p.id} "${blank}"`).toBe('accepted')
        expect(wcodes(v)).toEqual(['NARRATION_VOICE_DEFAULTED'])
        const j = judgeSpeech(p, models, { text: 'x', narrationVoice: nv(p.id, blank) })
        expect(j).toMatchObject({ defaulted: true, problems: [] })
        expect(j.voice).toBe(p.id === 'minimax' ? 'Chinese (Mandarin)_News_Anchor' : 'longanyang')
      }
      for (const p of [COSY_V35, COSY_V2]) {
        const v = await verdict(w, p, { voice: nv(p.id, blank) })
        expect(codes(v), p.id).toEqual(['NARRATION_VOICE_REQUIRED'])
      }
    }
  })

  it('openai-tts keeps an empty voice as it was (a valid way to say "reference audio" on SiliconFlow)', async () => {
    const w = await makeWorld()
    const v = await verdict(w, SF, { voice: nv('sf', '') })
    expect(v.reasons).toEqual([])
    expect(judgeSpeech(SF, models, { text: 'x', narrationVoice: nv('sf', '') }).voice).toBe('')
  })

  it('OpenAI instruction longer than 4096 characters: stopped on the official address, a warning elsewhere', async () => {
    const w = await makeWorld()
    const long = (n: number) => 'a'.repeat(n)
    expect(
      (
        await verdict(w, OFFICIAL_OPENAI, {
          voice: nv('openai', 'alloy', { instructions: long(4096) }),
        })
      ).reasons,
    ).toEqual([])
    const bad = await verdict(w, OFFICIAL_OPENAI, {
      voice: nv('openai', 'alloy', { instructions: long(4097) }),
    })
    expect(codes(bad)).toEqual(['INSTRUCTION_TOO_LONG'])
    const relay = await verdict(w, RELAY_OPENAI, {
      voice: nv('relay', 'alloy', { instructions: long(4097) }),
    })
    expect(relay.reasons).toEqual([])
    expect(wcodes(relay)).toEqual(['INSTRUCTION_TOO_LONG'])
  })

  it('OpenAI speed outside 0.25-4 is clamped and reported on the official addresses; elsewhere it is sent as given (unchanged)', () => {
    const body = (baseUrl: string, speed: number) =>
      (
        getMediaProtocol('openai-tts').buildGenerateRequest(
          { baseUrl, model: 'gpt-4o-mini-tts' },
          { text: 'x', speed },
        ).body as { value: { speed: number } }
      ).value.speed
    for (const [asked, sent] of [
      [9, 4],
      [0.1, 0.25],
      [1, 1],
      [4, 4],
    ] as const)
      expect(body('https://api.openai.com/v1', asked)).toBe(sent)
    expect(body('https://api.siliconflow.cn/v1', 9)).toBe(4)
    expect(body('https://relay.example.com/v1', 9)).toBe(9)
    const ign = (baseUrl: string, speed: number) =>
      getMediaProtocol('openai-tts').ignoredInputs!(
        { baseUrl, model: 'gpt-4o-mini-tts' },
        { text: 'x', speed },
      )
    expect(ign('https://api.openai.com/v1', 9)).toEqual(['speed'])
    expect(ign('https://api.openai.com/v1', 1)).toEqual([])
    expect(ign('https://relay.example.com/v1', 9)).toEqual([])
  })

  it('gpt-4o-mini-tts through a relay: a voice outside the official 13 and a long text only warn', async () => {
    const w = await makeWorld()
    const v = await verdict(w, RELAY_OPENAI, {
      voice: nv('relay', 'my-relay-voice'),
      narration: '字'.repeat(5000),
    })
    expect(v.status).toBe('accepted')
    expect(v.reasons).toEqual([])
    expect(wcodes(v)).toEqual(['VOICE_NOT_AVAILABLE', 'TEXT_TOO_LONG'])
    // on the official address the same input is stopped
    const official = await verdict(w, OFFICIAL_OPENAI, {
      voice: nv('openai', 'my-relay-voice'),
      narration: '字'.repeat(5000),
    })
    expect(codes(official)).toEqual(['VOICE_NOT_AVAILABLE', 'TEXT_TOO_LONG'])
  })

  it('a self-entered model with a capability override is never stopped by "voice belongs to another service"', async () => {
    const w = await makeWorld()
    const own = tts('own', 'openai-tts', 'acme-voice', 'https://api.openai.com/v1', {
      capabilityOverrides: { maxPromptChars: 100 },
    })
    for (const voice of ['Chinese (Mandarin)_News_Anchor', 'longanyang', 'alloy']) {
      const v = await verdict(w, own, { voice: nv('own', voice), narration: '字'.repeat(500) })
      expect(v.reasons, voice).toEqual([])
    }
  })

  it('SiliconFlow spelling: an inferred rule - blocking for models that have a profile on the official address, a warning for models that do not', async () => {
    const w = await makeWorld()
    const declared = await verdict(w, SF, { voice: nv('sf', 'alloy') })
    expect(codes(declared)).toEqual(['VOICE_FORMAT_INVALID'])
    const undeclared = await verdict(w, SF_UNDECLARED, { voice: nv('sf-own', 'alloy') })
    expect(undeclared.status).toBe('accepted')
    expect(wcodes(undeclared)).toContain('VOICE_FORMAT_INVALID')
    // no voice set on an undeclared SiliconFlow model: the old default alloy goes out, as before
    const unset = await verdict(w, SF_UNDECLARED, { voice: null })
    expect(unset.reasons).toEqual([])
    const viaRelay = await verdict(w, RELAY_SF, { voice: nv('relay-sf', 'alloy') })
    expect(viaRelay.reasons).toEqual([])
  })
})

describe('exec 31: the admission matrix (configurations x inputs)', () => {
  const FIELDS = {
    voices: [
      undefined,
      '',
      '   ',
      'alloy',
      'marin',
      'Chinese (Mandarin)_News_Anchor',
      'longanyang',
      `${SF_MODEL}:alex`,
      'speech:mine:1:2',
      'zzz-unknown',
    ],
    texts: [1, 4096, 4097, 9999, 10000, 128001],
    instructions: [undefined, 'x'.repeat(60), '字'.repeat(60), 'a'.repeat(4097)],
    speeds: [undefined, 0.1, 1, 9],
  }
  const NOPROFILE_OPENAI = tts('plain', 'openai-tts', 'tts-1', 'https://api.example.com/v1')
  const CONFIGS: ProviderConfig[] = [
    OPENAI,
    OPENAI_OLD,
    tts('relay', 'openai-tts', 'gpt-4o-mini-tts', 'https://relay.example.com/v1'),
    NOPROFILE_OPENAI,
    tts('plain-override', 'openai-tts', 'acme', 'https://api.openai.com/v1', {
      capabilityOverrides: { maxPromptChars: 50 },
    }),
    SF,
    tts('sf-own', 'openai-tts', 'fishaudio/fish-speech-1.5', 'https://api.siliconflow.cn/v1'),
    tts('sf-relay', 'openai-tts', SF_MODEL, 'https://relay.example.com/v1'),
    MINIMAX,
    tts('minimax-relay', 'minimax-t2a', 'speech-2.8-hd', 'https://relay.example.com/v1'),
    tts('minimax-own', 'minimax-t2a', 'my-own-speech', 'https://api.minimax.cn/v1'),
    COSY,
    COSY_V35,
    COSY_V2,
    tts('cosy-own', 'dashscope-cosyvoice', 'my-own-cosy', 'https://w.cn-beijing.maas.aliyuncs.com'),
  ]

  it('no combination passes the pre-flight and then certainly fails at the job entry; no model without a profile is stopped by the new reason codes', async () => {
    const w = await makeWorld()
    const speechCodes = new Set([
      'VOICE_NOT_AVAILABLE',
      'VOICE_FROM_ANOTHER_SERVICE',
      'VOICE_FORMAT_INVALID',
      'INSTRUCTION_TOO_LONG',
      'TEXT_TOO_LONG',
    ])
    let combos = 0
    const preflightPassedButEntryFails: string[] = []
    const noProfileStopped: string[] = []
    const baseProject = (await w.ports.store.projects.get(w.project.id))!
    for (const voice of FIELDS.voices) {
      for (const instructions of FIELDS.instructions) {
        for (const textLen of FIELDS.texts) {
          const project = { ...baseProject } as typeof baseProject
          if (voice === undefined) delete project.narrationVoice
          else
            project.narrationVoice = {
              providerConfigId: 'x',
              voice,
              ...(instructions ? { instructions } : {}),
            }
          await w.ports.store.projects.put(project)
          await w.ports.store.shots.put({ ...w.shot, narration: '字'.repeat(textLen) })
          const projection = await w.reload()
          for (const p of CONFIGS) {
            const ctx: AdmissionContext = {
              projection,
              models,
              jobs: [],
              fileExists: (pid, path) => w.ports.files.exists(pid, path),
            }
            const v = await evaluateTarget(ctx, {
              target: { kind: 'shot_audio', shotId: w.shot.id },
              provider: p,
              confirmUnverified: true,
            })
            for (const speed of FIELDS.speeds) {
              combos++
              // the job entry: the same judgement, then the request the protocol would build
              const j = judgeSpeech(p, models, {
                text: '字'.repeat(textLen),
                narrationVoice: project.narrationVoice,
              })
              let entryFails = j.problems.length > 0
              if (!entryFails) {
                try {
                  getMediaProtocol(p.protocol).buildGenerateRequest(
                    { baseUrl: p.baseUrl, model: p.model, apiKey: 'k' },
                    {
                      text: '字'.repeat(textLen),
                      voice: j.voice,
                      format: 'mp3',
                      ...(speed ? { speed } : {}),
                      // the instruction only exists when a narration voice setting carries it
                      ...(instructions && project.narrationVoice ? { instructions } : {}),
                    },
                  )
                } catch {
                  entryFails = true
                }
              }
              const label = `${p.id} voice=${JSON.stringify(voice)} len=${textLen} instr=${instructions?.length ?? 0} speed=${speed}`
              const blocked = v.reasons.some((r) => r.code !== 'UNVERIFIED_NEEDS_CONFIRMATION')
              if (!blocked && entryFails) preflightPassedButEntryFails.push(label)
              if (
                p.protocol === 'openai-tts' &&
                !lookupDeclared(p) &&
                v.reasons.some((r) => speechCodes.has(r.code))
              )
                noProfileStopped.push(label)
            }
          }
        }
      }
    }
    expect(combos).toBe(14400)
    expect(preflightPassedButEntryFails).toEqual([])
    expect(noProfileStopped).toEqual([])
  }, 120_000)

  it('the combinations that remain blocked have an official basis: official address + a model with a profile (or no voice at all)', async () => {
    const w = await makeWorld()
    const relays = CONFIGS.filter(
      (p) => !isOfficialSpeechAddress(p.protocol, p.baseUrl) || !lookupDeclared(p),
    )
    const blockedCodes = new Set<string>()
    for (const p of relays) {
      for (const voice of ['alloy', 'zzz', 'Chinese (Mandarin)_News_Anchor', `${SF_MODEL}:alex`]) {
        const v = await verdict(w, p, { voice: nv(p.id, voice), narration: '字'.repeat(200000) })
        for (const r of v.reasons) blockedCodes.add(r.code)
      }
    }
    // outside the strong case only "no voice at all" (certain failure) and the confirmation of unverified items can block
    expect([...blockedCodes].filter((c) => c !== 'UNVERIFIED_NEEDS_CONFIRMATION')).toEqual([])
  })
})

describe('exec 41: the hints and reasons make no charging claim without a basis', () => {
  it('VOICE_UNLISTED and every other speech message are free of "not charged" statements', async () => {
    const w = await makeWorld()
    const claim = /不收费|免费|不计费|没有费用|不会收费/
    const seen: string[] = []
    for (const [p, voice] of [
      [MINIMAX, 'my_cloned_voice_01'],
      [OPENAI, 'zzz'],
      [SF, 'alloy'],
      [COSY, 'my_clone'],
    ] as const) {
      const v = await verdict(w, p, { voice: nv(p.id, voice), narration: '字'.repeat(200000) })
      for (const x of [...v.reasons, ...v.warnings]) seen.push(x.message)
    }
    expect(seen.length).toBeGreaterThan(4)
    for (const m of seen) expect(m).not.toMatch(claim)
  })
})
