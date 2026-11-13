import { beforeAll, describe, expect, it } from 'vitest'
import { evaluateTarget } from '../src/admission/index.ts'
import type { AdmissionContext, AdmissionTarget } from '../src/admission/index.ts'
import { appendVersion, currentVersion } from '../src/domain/index.ts'
import type { Episode, Shot } from '../src/domain/index.ts'
import { loadProjection } from '../src/generation/projection.ts'
import { ensureTimeline, syncTimelineWithShots } from '../src/pipeline/compose.ts'
import { episodeShots } from '../src/pipeline/entities.ts'
import { nativeAudioDefaultVolume, providerConfigMap } from '../src/pipeline/native-audio.ts'
import { requestGeneration } from '../src/pipeline/request.ts'
import type { ProviderConfig } from '../src/providers/types.ts'
import { appendRevision, headRevision, updateClip } from '../src/timeline/index.ts'
import { locateMedia, makePipelineEnv, PROVIDERS } from './fakes.ts'
import type { MediaEnv, PipelineEnv } from './fakes.ts'
import { prepareEpisode, runAll } from './helpers-pipeline.ts'

/**
 * Follow-up 1: the default volume of a timeline clip is decided when the clip is created OR the first time the shot
 * gets a generated video - so "timeline first, videos later" and "videos first, timeline later" end up the same.
 * Follow-up 2: the timeline default and the admission warning read the very same capability (incl. user overrides).
 */

let media: MediaEnv | undefined
beforeAll(async () => {
  media = await locateMedia()
})

const KLING: ProviderConfig = {
  id: 'kling',
  label: 'Kling 4.0',
  kind: 'video',
  protocol: 'kling-contents',
  baseUrl: 'https://api-singapore.klingai.com',
  model: 'kling-4.0',
  enabled: true,
  secretRef: 'k-vid',
}
const WAN = PROVIDERS.find((p) => p.id === 'vid')! // 302.AI Wan Flash: can switch audio off, profile has no audioToggle fact

async function setup(): Promise<{
  env: PipelineEnv
  ep: Episode
  shots: Shot[]
  providers: ProviderConfig[]
}> {
  const env = await makePipelineEnv(media!, { aspectRatio: '9:16', videoHasAudio: true })
  const providers = [...PROVIDERS, KLING]
  env.deps.providers = {
    get: async (id) => providers.find((p) => p.id === id),
    list: async () => providers,
  }
  const inner = env.providers.fetch
  env.deps.executor = {
    sleep: async () => {},
    fetch: async (url, init) => {
      const method = init?.method ?? 'GET'
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 })
      if (url.startsWith('https://api-singapore.klingai.com')) {
        return method === 'POST'
          ? json({ code: 0, data: { id: 'k-1' } })
          : json({
              code: 0,
              data: [
                {
                  id: 'k-1',
                  status: 'succeeded',
                  outputs: [{ type: 'video', url: 'https://cdn.fake/k-1.mp4' }],
                },
              ],
            })
      }
      if (url === 'https://cdn.fake/k-1.mp4') {
        return new Response(await env.media.videoWithAudio(1, 2), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        })
      }
      return inner(url, init)
    },
  }
  const ep = await prepareEpisode(env)
  const shots = await episodeShots(env.deps.store, ep.id)
  const used = new Set<string>()
  for (const s of shots)
    for (const r of await env.deps.store.shotRefs.listByShot(s.id)) used.add(r.assetId)
  await requestGeneration(
    env.deps,
    env.projectId,
    [...used].map(
      (id): AdmissionTarget => ({
        target: { kind: 'asset_sheet', assetId: id },
        provider: env.provider('img'),
        sheetLayout: 'multi_view',
      }),
    ),
  )
  await runAll(env)
  await requestGeneration(
    env.deps,
    env.projectId,
    shots.map(
      (s): AdmissionTarget => ({
        target: { kind: 'shot_image', shotId: s.id },
        provider: env.provider('img'),
      }),
    ),
  )
  await runAll(env)
  return { env, ep, shots, providers }
}

