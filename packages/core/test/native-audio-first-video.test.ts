import { AsyncLocalStorage } from 'node:async_hooks'
import { beforeAll, describe, expect, it } from 'vitest'
import { evaluateTarget } from '../src/admission/index.ts'
import type { AdmissionContext, AdmissionTarget } from '../src/admission/index.ts'
import { appendVersion, currentVersion } from '../src/domain/index.ts'
import type { Episode, Shot } from '../src/domain/index.ts'
import { loadProjection } from '../src/generation/projection.ts'
import { ensureTimeline, syncTimelineWithShots } from '../src/pipeline/compose.ts'
import { episodeShots } from '../src/pipeline/entities.ts'
import {
  applyNativeAudioDefaultAfterSave,
  nativeAudioDefaultVolume,
  providerConfigMap,
} from '../src/pipeline/native-audio.ts'
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
        expect(r.reason).toBe('native_audio_default') // machine-readable; the summary is only for reading
      }
      // every other revision (the initial one, sync, the user's) has no reason
      const others = docAfter.revisions.slice(0, docBefore.revisions.length)
      expect(others.length).toBeGreaterThan(0)
      for (const r of others) expect(r).not.toHaveProperty('reason')
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
      // the user's own revisions never carry the reason; only the app's automatic ones do
      const reasons = doc.revisions.map((r) => r.reason)
      expect(reasons.filter(Boolean)).toEqual([])
      const latest = await ensureTimeline(w.env.deps, w.ep.id)
      const autoRevs = latest.revisions.filter((r) => r.reason)
      expect(autoRevs.length).toBeGreaterThan(0)
      expect(
        autoRevs.every((r) => r.reason === 'native_audio_default' && r.author.kind === 'agent'),
      ).toBe(true)
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

