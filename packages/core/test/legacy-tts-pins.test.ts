import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { evaluateTarget } from '../src/admission/index.ts'
import type { AdmissionContext } from '../src/admission/index.ts'
import { buildExpectations, evaluateArtifacts } from '../src/artifacts/staleness.ts'
import { currentVersion } from '../src/domain/index.ts'
import { loadProjection } from '../src/generation/projection.ts'
import { episodeShots } from '../src/pipeline/entities.ts'
import { requestGeneration } from '../src/pipeline/request.ts'
import { runGeneration } from '../src/providers/executor.ts'
import { getMediaProtocol, openaiTts } from '../src/providers/protocols/index.ts'
import { computeLegacyTtsGolden } from './legacy-tts-cases.ts'
import { locateMedia, makePipelineEnv } from './fakes.ts'
import type { MediaEnv } from './fakes.ts'
import { prepareEpisode, runAll } from './helpers-pipeline.ts'

/**
 * P3d 步骤 0：钉死 `openai-tts` 现在发出的请求和旁白配音的整条路径（语音扩展的所有后续改动都不能让这些测试变化）。
 *
 * - 黄金文件由 `b29a689`（语音扩展之前）的代码生成：64 个请求（4 种地址 × 16 组输入：URL、方法、头、体）和 9 种响应的解析结果。
 * - 一次完整的执行器调用（请求序列、成品）。
 * - 旁白配音的整条管线：镜头 → 准入 → 任务 → 请求 → 音频版本（含实测时长）→ 依据 → 时效。
 *   那一组用真实 ffmpeg；找不到 ffmpeg 就跳过。
 */

describe('openai-tts: requests and responses are exactly the b29a689 ones', () => {
  const golden = JSON.parse(
    readFileSync(new URL('./fixtures/legacy-tts-golden.json', import.meta.url), 'utf8'),
  ) as { requests: Record<string, unknown>; responses: Record<string, unknown> }
  const current = computeLegacyTtsGolden(openaiTts) as typeof golden

  it('covers a real matrix', () => {
    expect(Object.keys(golden.requests)).toHaveLength(64)
    expect(Object.keys(golden.responses)).toHaveLength(9)
  })

  it.each(Object.keys(golden.requests))('request %s', (name) => {
    expect(current.requests[name]).toEqual(golden.requests[name])
  })

  it.each(Object.keys(golden.responses))('response %s', (name) => {
    expect(current.responses[name]).toEqual(golden.responses[name])
  })

  it('the registry returns the same protocol object, a sync binary protocol with no extras', () => {
    expect(getMediaProtocol('openai-tts')).toBe(openaiTts)
    expect(openaiTts.media).toBe('audio')
    expect(openaiTts.responseType).toBe('binary')
    expect(openaiTts.buildPollRequest).toBeUndefined()
    expect(openaiTts.parseHttpError).toBeUndefined()
    expect(openaiTts.protectedHeaders).toBeUndefined()
  })
})

describe('openai-tts through the executor: the whole request sequence', () => {
  it('one POST, key in the Authorization header only, the bytes come back as they are', async () => {
    const calls: Array<{ method: string; url: string; headers: unknown; body?: unknown }> = []
    const fetch = async (url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url,
        headers: init?.headers,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      return new Response(new Uint8Array([7, 8, 9]), { headers: { 'content-type': 'audio/mpeg' } })
    }
    const res = await runGeneration(
      openaiTts,
      {
        baseUrl: 'https://api.example.com/v1',
        model: 'tts-1',
        apiKey: 'sk-secret',
        method: 'api_key',
      },
      { text: '你好', voice: 'alloy', speed: 1, format: 'mp3' },
      { fetch },
    )
    expect(calls).toEqual([
      {
        method: 'POST',
        url: 'https://api.example.com/v1/audio/speech',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-secret' },
        body: { model: 'tts-1', input: '你好', voice: 'alloy', response_format: 'mp3', speed: 1 },
      },
    ])
    expect(res.outputs).toEqual([{ bytes: new Uint8Array([7, 8, 9]), mime: 'audio/mpeg' }])
    expect(JSON.stringify(calls[0]!.url)).not.toContain('sk-secret')
  })

  it('user extra headers join the request; they cannot replace the key or the content type', async () => {
    const seen: Array<Record<string, string>> = []
    const fetch = async (_url: string, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>)
      return new Response(new Uint8Array([1]), { headers: { 'content-type': 'audio/mpeg' } })
    }
    await runGeneration(
      openaiTts,
      {
        baseUrl: 'https://api.example.com/v1',
        model: 'tts-1',
        apiKey: 'sk-secret',
        method: 'api_key',
        dialect: {
          extraHeaders: {
            'X-Gateway': 'g1',
            authorization: 'Bearer evil',
            'content-type': 'text/plain',
          },
        },
      },
      { text: 'x' },
      { fetch },
    )
    expect(seen[0]).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-secret',
      'X-Gateway': 'g1',
    })
    expect(Object.values(seen[0]!)).not.toContain('Bearer evil')
  })

  it('an HTTP error keeps the plain HTTP_<status> code and the response text', async () => {
    const fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'bad voice' } }), { status: 400 })
    await expect(
      runGeneration(
        openaiTts,
        { baseUrl: 'https://api.example.com/v1', model: 'tts-1', apiKey: 'k' },
        { text: 'x' },
        { fetch },
      ),
    ).rejects.toMatchObject({ kind: 'http', code: 'HTTP_400', submission: 'rejected' })
  })
})