const gen = async (env: PipelineEnv, provider: ProviderConfig, shotIds: string[]) => {
  await requestGeneration(
    env.deps,
    env.projectId,
    shotIds.map(
      (id): AdmissionTarget => ({
        target: { kind: 'shot_video', shotId: id },
        provider,
        resolution: provider.protocol === 'kling-contents' ? '720p' : '720P',
        confirmUnverified: true,
      }),
    ),
    { confirmUnverified: true },
  )
  return runAll(env)
}
const volumes = async (env: PipelineEnv, epId: string) => {
  const doc = await ensureTimeline(env.deps, epId)
  return Object.fromEntries(headRevision(doc).content.clips.map((c) => [c.shotId, c.sourceVolume]))
}
const real = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => (media ? fn() : ctx.skip()), 180_000)

describe('follow-up 1: the default volume does not depend on the order', () => {
  real(
    'videos first, timeline later == timeline first, videos later; only the clips that did not ask for native voice are 0',
    async () => {
      // order A: generate with Kling, then the timeline is created
      const a = await setup()
      await gen(
        a.env,
        KLING,
        a.shots.map((s) => s.id),
      )
      const volA = await volumes(a.env, a.ep.id)
      // order B: the timeline exists first (opened the compose page), then the videos are generated
      const b = await setup()
      const before = await volumes(b.env, b.ep.id)
      expect(Object.values(before).every((v) => v === 1 || v === 0.3)).toBe(true) // nothing special yet
      const docBefore = await ensureTimeline(b.env.deps, b.ep.id)
      b.env.ports.events.events.length = 0
      await gen(
        b.env,
        KLING,
        b.shots.map((s) => s.id),
      )
      const volB = await volumes(b.env, b.ep.id)

      // same shots in both runs (same fixtures): the numbers match shot for shot
      expect(b.shots.map((s) => volB[s.id])).toEqual(a.shots.map((s) => volA[s.id]))
      // and they are the intended ones: native voice (dialogue) stays 1, the others are 0
      for (const s of b.shots) {
        const dialogue = s.dialogue.some((d) => d.text.trim())
        const v = currentVersion((await b.env.deps.store.shots.get(s.id))!.video)!
        expect(v.withNativeAudio).toBe(dialogue)
        expect(volB[s.id], s.id).toBe(dialogue ? 1 : 0)
      }
      expect(Object.values(volB)).toContain(0)

      // each change is one visible revision by the app, listing the clips, and the UI is told
      const docAfter = await ensureTimeline(b.env.deps, b.ep.id)
      const autos = docAfter.revisions.slice(docBefore.revisions.length)
      expect(autos.length).toBeGreaterThan(0)
      for (const r of autos) {
        expect(r.author.kind).toBe('agent')
        expect(r.changedClipIds!.length).toBeGreaterThan(0)
        expect(r.summary).toContain('默认音量')
      }
      expect(b.env.ports.events.ofType('timeline.changed').length).toBe(autos.length)
    },
  )

  real(
    'a clip the user changed is never touched - not even when they changed it back',
    async () => {
      const w = await setup()
      const narr = w.shots.filter((s) => !s.dialogue.some((d) => d.text.trim()) && s.narration)
      expect(narr.length).toBeGreaterThan(1)
      const [raised, restored, plain] = narr as [Shot, Shot, Shot]
      let doc = await ensureTimeline(w.env.deps, w.ep.id)
      const edit = async (shotId: string, volume: number) => {
        const head = headRevision(doc)
        const clip = head.content.clips.find((c) => c.shotId === shotId)!
        doc = appendRevision(doc, {
          content: updateClip(head.content, clip.id, { sourceVolume: volume }),
          summary: 'user',
          author: { kind: 'creator' },
          now: w.env.deps.clock.now(),
        })
        await w.env.deps.store.timelines.put(doc)
      }
      await edit(raised.id, 0.8)
      await edit(restored.id, 0.9)
      await edit(restored.id, 0.3) // back to the original number: the history still shows it was touched
      await gen(w.env, KLING, [raised.id, restored.id, plain.id])
      const v = await volumes(w.env, w.ep.id)
      expect(v[raised.id]).toBe(0.8)
      expect(v[restored.id]).toBe(0.3)
      expect(v[plain.id]).toBe(0) // the untouched one got the default
    },
  )

  real(
    'a shot that already had a video keeps its clip: changing the video or the model later changes nothing',
    async () => {
      const w = await setup()
      const narr = w.shots.find((s) => !s.dialogue.some((d) => d.text.trim()) && s.narration)!
      await ensureTimeline(w.env.deps, w.ep.id)
      await gen(w.env, WAN, [narr.id]) // first video: a model that can switch audio off -> default stays
      expect((await volumes(w.env, w.ep.id))[narr.id]).toBe(0.3)
      await gen(w.env, KLING, [narr.id]) // later a Kling video: not the first video any more
      expect((await volumes(w.env, w.ep.id))[narr.id]).toBe(0.3)
      expect(
        currentVersion((await w.env.deps.store.shots.get(narr.id))!.video)!.provider!.protocol,
      ).toBe('kling-contents')

      // an uploaded video counts as "had a video" too
      const other = w.shots.find(
        (s) => s.id !== narr.id && !s.dialogue.some((d) => d.text.trim()) && s.narration,
      )!
      const sh = (await w.env.deps.store.shots.get(other.id))!
      await w.env.deps.store.shots.put({
        ...sh,
        video: appendVersion(sh.video, {
          id: 'up1',
          kind: 'video',
          source: 'uploaded',
          createdAt: 1,
          file: { path: 'videos/up.mp4', mime: 'video/mp4', bytes: 1, sha256: 'x' },
        }),
      })
      await gen(w.env, KLING, [other.id])
      expect((await volumes(w.env, w.ep.id))[other.id]).toBe(0.3)
    },
  )

  real(
    'an old project (timeline built before this change, no Kling video anywhere) stays exactly as it was, through sync as well',
    async () => {
      const w = await setup()
      const first = await ensureTimeline(w.env.deps, w.ep.id)
      await gen(
        w.env,
        WAN,
        w.shots.map((s) => s.id),
      )
      const synced = await syncTimelineWithShots(w.env.deps, w.ep.id)
      expect(synced.revisions.length).toBe(first.revisions.length) // not even a new revision
      expect(headRevision(synced).content).toEqual(headRevision(first).content)
    },
  )
})

