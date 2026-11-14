// Records what the REAL server answers for the narration-voice screens, so the tests don't feed the components data
// that was made up from a report's examples. Not a test: run it by hand when the server's answers change.
//
//   node --conditions=dramai-source --experimental-strip-types packages/workspace/tests/fixtures/real-speech/record.mjs
//
// (from the repository root; Node 22+). It starts the server from this checkout in-process with a data directory of
// its own and an upstream that throws on any call, so nothing leaves the machine; keys are fake. It writes
// `recorded.json` next to this file, with the commit it was made from.
import { execSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from '../../../../server/src/app.ts'
import { createClient } from '../../../../api/src/index.ts'
import { createEpisode, createScene, createShot } from '../../../../core/src/index.ts'

const out = fileURLToPath(new URL('./recorded.json', import.meta.url))
const dataDir = await mkdtemp(join(tmpdir(), 'dramai-record-'))
const upstream = []
const server = await createServer({
  port: 0,
  dataDir,
  startWorker: false,
  validateResponses: true,
  logger: { error: () => {} },
  executor: {
    fetch: async (u) => {
      upstream.push(String(u))
      throw new Error('record: no upstream requests allowed')
    },
  },
})
const api = createClient({ baseUrl: server.url, token: server.token || undefined })
const KEY = 'sk-record-123456789012'
const mk = (presetId, extra = {}) =>
  api.call('providers.fromPreset', { body: { presetId, apiKey: KEY, ...extra } })

try {
  // providers: the four vendors' speech presets, plus the models that have no profile
  const P = {
    openai: await mk('openai-tts-key'),
    minimax: await mk('minimax-tts-cn'),
    siliconflow: await mk('siliconflow-tts-cn'),
    cosyFlash: await mk('aliyun-cosyvoice-cn', {
      baseUrl: 'https://ws123.cn-beijing.maas.aliyuncs.com',
    }),
  }
  const withModel = async (base, patch) => {
    const made = await mk('openai-tts-key')
    return api.call('providers.update', {
      params: { providerId: made.id },
      body: { ...patch, label: patch.label ?? base },
    })
  }
  P.tts1 = await withModel('tts-1', { model: 'tts-1', label: 'tts-1' })
  P.relay = await withModel('relay', {
    model: 'gpt-4o-mini-tts',
    baseUrl: 'https://relay.example.com/v1',
    label: 'relay',
  })
  P.relayTts1 = await withModel('relay tts-1', {
    model: 'tts-1',
    baseUrl: 'https://relay.example.com/v1',
    label: 'relay tts-1',
  })
  P.cosy35 = await mk('aliyun-cosyvoice-cn', {
    baseUrl: 'https://ws123.cn-beijing.maas.aliyuncs.com',
  })
  P.cosy35 = await api.call('providers.update', {
    params: { providerId: P.cosy35.id },
    body: { model: 'cosyvoice-v3.5-plus', label: 'cosy v3.5' },
  })

  const capabilities = {}
  for (const [k, p] of Object.entries(P))
    capabilities[k] = await api.call('providers.capability', { params: { providerId: p.id } })

  // projects and shots (seeded straight into the store, as the server's own tests do)
  const store = server.ctx.store
  let n = 0
  const seed = async (name, narrationVoice, narration = '茶馆里的人都安静了。') => {
    const made = await api.call('projects.create', {
      body: { name, aspectRatio: '9:16', narrationDelivery: 'tts' },
    })
    const id = made.id
    const now = Date.now()
    const ep = `e${++n}`
    const p0 = await store.projects.get(id)
    await store.projects.put({
      ...p0,
      episodeOrder: [ep],
      ...(narrationVoice ? { narrationVoice } : {}),
    })
    await store.episodes.put({
      ...createEpisode({ id: ep, projectId: id, number: 1, title: '一', now }),
      sceneOrder: [`s_${ep}`],
    })
    await store.scenes.put({
      ...createScene({ id: `s_${ep}`, projectId: id, episodeId: ep, number: 1, now }),
      shotOrder: [`sh_${ep}`],
    })
    await store.shots.put({
      ...createShot({
        id: `sh_${ep}`,
        projectId: id,
        sceneId: `s_${ep}`,
        number: 1,
        now,
        durationSec: 5,
      }),
      narration,
    })
    return { id, shotId: `sh_${ep}` }
  }
  const setTts = async (providerId) => {
    const s = await api.call('settings.get')
    await api.call('settings.update', {
      body: { ...s, activeProviders: { ...s.activeProviders, tts: providerId } },
    })
  }
  const scenario = async (key, provider, narrationVoice, narration) => {
    const proj = await seed(key, narrationVoice, narration)
    await setTts(P[provider].id)
    const project = await api.call('projects.get', { params: { projectId: proj.id } })
    const preflight = await api.call('generate.preflight', {
      params: { projectId: proj.id },
      body: { items: [{ target: { kind: 'shot_audio', shotId: proj.shotId } }] },
    })
    return { provider, projectId: proj.id, shotId: proj.shotId, project, preflight }
  }
  const nv = (provider, voice, extra = {}) => ({
    providerConfigId: P[provider].id,
    voice,
    ...extra,
  })
  const scenarios = {
    // no voice chosen, models without a profile: the server falls back to a voice of its own
    noVoiceTts1: await scenario('no voice, tts-1', 'tts1'),
    noVoiceRelay: await scenario('no voice, relay', 'relay'),
    noVoiceCosy35: await scenario('no voice, cosy 3.5', 'cosy35'),
    // a voice of another service on each kind of list
    foreignOnClosed: await scenario(
      'foreign on closed',
      'openai',
      nv('minimax', 'Chinese (Mandarin)_News_Anchor'),
    ),
    foreignOnOpen: await scenario('foreign on open', 'minimax', nv('openai', 'nova')),
    foreignOnNone: await scenario('foreign on none', 'cosy35', nv('openai', 'alloy')),
    foreignOnRelay: await scenario(
      'foreign on relay',
      'relayTts1',
      nv('minimax', 'male-qn-qingse'),
    ),
    // lengths
    narrationTooLong: await scenario(
      'narration too long',
      'openai',
      nv('openai', 'nova'),
      '长'.repeat(5000),
    ),
    instructionTooLong: await scenario(
      'instruction too long',
      'cosyFlash',
      nv('cosyFlash', 'longanyang', { instructions: '平'.repeat(60) }),
    ),
    // stored data the dialog must not disturb
    withSpeed: await scenario('voice with speed', 'openai', nv('openai', 'nova', { speed: 1.25 })),
    withSpeedAndInstructions: await scenario(
      'voice, speed, instructions',
      'openai',
      nv('openai', 'nova', { speed: 1.25, instructions: '轻声' }),
    ),
    paddedVoice: await scenario('padded voice', 'openai', nv('openai', ' nova ', { speed: 1 })),
  }
  const commit = execSync('git rev-parse HEAD', {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
  })
    .toString()
    .trim()
  const dirty =
    execSync('git status --porcelain -- packages/core packages/server packages/api', {
      cwd: fileURLToPath(new URL('../../../../..', import.meta.url)),
    })
      .toString()
      .trim() !== ''
  const providers = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, p]))
  await writeFile(
    out,
    JSON.stringify(
      {
        meta: {
          note: 'Recorded from the real server (upstream stubbed, fake keys). Regenerate with record.mjs in this folder.',
          commit,
          coreServerApiDirtyWhenRecorded: dirty,
          command:
            'node --conditions=dramai-source --experimental-strip-types packages/workspace/tests/fixtures/real-speech/record.mjs',
          upstreamRequests: upstream.length,
        },
        providers,
        capabilities,
        scenarios,
      },
      null,
      1,
    ),
  )
  if (upstream.length > 0) throw new Error('the recording made an upstream request')
  console.log('recorded', Object.keys(scenarios).length, 'scenarios')
} finally {
  await server.close({ graceful: false }).catch(() => {})
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
