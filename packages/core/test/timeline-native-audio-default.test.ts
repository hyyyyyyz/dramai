import JSZip from 'jszip'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { buildExpectations, buildRecord } from '../src/artifacts/staleness.ts'
import type { ArtifactRecord } from '../src/artifacts/types.ts'
import {
  appendVersion,
  createEpisode,
  createScene,
  createShot,
  emptySlot,
} from '../src/domain/index.ts'
import type { MediaSlot } from '../src/domain/index.ts'
import { exportMaterialPackage } from '../src/export/package.ts'
import { loadProjection } from '../src/generation/projection.ts'
import { probeMedia, runProcess } from '../src/media/ffmpeg.ts'
import {
  composeEpisode,
  ensureTimeline,
  nativeAudioDefaultVolume,
  syncTimelineWithShots,
} from '../src/pipeline/compose.ts'
import { appendRevision, headRevision, updateClip } from '../src/timeline/index.ts'
import { loadCatalog } from '../src/data-dir.ts'
import { locateMedia, makePipelineEnv } from './fakes.ts'
import type { MediaEnv, PipelineEnv } from './fakes.ts'

// Record the volume each clip is normalised with, but still run the real ffmpeg.
const seen: Array<{ volume: number | undefined }> = []
vi.mock('../src/media/render.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/media/render.ts')>()
  return {
    ...real,
    normalizeClip: (env: unknown, opts: { volume?: number }) => {
      seen.push({ volume: opts.volume })
      return real.normalizeClip(env as never, opts as never)
    },
  }
})

let media: MediaEnv | undefined
beforeAll(async () => {
  media = await locateMedia()
})
const models = loadCatalog().models

const KLING = {
  providerConfigId: 'k',
  protocol: 'kling-contents',
  baseUrl: 'https://x',
  model: 'kling-4.0',
}
const WAN = {
  providerConfigId: 'w',
  protocol: 'aliyun-video',
  baseUrl: 'https://x',
  model: 'wan2.2-i2v-flash',
}
const ARK = {
  providerConfigId: 'a',
  protocol: 'ark-video',
  baseUrl: 'https://x',
  model: 'doubao-seedance-2-0-260128',
}

describe('nativeAudioDefaultVolume: a default for NEW timeline clips, read from the model profile', () => {
  const shotWith = (over: object) =>
    ({
      video: appendVersion(emptySlot(), {
        id: 'v1',
        kind: 'video',
        source: 'generated',
        createdAt: 1,
        file: { path: 'p', mime: 'video/mp4', bytes: 1, sha256: 's' },
        provider: KLING,
        withNativeAudio: false,
        ...over,
      }),
    }) as never

  it('0 only for: generated + native voice not asked for + the model cannot switch audio off', () => {
    expect(nativeAudioDefaultVolume(shotWith({}), models)).toBe(0)
    // asked for native voice: the sound is wanted
    expect(nativeAudioDefaultVolume(shotWith({ withNativeAudio: true }), models)).toBeUndefined()
    // models that can switch it off (or whose profile does not say) keep the old defaults
    expect(nativeAudioDefaultVolume(shotWith({ provider: WAN }), models)).toBeUndefined()
    expect(nativeAudioDefaultVolume(shotWith({ provider: ARK }), models)).toBeUndefined()
    // uploaded videos, records without a provider, no video: untouched
    expect(nativeAudioDefaultVolume(shotWith({ source: 'uploaded' }), models)).toBeUndefined()
    expect(nativeAudioDefaultVolume(shotWith({ provider: undefined }), models)).toBeUndefined()
    expect(nativeAudioDefaultVolume({ video: emptySlot() } as never, models)).toBeUndefined()
  })

  it('it is the profile fact that decides, not a protocol or model name: the same model with the fact removed gets no default', () => {
    const profile = models.lookup({ protocol: 'kling-contents', model: 'kling-4.0' })
    expect(profile.capability.audioToggle).toBe('unsupported')
    const flipped = {
      lookup: () => ({ capability: { ...profile.capability, audioToggle: 'unverified' } }),
    } as never
    expect(nativeAudioDefaultVolume(shotWith({}), flipped)).toBeUndefined()
  })
})

