import { beforeAll, describe, expect, it } from 'vitest'
import type { AdmissionTarget } from '../src/admission/index.ts'
import { evaluateArtifacts } from '../src/artifacts/staleness.ts'
import { currentVersion, SCHEMA_VERSIONS } from '../src/domain/index.ts'
import type { NarrationVoice, Shot } from '../src/domain/index.ts'
import { loadProjection } from '../src/generation/projection.ts'
import { episodeShots } from '../src/pipeline/entities.ts'
import { requestGeneration } from '../src/pipeline/request.ts'
import type { ProviderConfig } from '../src/providers/types.ts'
import { locateMedia, makePipelineEnv, PROVIDERS } from './fakes.ts'
import type { MediaEnv, PipelineEnv } from './fakes.ts'
import { makeWorker, prepareEpisode, runAll } from './helpers-pipeline.ts'

/**
 * P3d: narration voice-over through the four speech providers, the whole way from shot to audio version, with the
 * upstream faked (fake fetch) and ffmpeg real. Same path for every protocol: request -> bytes (decoded / downloaded)
 * -> measured duration -> version -> basis.
 */

let media: MediaEnv | undefined
let env: PipelineEnv
let narr: Shot[]
let wavBytes: Uint8Array
const calls: Array<{
  method: string
  url: string
  headers: Record<string, string>
  body?: Record<string, unknown>
}> = []
const mode = { minimax: 'ok', cosy: 'ok' } as { minimax: string; cosy: string }

const base = (
  id: string,
  protocol: ProviderConfig['protocol'],
  model: string,
  baseUrl: string,
): ProviderConfig => ({
  id,
  label: id,
  kind: 'tts',
  protocol,
  baseUrl,
  model,
  enabled: true,
  secretRef: 'k-tts',
  acceptedUnverified: ['mode:tts'],
})
const OPENAI = base('openai', 'openai-tts', 'gpt-4o-mini-tts', 'https://api.openai.com/v1')
const SF = base('sf', 'openai-tts', 'FunAudioLLM/CosyVoice2-0.5B', 'https://api.siliconflow.cn/v1')
const MINIMAX = base('minimax', 'minimax-t2a', 'speech-2.8-hd', 'https://api.minimax.cn/v1')
const COSY = base(
  'cosy',
  'dashscope-cosyvoice',
  'cosyvoice-v3-flash',
  'https://ws1.cn-beijing.maas.aliyuncs.com',
)
const ALL = [OPENAI, SF, MINIMAX, COSY]

beforeAll(async () => {
  media = await locateMedia()
  if (!media) return
  env = await makePipelineEnv(media, { aspectRatio: '9:16' })
  wavBytes = await env.media.wav(1)
  const inner = env.providers.fetch
  env.deps.providers = {
    get: async (id) => [...PROVIDERS, ...ALL].find((p) => p.id === id),
    list: async () => [...PROVIDERS, ...ALL],
  }
  env.deps.executor = {
    sleep: async () => {},
    fetch: async (url, init) => {
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
      if (url.startsWith('https://api.minimax.cn')) {
        calls.push({ method, url, headers: init?.headers as Record<string, string>, body })
        if (mode.minimax === 'business-error')
          return json({ base_resp: { status_code: 1004, status_msg: 'login fail: bad key' } })
        if (mode.minimax === 'bad-hex')
          return json({ data: { audio: 'not-hex!', status: 2 }, base_resp: { status_code: 0 } })
        return json({
          data: { audio: Buffer.from(wavBytes).toString('hex'), status: 2 },
          extra_info: { audio_format: 'wav', audio_length: 1500 },
          base_resp: { status_code: 0, status_msg: 'success' },
        })
      }
      if (url.startsWith('https://ws1.cn-beijing.maas.aliyuncs.com')) {
        calls.push({ method, url, headers: init?.headers as Record<string, string>, body })
        return json({
          request_id: 'r1',
          output: { finish_reason: 'stop', audio: { url: 'https://oss.example.com/a.wav?sig=1' } },
          usage: { characters: 20 },
        })
      }
      if (url.startsWith('https://oss.example.com')) {
        calls.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string> })
        if (mode.cosy === 'download-403') return new Response('expired', { status: 403 })
        return new Response(wavBytes, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        })
      }
      if (url.endsWith('/audio/speech')) {
        calls.push({ method, url, headers: init?.headers as Record<string, string>, body })
      }
      return inner(url, init)
    },
  }
  const ep = await prepareEpisode(env)
  narr = (await episodeShots(env.deps.store, ep.id)).filter(
    (s) => s.narration && !s.dialogue.some((d) => d.text.trim()),
  )
}, 240_000)