describe('narration voice-over: the whole path from shot to audio version', () => {
  let media: MediaEnv | undefined
  beforeAll(async () => {
    media = await locateMedia()
  })
  const real = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => (media ? fn() : ctx.skip()), 120_000)

  real(
    'request, version, basis, staleness and preflight are what they were before the speech batch',
    async () => {
      const env = await makePipelineEnv(media!)
      const speechHeaders: Array<Record<string, string>> = []
      const inner = env.deps.executor!.fetch!
      env.deps.executor = {
        ...env.deps.executor,
        fetch: async (url, init) => {
          if (url.endsWith('/audio/speech'))
            speechHeaders.push(init?.headers as Record<string, string>)
          return inner(url, init)
        },
      }
      const ep = await prepareEpisode(env)
      const shots = await episodeShots(env.deps.store, ep.id)
      const narr = shots.filter((s) => s.narration && !s.dialogue.some((d) => d.text.trim()))
      expect(narr.length).toBeGreaterThan(0)
      const tts = env.provider('tts')

      // preflight verdicts (read-only): accepted, the unverified mode is pre-accepted by the config, priced unknown
      const ctx = async (): Promise<AdmissionContext> => ({
        projection: await loadProjection(env.deps.store, env.projectId),
        models: env.deps.catalog.models,
        jobs: [],
        fileExists: (pid, p) => env.ports.files.exists(pid, p),
      })
      const verdict = await evaluateTarget(await ctx(), {
        target: { kind: 'shot_audio', shotId: narr[0]!.id },
        provider: tts,
      })
      expect(verdict.status).toBe('accepted')
      expect(verdict.reasons).toEqual([])
      expect(verdict.warnings).toEqual([])
      expect(verdict.unverified).toEqual([])
      expect(verdict.estimate).toMatchObject({ priced: false })
      expect(verdict).not.toHaveProperty('video')

      // without a narration voice the preflight only warns, once
      const proj = (await env.deps.store.projects.get(env.projectId))!
      const noVoice = { ...proj }
      delete noVoice.narrationVoice
      await env.deps.store.projects.put(noVoice)
      const warned = await evaluateTarget(await ctx(), {
        target: { kind: 'shot_audio', shotId: narr[0]!.id },
        provider: tts,
      })
      expect(warned.status).toBe('accepted')
      expect(warned.warnings.map((w) => w.code)).toEqual(['NARRATION_VOICE_DEFAULTED'])
      await env.deps.store.projects.put(proj)

      // the artifact basis of a narration audio: provider config id, voice and speed from the project setting
      const exp = buildExpectations(await loadProjection(env.deps.store, env.projectId)).get(
        `shot_audio:${narr[0]!.id}`,
      )!
      expect(exp.basis).toEqual({
        text: narr[0]!.narration,
        audio: { provider: 'tts', voice: 'alloy', speed: 1 },
      })

      // run the job
      const res = await requestGeneration(
        env.deps,
        env.projectId,
        narr.map((s) => ({ target: { kind: 'shot_audio' as const, shotId: s.id }, provider: tts })),
      )
      expect(res.succeeded).toHaveLength(narr.length)
      const jobs = await runAll(env)
      expect(jobs.filter((j) => j.operation === 'shot_audio').map((j) => j.status)).toEqual(
        narr.map(() => 'succeeded'),
      )

      // exactly one speech request per shot: the same URL, headers and body keys as ever
      const speech = env.providers.requests.filter((r) => r.url.endsWith('/audio/speech'))
      expect(speech).toHaveLength(narr.length)
      expect(speech[0]!.url).toBe('https://api.tts.example/audio/speech')
      expect(speech[0]!.body).toEqual({
        model: 'tts-1',
        input: narr[0]!.narration,
        voice: 'alloy',
        response_format: 'mp3',
        speed: 1,
      })
      expect(speechHeaders[0]).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-tts',
      })
      expect(Object.keys(speech[0]!.body as object).sort()).toEqual(
        ['input', 'model', 'response_format', 'speed', 'voice'].sort(),
      )

      // the stored version
      const shot = (await env.deps.store.shots.get(narr[0]!.id))!
      const v = currentVersion(shot.narrationAudio)!
      expect(v).toMatchObject({
        kind: 'audio',
        source: 'generated',
        prompt: narr[0]!.narration,
        provider: {
          providerConfigId: 'tts',
          protocol: 'openai-tts',
          baseUrl: 'https://api.tts.example',
          model: 'tts-1',
        },
      })
      expect(v.file.mime).toBe('audio/wav') // the fake server answers with a wav
      expect(v.file.path).toMatch(/^audio\//)
      expect(v.facts?.durationSec).toBeGreaterThan(1.2)
      expect(v.facts?.durationSec).toBeLessThan(2)
      expect(v.withNativeAudio).toBeUndefined()
      expect(v.usedReferences).toBeUndefined()

      // fresh narration is current; changing the voice makes it stale for the right reason
      let reports = evaluateArtifacts(await loadProjection(env.deps.store, env.projectId))
      expect(reports.get(`shot_audio:${narr[0]!.id}`)!.status).toBe('current')
      await env.deps.store.projects.put({
        ...proj,
        narrationVoice: { providerConfigId: 'tts', voice: 'nova', speed: 1 },
      })
      reports = evaluateArtifacts(await loadProjection(env.deps.store, env.projectId))
      const stale = reports.get(`shot_audio:${narr[0]!.id}`)!
      expect(stale.status).toBe('stale')
      expect(stale.changes).toMatchObject([{ kind: 'input', field: 'audio' }])
    },
  )
})