describe('timeline defaults, compose and export with real files', () => {
  async function build() {
    const env: PipelineEnv = await makePipelineEnv(media!, {
      aspectRatio: '9:16',
      videoHasAudio: true,
      delivery: 'post',
    })
    const { ports, projectId, deps } = env
    const now = ports.clock.now()
    const ep = createEpisode({ id: ports.ids.next('ep'), projectId, number: 1, title: '一', now })
    const sc = createScene({
      id: ports.ids.next('scene'),
      projectId,
      episodeId: ep.id,
      number: 1,
      now,
    })
    const order: string[] = []
    const mk = async (
      n: number,
      o: {
        flag?: boolean
        source: 'generated' | 'uploaded'
        dialogue?: boolean
        provider?: typeof KLING
      },
    ) => {
      const s = createShot({
        id: ports.ids.next('shot'),
        projectId,
        sceneId: sc.id,
        number: n,
        now,
        durationSec: 2,
      })
      const path = `videos/${s.id}/v1.mp4`
      const stored = await ports.files.put(projectId, path, await env.media.videoWithAudio(n, 2))
      let video: MediaSlot = emptySlot()
      video = appendVersion(video, {
        id: `${s.id}_v1`,
        kind: 'video',
        source: o.source,
        createdAt: 1,
        file: { path, mime: 'video/mp4', bytes: stored.bytes, sha256: stored.sha256 },
        ...(o.provider ? { provider: o.provider } : {}),
        ...(o.flag === undefined ? {} : { withNativeAudio: o.flag }),
      })
      const shot = {
        ...s,
        video,
        dialogue: o.dialogue ? [{ text: '你好。' }] : [],
        narration: o.dialogue ? undefined : '旁白。',
        prompts: { keyFrame: '关键帧', video: '镜头推近' },
        image: appendVersion(emptySlot(), {
          id: `${s.id}_i1`,
          kind: 'image',
          source: 'generated',
          createdAt: 1,
          file: { path: `images/${s.id}.png`, mime: 'image/png', bytes: 1, sha256: `img-${s.id}` },
        }),
      }
      await ports.store.shots.put(shot)
      order.push(s.id)
      return shot
    }
    const a = await mk(1, { flag: false, source: 'generated', provider: KLING }) // cannot switch audio off, voice not asked for
    const b = await mk(2, { flag: true, source: 'generated', dialogue: true, provider: KLING }) // voice asked for
    const c = await mk(3, { flag: false, source: 'generated', provider: WAN }) // can switch audio off
    const d = await mk(4, { source: 'uploaded' })
    const publish = async () => {
      await ports.store.scenes.put({ ...sc, shotOrder: order })
      await ports.store.episodes.put({ ...ep, sceneOrder: [sc.id] })
      const project = (await ports.store.projects.get(projectId))!
      await ports.store.projects.put({ ...project, episodeOrder: [ep.id] })
    }
    await publish()
    return { env, ports, projectId, deps, ep, sc, order, mk, publish, shots: [a, b, c, d] }
  }

  const registerArtifacts = async (w: Awaited<ReturnType<typeof build>>) => {
    const exps = buildExpectations(await loadProjection(w.ports.store, w.projectId))
    const recs = new Map<string, ArtifactRecord>()
    for (const id of w.order) {
      const sh = (await w.ports.store.shots.get(id))!
      for (const [key, v] of [
        [`shot_image:${id}`, sh.image.versions[0]!],
        [`shot_video:${id}`, sh.video.versions[0]!],
      ] as const) {
        const rec = buildRecord({
          projectId: w.projectId,
          expectation: exps.get(key)!,
          upstreamRecords: recs,
          file: v.file,
          versionId: v.id,
          now: w.ports.clock.now(),
        })
        recs.set(key, rec)
        await w.ports.store.artifacts.put(rec)
      }
    }
  }

  it('new clips get the default; existing clips are never changed; the user can raise it', async (ctx) => {
    if (!media) return ctx.skip()
    const w = await build()
    const doc = await ensureTimeline(w.deps, w.ep.id)
    const vol = (d: typeof doc) => headRevision(d).content.clips.map((c) => c.sourceVolume)
    // A: 0 (cannot switch off, not asked for)  B: 1 (dialogue)  C: 0.3 (narration; Wan can switch off)  D: 0.3 (uploaded)
    expect(vol(doc)).toEqual([0, 1, 0.3, 0.3])

    // a later video for shot C from the Kling model does not touch its existing clip
    const c = (await w.ports.store.shots.get(w.shots[2]!.id))!
    await w.ports.store.shots.put({
      ...c,
      video: appendVersion(c.video, {
        id: 'c_v2',
        kind: 'video',
        source: 'generated',
        createdAt: 2,
        file: c.video.versions[0]!.file,
        provider: KLING,
        withNativeAudio: false,
      }),
    })
    // a new shot appears: only ITS clip gets a computed default
    const e = await w.mk(5, { flag: false, source: 'generated', provider: KLING })
    await w.publish()
    expect(e.id).toBeDefined()
    const synced = await syncTimelineWithShots(w.deps, w.ep.id)
    expect(vol(synced)).toEqual([0, 1, 0.3, 0.3, 0])

    // the user turns it up on the timeline: that is what applies
    const head = headRevision(synced)
    const raised = appendRevision(synced, {
      content: updateClip(head.content, head.content.clips[0]!.id, { sourceVolume: 1 }),
      summary: 'turn up',
      author: { kind: 'creator' },
      now: w.ports.clock.now(),
    })
    await w.ports.store.timelines.put(raised)
    expect(vol(raised)).toEqual([1, 1, 0.3, 0.3, 0])
  }, 120_000)

  it('compose applies exactly the timeline volume of every clip, whatever the version says (same as 0ba914b); export shows the same numbers', async (ctx) => {
    if (!media) return ctx.skip()
    const w = await build()
    const doc = await ensureTimeline(w.deps, w.ep.id)
    await registerArtifacts(w)
    seen.length = 0
    const res = await composeEpisode(w.deps, w.ep.id, { subtitles: 'none', shortSide: 180 })
    const clipVolumes = headRevision(doc).content.clips.map((c) => c.sourceVolume)
    expect(seen.map((s) => s.volume)).toEqual(clipVolumes) // [0, 1, 0.3, 0.3]: per clip, no hidden muting
    // clip C was generated with withNativeAudio false but its timeline volume is 0.3: its sound is in the cut
    const local = await w.ports.files.localPath(w.projectId, res.path)
    expect((await probeMedia(media!.bins, local)).hasAudio).toBe(true)
    const maxVolume = async (from: number) => {
      const r = await runProcess(media!.bins.ffmpeg, [
        '-hide_banner',
        '-ss',
        String(from),
        '-t',
        '1.6',
        '-i',
        local,
        '-vn',
        '-af',
        'volumedetect',
        '-f',
        'null',
        '-',
      ])
      const m = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr)
      return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : Number.NaN
    }
    expect(await maxVolume(0.1)).toBeLessThan(-60) // A: defaulted to 0 on the timeline
    expect(await maxVolume(2.1)).toBeGreaterThan(-30) // B
    expect(await maxVolume(4.1)).toBeGreaterThan(-45) // C: not muted, although withNativeAudio === false

    // the material package reads the real, effective sourceVolume
    const zip = await JSZip.loadAsync(
      await exportMaterialPackage(w.deps, w.ep.id, { includeImages: false, includeCut: false }),
    )
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as {
      shots: Array<{ sourceVolume: number; videoHasNativeAudio: boolean }>
    }
    expect(manifest.shots.map((s) => s.sourceVolume)).toEqual(clipVolumes)
    expect(manifest.shots.map((s) => s.videoHasNativeAudio)).toEqual([false, true, false, false])
  }, 120_000)
})