describe('exec 25: the automatic mute must never cost a paid-for video', () => {
  const narrationShot = (w: { shots: Shot[] }) =>
    w.shots.find((s) => !s.dialogue.some((d) => d.text.trim()) && s.narration)!

  real(
    'a timeline with a broken old revision: the Kling job succeeds, the version is saved, nothing half-written is left behind',
    async () => {
      const w = await setup()
      const narr = narrationShot(w)
      const doc = await ensureTimeline(w.env.deps, w.ep.id)
      // the reviewer's reproduction: an old revision whose content is null
      // keep the head readable for the clip lookup, break only an OLD revision
      const head = headRevision(doc)
      const withTwo = appendRevision(doc, {
        content: head.content,
        summary: 'user',
        author: { kind: 'creator' },
        now: 5,
      })
      const corrupt = {
        ...withTwo,
        revisions: withTwo.revisions.map((r, i) =>
          i === 0 ? { ...r, content: null as never } : r,
        ),
      }
      await w.env.deps.store.timelines.put(corrupt)
      w.env.ports.events.events.length = 0

      const jobs = await gen(w.env, KLING, [narr.id])
      const job = jobs.filter((j) => j.operation === 'shot_video').at(-1)!
      expect(job.status).toBe('succeeded')
      expect(job.error).toBeUndefined()
      expect(job.result).not.toHaveProperty('error')

      const shot = (await w.env.deps.store.shots.get(narr.id))!
      const v = currentVersion(shot.video)!
      expect(v.source).toBe('generated')
      expect(v.provider!.protocol).toBe('kling-contents')
      expect(await w.env.ports.files.exists(w.env.projectId, v.file.path)).toBe(true)
      // the artifact record was registered with the version (it is part of saving a video)
      const arts = await w.env.deps.store.artifacts.listByProject(w.env.projectId)
      expect(arts.some((a) => a.key === `shot_video:${narr.id}`)).toBe(true)

      // no auto mute happened and nothing half-written: the stored timeline is exactly what it was
      const after = (await w.env.deps.store.timelines.listByProject(w.env.projectId)).find(
        (t) => t.episodeId === w.ep.id,
      )!
      expect(after).toEqual(corrupt)
      expect(w.env.ports.events.ofType('timeline.changed')).toEqual([])
      // one short notice without any content (only the error type)
      const notes = w.env.ports.events.ofType('job.worker_error')
      expect(notes).toHaveLength(1)
      expect(notes[0]!.message).toContain('视频已保存')
      expect(notes[0]!.message).not.toContain('content')
      expect(notes[0]!.message).not.toContain('clips')
    },
  )

  real(
    'the provider directory failing after the video was made does not lose the video either',
    async () => {
      const w = await setup()
      const narr = narrationShot(w)
      await ensureTimeline(w.env.deps, w.ep.id)
      const realList = w.env.deps.providers.list
      let armed = false
      // the job reads the directory with get() (not list()); only the post-save mute step lists them
      w.env.deps.providers = {
        get: w.env.deps.providers.get,
        list: async () => {
          if (armed) throw new Error('directory unavailable')
          return realList()
        },
      }
      armed = true
      const jobs = await gen(w.env, KLING, [narr.id])
      const job = jobs.filter((j) => j.operation === 'shot_video').at(-1)!
      expect(job.status).toBe('succeeded')
      expect(currentVersion((await w.env.deps.store.shots.get(narr.id))!.video)).toBeTruthy()
      expect(w.env.ports.events.ofType('job.worker_error').length).toBe(1)
    },
  )

  real(
    'a normal run is unchanged: the mute is its own revision after the version is saved, and the event follows it',
    async () => {
      const w = await setup()
      const narr = narrationShot(w)
      const before = await ensureTimeline(w.env.deps, w.ep.id)
      w.env.ports.events.events.length = 0
      await gen(w.env, KLING, [narr.id])
      const after = await ensureTimeline(w.env.deps, w.ep.id)
      expect(after.revisions.length).toBe(before.revisions.length + 1)
      const auto = after.revisions.at(-1)!
      expect(auto.reason).toBe('native_audio_default')
      expect(auto.changedClipIds!.length).toBeGreaterThan(0)
      const types = w.env.ports.events.events.map((e) => e.type)
      expect(types.lastIndexOf('timeline.changed')).toBeGreaterThan(
        types.indexOf('artifact.changed'),
      )
      expect(w.env.ports.events.ofType('job.worker_error')).toEqual([])
    },
  )

  real(
    "the first-timeline race in the reviewer's order: the video lands while the timeline is being created - the mute is not lost",
    async () => {
      const w = await setup()
      const narr = narrationShot(w)
      const base = w.env.deps.store
      // a store whose transactions exclude each other, like the SQLite store (mutex + BEGIN IMMEDIATE)
      const als = new AsyncLocalStorage<boolean>()
      let tail: Promise<unknown> = Promise.resolve()
      let injected: Promise<void> | undefined
      let armed = false
      const store: typeof base = new Proxy(base, {
        get(t, k) {
          if (k === 'transaction')
            return <T>(fn: (tx: typeof base) => Promise<T>): Promise<T> => {
              if (als.getStore()) return base.transaction(() => fn(store))
              const run = tail.then(() => als.run(true, () => base.transaction(() => fn(store))))
              tail = run.catch(() => {})
              return run
            }
          if (k === 'shots')
            return new Proxy(base.shots, {
              get(st, sk) {
                const v = (st as never as Record<string | symbol, unknown>)[sk]
                if (sk === 'listByProject')
                  return async (...a: unknown[]) => {
                    const out = await (v as (...x: unknown[]) => Promise<unknown>).apply(st, a)
                    // "the shot rows have just been read for the new timeline": now the video is saved
                    if (armed) {
                      armed = false
                      injected = als.exit(() => saveVideoNow())
                      // the window in which the video can land before the timeline is written: it only closes if the
                      // video's transactions have to wait for this one
                      await new Promise((r) => setTimeout(r, 150))
                    }
                    return out
                  }
                return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(st) : v
              },
            })
          const v = (t as never as Record<string | symbol, unknown>)[k]
          return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v
        },
      })
      w.env.deps.store = store
      const version = {
        id: 'ver-race',
        kind: 'video' as const,
        source: 'generated' as const,
        createdAt: 1,
        file: { path: 'videos/race.mp4', mime: 'video/mp4', bytes: 1, sha256: 's' },
        withNativeAudio: false,
        provider: {
          providerConfigId: KLING.id,
          protocol: KLING.protocol,
          baseUrl: KLING.baseUrl,
          model: KLING.model,
        },
      }
      const saveVideoNow = async () => {
        let shotBefore!: Shot
        // what doVideoJob does: save the version, then (separately) the mute step
        await store.transaction(async (tx) => {
          const s = (await tx.shots.get(narr.id))!
          shotBefore = s
          await tx.shots.put({
            ...s,
            video: appendVersion(s.video, version, { makeCurrent: true }),
          })
        })
        await applyNativeAudioDefaultAfterSave(w.env.deps, { shotBefore, version })
      }
      armed = true
      const doc = await ensureTimeline(w.env.deps, w.ep.id)
      await injected
      expect(injected).toBeDefined()
      // the timeline was created from the rows read BEFORE the video; the mute then found it and muted the clip
      const latest = (await store.timelines.listByProject(w.env.projectId)).find(
        (t) => t.episodeId === w.ep.id,
      )!
      const clip = headRevision(latest).content.clips.find((c) => c.shotId === narr.id)!
      expect(clip.sourceVolume).toBe(0)
      expect(latest.revisions.map((r) => r.reason)).toEqual([undefined, 'native_audio_default'])
      expect(doc.revisions).toHaveLength(1)
    },
  )
})