const real = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => (media ? fn() : ctx.skip()), 120_000)

async function setVoice(voice: NarrationVoice | null) {
  const p = (await env.deps.store.projects.get(env.projectId))!
  const next = { ...p }
  if (voice) next.narrationVoice = voice
  else delete next.narrationVoice
  await env.deps.store.projects.put(next)
}

async function narrate(provider: ProviderConfig, shot = narr[0]!) {
  calls.length = 0
  const before = (await env.deps.store.jobs.list()).length
  const res = await requestGeneration(
    env.deps,
    env.projectId,
    [
      {
        target: { kind: 'shot_audio', shotId: shot.id },
        provider,
        confirmUnverified: true,
      } as AdmissionTarget,
    ],
    { confirmUnverified: true },
  )
  expect(res.succeeded.length + res.failed.length + res.blocked.length).toBe(1)
  const jobs = await runAll(env)
  const job = jobs.find((j) => j.id === (res.succeeded[0] as { jobId: string }).jobId)!
  const s = (await env.deps.store.shots.get(shot.id))!
  return { res, job, version: currentVersion(s.narrationAudio), jobsBefore: before }
}

describe('narration through MiniMax: hex in a JSON answer', () => {
  real('decodes the audio, measures the real duration, stores one version', async () => {
    mode.minimax = 'ok'
    await setVoice({
      providerConfigId: 'minimax',
      voice: 'Chinese (Mandarin)_News_Anchor',
      speed: 1.1,
    })
    const { job, version } = await narrate(MINIMAX)
    expect(job.status, JSON.stringify(job.error)).toBe('succeeded')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.minimax.cn/v1/t2a_v2')
    expect(calls[0]!.headers.Authorization).toBe('Bearer sk-tts')
    expect(calls[0]!.url).not.toContain('sk-tts')
    expect(JSON.stringify(calls[0]!.body)).not.toContain('sk-tts')
    expect(calls[0]!.body).toMatchObject({
      model: 'speech-2.8-hd',
      text: narr[0]!.narration,
      stream: false,
      voice_setting: { voice_id: 'Chinese (Mandarin)_News_Anchor', speed: 1.1 },
      audio_setting: { format: 'mp3' },
      output_format: 'hex',
    })
    expect(version).toMatchObject({
      kind: 'audio',
      source: 'generated',
      provider: { providerConfigId: 'minimax', protocol: 'minimax-t2a', model: 'speech-2.8-hd' },
    })
    expect(version!.file.mime).toBe('audio/wav')
    // the same measuring path as every other audio: the real duration of the decoded bytes
    expect(version!.facts?.durationSec).toBeGreaterThan(1.2)
    expect(version!.facts?.durationSec).toBeLessThan(2)
    expect(job.result).not.toHaveProperty('ignoredInputs')
  })

  real('an instruction has no counterpart: it is not sent and the job result says so', async () => {
    mode.minimax = 'ok'
    await setVoice({
      providerConfigId: 'minimax',
      voice: 'Chinese (Mandarin)_News_Anchor',
      instructions: '低沉一点',
      language: 'ko',
    })
    const { job } = await narrate(MINIMAX)
    expect(job.status).toBe('succeeded')
    expect(JSON.stringify(calls[0]!.body)).not.toContain('低沉')
    expect(job.result).toMatchObject({ ignoredInputs: ['instructions', 'language'] })
  })

  real(
    'a business error inside HTTP 200 fails the job with the stable code; one request, no version',
    async () => {
      mode.minimax = 'business-error'
      await setVoice({ providerConfigId: 'minimax', voice: 'Chinese (Mandarin)_News_Anchor' })
      const shot = narr[1] ?? narr[0]!
      const { job, version } = await narrate(MINIMAX, shot)
      expect(job.status).toBe('failed')
      expect(job.error).toMatchObject({ category: 'generation_failed', code: 'MINIMAX_1004' })
      expect(job.error!.message).toContain('bad key')
      expect(calls).toHaveLength(1)
      if (shot.id !== narr[0]!.id) expect(version).toBeUndefined()
      mode.minimax = 'ok'
    },
  )

  real(
    'audio that is not valid hex fails the job as "submission unknown" and nothing is stored',
    async () => {
      mode.minimax = 'bad-hex'
      await setVoice({ providerConfigId: 'minimax', voice: 'Chinese (Mandarin)_News_Anchor' })
      const shot = narr[2] ?? narr[1] ?? narr[0]!
      const { job, version } = await narrate(MINIMAX, shot)
      expect(job.status).toBe('failed')
      expect(job.error).toMatchObject({
        category: 'submission_unknown',
        code: 'UNREADABLE_RESPONSE',
      })
      if (shot.id !== narr[0]!.id) expect(version).toBeUndefined()
      mode.minimax = 'ok'
    },
  )
})