describe('follow-up 2: one capability source for the warning and the default', () => {
  real(
    'with the audio switch overridden, admission and the timeline agree - in both directions',
    async () => {
      const w = await setup()
      const narr = w.shots.find((s) => !s.dialogue.some((d) => d.text.trim()) && s.narration)!
      const ctx = async (): Promise<AdmissionContext> => ({
        projection: await loadProjection(w.env.deps.store, w.env.projectId),
        models: w.env.deps.catalog.models,
        jobs: [],
        fileExists: (pid, p) => w.env.ports.files.exists(pid, p),
      })
      const warns = async (p: ProviderConfig) =>
        (
          await evaluateTarget(await ctx(), {
            target: { kind: 'shot_video', shotId: narr.id },
            provider: p,
            resolution: p.protocol === 'kling-contents' ? '720p' : '720P',
            confirmUnverified: true,
          })
        ).warnings.map((x) => x.code)
      const defaultFor = async (p: ProviderConfig) => {
        // a generated video of this config, withNativeAudio false
        const shot = {
          video: appendVersion(
            { currentVersionId: null, versions: [] },
            {
              id: 'v',
              kind: 'video',
              source: 'generated',
              createdAt: 1,
              file: { path: 'p', mime: 'video/mp4', bytes: 1, sha256: 's' },
              withNativeAudio: false,
              provider: {
                providerConfigId: p.id,
                protocol: p.protocol,
                baseUrl: p.baseUrl,
                model: p.model,
              },
            },
          ),
        } as Pick<Shot, 'video'>
        const configs = await providerConfigMap({
          providers: { get: async () => p, list: async () => [p] },
        })
        return nativeAudioDefaultVolume(shot, w.env.deps.catalog.models, configs)
      }
      // profile fact: Kling cannot switch audio off -> both say so
      expect(await warns(KLING)).toContain('AUDIO_NOT_DISABLEABLE')
      expect(await defaultFor(KLING)).toBe(0)
      // the user overrides the fact on this provider config -> both stop saying it
      const supported = { ...KLING, capabilityOverrides: { audioToggle: 'supported' as const } }
      expect(await warns(supported)).not.toContain('AUDIO_NOT_DISABLEABLE')
      expect(await defaultFor(supported)).toBeUndefined()
      // and the other way round: a model that can switch it off, overridden to "cannot" -> both say so
      const cannot = { ...WAN, capabilityOverrides: { audioToggle: 'unsupported' as const } }
      expect(await warns(WAN)).not.toContain('AUDIO_NOT_DISABLEABLE')
      expect(await defaultFor(WAN)).toBeUndefined()
      expect(await warns(cannot)).toContain('AUDIO_NOT_DISABLEABLE')
      expect(await defaultFor(cannot)).toBe(0)
    },
  )
})
