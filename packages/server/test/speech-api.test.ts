import { afterEach, describe, expect, it } from 'vitest'
import { createEpisode, createProject, createScene, createShot } from '@dramai/core'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

/** P3d through the real HTTP contract: presets, capability (voices, limits, prices), the narration voice, admission. */

async function boot() {
  const h = await startServer({ startWorker: false })
  const { store } = h.server.ctx
  const now = Date.now()
  const base = createProject({ id: 'p1', name: '测试', aspectRatio: '9:16', now })
  await store.projects.put({ ...base, episodeOrder: ['e1'] })
  await store.episodes.put({
    ...createEpisode({ id: 'e1', projectId: 'p1', number: 1, title: '一', now }),
    sceneOrder: ['s1'],
  })
  await store.scenes.put({
    ...createScene({ id: 's1', projectId: 'p1', episodeId: 'e1', number: 1, now }),
    shotOrder: ['sh1'],
  })
  await store.shots.put({
    ...createShot({ id: 'sh1', projectId: 'p1', sceneId: 's1', number: 1, now, durationSec: 5 }),
    narration: '夜深了，街上没有人。',
  })
  return h
}

describe('speech presets and capability over HTTP', () => {
  it('the presets are listed as tts, documented and untested, with the three languages', async () => {
    const h = await boot()
    const { items } = await h.client.call('presets.list')
    const tts = items.filter((p) => p.kind === 'tts')
    expect(tts.map((p) => p.id).sort()).toEqual([
      'aliyun-cosyvoice-cn',
      'minimax-tts-cn',
      'minimax-tts-global',
      'openai-tts-key',
      'siliconflow-tts-cn',
      'siliconflow-tts-global',
    ])
    for (const p of tts) expect(p.verification.status).toBe('documented')
    const en = await h.client.call('presets.list') // default locale; the texts are checked in the core tests
    expect(en.items.length).toBe(items.length)
  })

  it('a config made from a preset reports the voice list, the default voice, the text limit and the price per site', async () => {
    const h = await boot()
    const cn = await h.client.call('providers.fromPreset', {
      body: { presetId: 'minimax-tts-cn', apiKey: 'sk-mm-123456789012' },
    })
    expect(cn).toMatchObject({ kind: 'tts', protocol: 'minimax-t2a', model: 'speech-2.8-hd' })
    expect(JSON.stringify(cn)).not.toContain('sk-mm-123456789012')
    const cap = await h.client.call('providers.capability', { params: { providerId: cn.id } })
    expect(cap.declared).toBe(true)
    expect(cap.capability).toMatchObject({
      media: 'audio',
      maxPromptChars: 9999,
      defaultVoice: 'Chinese (Mandarin)_News_Anchor',
      voices: { support: 'unverified' },
    })
    expect(cap.capability.voices!.value!.map((v) => v.id)).toContain(
      'Chinese (Mandarin)_News_Anchor',
    )
    expect(cap.pricing.some((p) => p.currency === 'CNY' && p.unit === 'per_1k_chars')).toBe(true)

    const openai = await h.client.call('providers.fromPreset', {
      body: { presetId: 'openai-tts-key', apiKey: 'sk-oa-123456789012' },
    })
    const ocap = await h.client.call('providers.capability', { params: { providerId: openai.id } })
    expect(ocap.capability.voices).toMatchObject({ support: 'supported' })
    expect(ocap.capability.voices!.value).toHaveLength(13)
  })

  it('the connection test says "cannot verify" for the new protocols, and sends nothing', async () => {
    const h = await boot()
    const mm = await h.client.call('providers.fromPreset', {
      body: { presetId: 'minimax-tts-cn', apiKey: 'sk-mm-123456789012' },
    })
    const r = await h.client.call('providers.test', { params: { providerId: mm.id } })
    expect(r.outcome).toBe('unverifiable')
  })

  it('the CosyVoice preset address still needs the workspace ID', async () => {
    const h = await boot()
    await expect(
      h.client.call('providers.fromPreset', {
        body: { presetId: 'aliyun-cosyvoice-cn', apiKey: 'sk-ali-123456789012' },
      }),
    ).rejects.toMatchObject({ code: 'BASE_URL_PLACEHOLDER_UNFILLED' })
  })
})

describe('the narration voice and admission over HTTP', () => {
  it('instructions and language are stored and returned; the preflight stops a voice from another service', async () => {
    const h = await boot()
    const mm = await h.client.call('providers.fromPreset', {
      body: { presetId: 'minimax-tts-cn', apiKey: 'sk-mm-123456789012' },
    })
    const proj = await h.client.call('projects.update', {
      params: { projectId: 'p1' },
      body: {
        narrationVoice: {
          providerConfigId: mm.id,
          voice: 'alloy',
          speed: 1,
          instructions: '低沉',
          language: 'zh',
        },
      },
    })
    expect(proj.narrationVoice).toEqual({
      providerConfigId: mm.id,
      voice: 'alloy',
      speed: 1,
      instructions: '低沉',
      language: 'zh',
    })
    const bad = await h.client.call('generate.preflight', {
      params: { projectId: 'p1' },
      body: { items: [{ target: { kind: 'shot_audio', shotId: 'sh1' }, providerId: mm.id }] },
    })
    expect(bad.results[0]!.status).toBe('blocked')
    expect(bad.results[0]!.reasons.map((r) => r.code)).toEqual(['VOICE_FROM_ANOTHER_SERVICE'])

    // choosing a voice that belongs to the service makes it pass (the unverified mode still needs a confirmation)
    await h.client.call('projects.update', {
      params: { projectId: 'p1' },
      body: {
        narrationVoice: { providerConfigId: mm.id, voice: 'Chinese (Mandarin)_News_Anchor' },
      },
    })
    const ok = await h.client.call('generate.preflight', {
      params: { projectId: 'p1' },
      body: { items: [{ target: { kind: 'shot_audio', shotId: 'sh1' }, providerId: mm.id }] },
    })
    expect(ok.results[0]!.reasons.map((r) => r.code)).toEqual(['UNVERIFIED_NEEDS_CONFIRMATION'])
    expect(ok.results[0]!.estimate).toMatchObject({ priced: true, currency: 'CNY' })
  })
})