describe('narration through CosyVoice: a link that is downloaded at once', () => {
  real(
    'submit, then download the signed link without our headers; same measured duration',
    async () => {
      mode.cosy = 'ok'
      await setVoice({
        providerConfigId: 'cosy',
        voice: 'longanyang',
        instructions: '用四川话说',
        language: 'zh',
      })
      const shot = narr[1] ?? narr[0]!
      const { job, version } = await narrate(COSY, shot)
      expect(job.status, JSON.stringify(job.error)).toBe('succeeded')
      expect(calls.map((c) => c.method + ' ' + c.url.split('?')[0])).toEqual([
        'POST https://ws1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
        'GET https://oss.example.com/a.wav',
      ])
      expect(calls[0]!.headers.Authorization).toBe('Bearer sk-tts')
      expect(calls[0]!.body).toEqual({
        model: 'cosyvoice-v3-flash',
        input: {
          text: shot.narration,
          voice: 'longanyang',
          format: 'mp3',
          instruction: '用四川话说',
          language_hints: ['zh'],
        },
      })
      expect(calls[1]!.headers).toEqual({}) // nothing of ours goes to the storage host
      expect(version!.provider).toMatchObject({ protocol: 'dashscope-cosyvoice' })
      expect(version!.file.mime).toBe('audio/wav')
      expect(version!.facts?.durationSec).toBeGreaterThan(1.2)
      expect(version!.facts?.durationSec).toBeLessThan(2)
      expect(job.result).not.toHaveProperty('ignoredInputs')
    },
  )

  real(
    'the link failing to download fails the job as a delivery failure; no audio version is stored',
    async () => {
      mode.cosy = 'download-403'
      await setVoice({ providerConfigId: 'cosy', voice: 'longanyang' })
      const shot = narr[2] ?? narr[0]!
      const { job, version } = await narrate(COSY, shot)
      expect(job.status).toBe('failed')
      expect(job.error).toMatchObject({ category: 'delivery_failed', code: 'HTTP_403' })
      if (shot.id !== (narr[1] ?? narr[0]!).id && shot.id !== narr[0]!.id)
        expect(version).toBeUndefined()
      mode.cosy = 'ok'
    },
  )
})

describe('narration through OpenAI-compatible providers: bytes, same as ever', () => {
  real(
    'OpenAI gpt-4o-mini-tts sends instructions; SiliconFlow gets the voice with its model prefix and no instructions',
    async () => {
      await setVoice({
        providerConfigId: 'openai',
        voice: 'marin',
        speed: 1,
        instructions: '语速放缓',
      })
      const a = await narrate(OPENAI)
      expect(a.job.status, JSON.stringify(a.job.error)).toBe('succeeded')
      expect(calls[0]!.url).toBe('https://api.openai.com/v1/audio/speech')
      expect(calls[0]!.body).toEqual({
        model: 'gpt-4o-mini-tts',
        input: narr[0]!.narration,
        voice: 'marin',
        response_format: 'mp3',
        speed: 1,
        instructions: '语速放缓',
      })
      expect(a.version!.facts?.durationSec).toBeGreaterThan(1.2)

      await setVoice({
        providerConfigId: 'sf',
        voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
        speed: 1,
        instructions: '语速放缓',
      })
      const b = await narrate(SF, narr[1] ?? narr[0]!)
      expect(b.job.status, JSON.stringify(b.job.error)).toBe('succeeded')
      expect(calls[0]!.url).toBe('https://api.siliconflow.cn/v1/audio/speech')
      expect(calls[0]!.body).toMatchObject({
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
      })
      expect(calls[0]!.body).not.toHaveProperty('instructions')
      expect(b.job.result).toMatchObject({ ignoredInputs: ['instructions'] })
    },
  )
})

describe('the backstop and the basis', () => {
  real(
    'a job that reaches the task entry with a voice from another service fails before any request',
    async () => {
      await setVoice({ providerConfigId: 'openai', voice: 'alloy' })
      calls.length = 0
      const now = env.deps.clock.now()
      await env.deps.store.jobs.insert({
        schemaVersion: SCHEMA_VERSIONS.job,
        id: 'job_forced_voice',
        type: 'audio',
        operation: 'shot_audio',
        projectId: env.projectId,
        shotId: narr[0]!.id,
        params: { target: { kind: 'shot_audio', shotId: narr[0]!.id } },
        paid: true,
        status: 'queued',
        attempt: 0,
        previousProviderJobIds: [],
        createdAt: now,
        updatedAt: now,
        providerSnapshot: {
          providerConfigId: 'minimax',
          protocol: 'minimax-t2a',
          baseUrl: MINIMAX.baseUrl,
          model: MINIMAX.model,
        },
      })
      const jobs = await runAll(env)
      const job = jobs.find((j) => j.id === 'job_forced_voice')!
      expect(job.status).toBe('failed')
      expect(job.error).toMatchObject({
        category: 'invalid_input',
        code: 'VOICE_FROM_ANOTHER_SERVICE',
        recoverable: false,
      })
      expect(calls).toEqual([]) // nothing was sent
    },
  )

  real(
    'a text that is too long fails the same way (a job created before the narration was edited)',
    async () => {
      await setVoice({ providerConfigId: 'openai', voice: 'alloy' })
      const shot = (await env.deps.store.shots.get(narr[0]!.id))!
      await env.deps.store.shots.put({ ...shot, narration: '字'.repeat(4097) })
      calls.length = 0
      const now = env.deps.clock.now()
      await env.deps.store.jobs.insert({
        schemaVersion: SCHEMA_VERSIONS.job,
        id: 'job_forced_long',
        type: 'audio',
        operation: 'shot_audio',
        projectId: env.projectId,
        shotId: shot.id,
        params: { target: { kind: 'shot_audio', shotId: shot.id } },
        paid: true,
        status: 'queued',
        attempt: 0,
        previousProviderJobIds: [],
        createdAt: now,
        updatedAt: now,
        providerSnapshot: {
          providerConfigId: 'openai',
          protocol: 'openai-tts',
          baseUrl: OPENAI.baseUrl,
          model: OPENAI.model,
        },
      })
      const jobs = await runAll(env)
      expect(jobs.find((j) => j.id === 'job_forced_long')!.error).toMatchObject({
        category: 'invalid_input',
        code: 'TEXT_TOO_LONG',
      })
      expect(calls).toEqual([])
      await env.deps.store.shots.put(shot) // restore
    },
  )

  real(
    'the instruction and the language are part of the narration basis only when they are set',
    async () => {
      const basisOf = async () =>
        (await loadProjection(env.deps.store, env.projectId)) &&
        evaluateArtifacts(await loadProjection(env.deps.store, env.projectId))
      await setVoice({ providerConfigId: 'minimax', voice: 'Chinese (Mandarin)_News_Anchor' })
      mode.minimax = 'ok'
      const shot = narr[0]!
      const made = await narrate(MINIMAX, shot)
      expect(made.job.status, JSON.stringify(made.job.error ?? made.res)).toBe('succeeded')
      expect((await basisOf())!.get(`shot_audio:${shot.id}`)!.status).toBe('current')
      // setting an instruction later changes what the user would hear -> honestly outdated
      await setVoice({
        providerConfigId: 'minimax',
        voice: 'Chinese (Mandarin)_News_Anchor',
        instructions: '低沉',
      })
      const stale = (await basisOf())!.get(`shot_audio:${shot.id}`)!
      expect(stale.status).toBe('stale')
      // removing it again returns to the original basis
      await setVoice({ providerConfigId: 'minimax', voice: 'Chinese (Mandarin)_News_Anchor' })
      expect((await basisOf())!.get(`shot_audio:${shot.id}`)!.status).toBe('current')
    },
  )
})

describe('restart between "version saved" and "job marked succeeded" (voice-over)', () => {
  const crashed = async (jobId: string) => {
    await env.deps.store.jobs.patch(jobId, {
      status: 'running',
      finishedAt: undefined,
      result: undefined,
      stage: 'processing',
    })
    await makeWorker(env).reconcileOrphans()
    return (await runAll(env)).find((j) => j.id === jobId)!
  }

  real(
    'CosyVoice (a sync protocol whose result is a link): the restart resumes the download, and the job finishes with the version it saved - no second audio version, no second download',
    async () => {
      mode.cosy = 'ok'
      await setVoice({ providerConfigId: 'cosy', voice: 'longanyang' })
      const shot = narr[0]!
      const { job, version } = await narrate(COSY, shot)
      expect(job.status, JSON.stringify(job.error)).toBe('succeeded')
      expect((await env.deps.store.jobs.get(job.id))!.resultUrl).toContain('oss.example.com')
      calls.length = 0
      const versions = async () =>
        (await env.deps.store.shots.get(shot.id))!.narrationAudio.versions.map((v) => v.id)
      const before = await versions()
      const after = await crashed(job.id)
      expect(after.status, JSON.stringify(after.error)).toBe('succeeded')
      expect(after.result).toMatchObject({ versionId: version!.id, alreadySaved: true })
      expect(await versions()).toEqual(before)
      expect(calls).toEqual([]) // not downloaded again, not submitted again
    },
  )

  real(
    "CosyVoice, the paid retry of a job whose first attempt had saved a version: killed before saving, the restart downloads the retry's audio",
    async () => {
      mode.cosy = 'ok'
      await setVoice({ providerConfigId: 'cosy', voice: 'longanyang' })
      const shot = narr[1] ?? narr[0]!
      const { job } = await narrate(COSY, shot)
      expect(job.status).toBe('succeeded')
      const versions = async () =>
        (await env.deps.store.shots.get(shot.id))!.narrationAudio.versions.map((v) => v.id)
      const old = await versions()
      // pretend attempt 1 ended failed and the user confirmed a paid retry: attempt 2 has a result link, killed before saving
      const j = (await env.deps.store.jobs.get(job.id))!
      await env.deps.store.jobs.patch(job.id, { attempt: j.attempt + 1 })
      calls.length = 0
      const after = await crashed(job.id)
      expect(after.status, JSON.stringify(after.error)).toBe('succeeded')
      const now = await versions()
      expect(now).toHaveLength(old.length + 1)
      expect(calls.map((c) => c.method)).toEqual(['GET']) // the link of the retry was downloaded
      expect(after.result).not.toHaveProperty('alreadySaved')
    },
  )

  real(
    'a byte-response protocol has no task number or link: the restart still marks the job failed (unchanged), no second version',
    async () => {
      mode.minimax = 'ok'
      await setVoice({ providerConfigId: 'minimax', voice: 'Chinese (Mandarin)_News_Anchor' })
      const shot = narr[2] ?? narr[0]!
      const { job } = await narrate(MINIMAX, shot)
      expect(job.status).toBe('succeeded')
      const n = async () =>
        (await env.deps.store.shots.get(shot.id))!.narrationAudio.versions.length
      const before = await n()
      const after = await crashed(job.id)
      expect(after.status).toBe('failed')
      expect(after.error).toMatchObject({ code: 'SYNC_CALL_INTERRUPTED' })
      expect(await n()).toBe(before)
    },
  )
})
