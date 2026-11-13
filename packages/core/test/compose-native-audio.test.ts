import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  appendVersion,
  createEpisode,
  createScene,
  createShot,
  emptySlot,
} from '../src/domain/index.ts'
import type { MediaSlot } from '../src/domain/index.ts'
import { probeMedia, runProcess } from '../src/media/ffmpeg.ts'
import { buildNormalizeArgs } from '../src/media/render.ts'
import { clipSourceVolume, composeEpisode, ensureTimeline } from '../src/pipeline/compose.ts'
import { buildExpectations, buildRecord } from '../src/artifacts/staleness.ts'
import { loadProjection } from '../src/generation/projection.ts'
import type { ArtifactRecord } from '../src/artifacts/types.ts'
import { locateMedia, makePipelineEnv } from './fakes.ts'
import type { MediaEnv } from './fakes.ts'

// Record the volume each clip is normalised with, but still run the real ffmpeg.
const seen: Array<{ input: string; volume: number | undefined }> = []
vi.mock('../src/media/render.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/media/render.ts')>()
  return {
    ...real,
    normalizeClip: (env: unknown, opts: { input: string; volume?: number }) => {
      seen.push({ input: opts.input, volume: opts.volume })
      return real.normalizeClip(env as never, opts as never)
    },
  }
})

let media: MediaEnv | undefined
beforeAll(async () => {
  media = await locateMedia()
})

describe("clipSourceVolume: the model's own sound is only heard when it was asked for", () => {
  it('muted when the video was generated without native voice; otherwise the timeline volume', () => {
    expect(clipSourceVolume({ sourceVolume: 0.3 }, { withNativeAudio: false })).toBe(0)
    expect(clipSourceVolume({ sourceVolume: 1 }, { withNativeAudio: false })).toBe(0)
    expect(clipSourceVolume({ sourceVolume: 1 }, { withNativeAudio: true })).toBe(1)
    expect(clipSourceVolume({ sourceVolume: 0.3 }, { withNativeAudio: true })).toBe(0.3)
    // uploaded videos and old records carry no flag: untouched
    expect(clipSourceVolume({ sourceVolume: 0.3 }, {})).toBe(0.3)
    expect(clipSourceVolume({ sourceVolume: 1 }, undefined)).toBe(1)
  })
})

describe('the normalise step really silences volume 0', () => {
  it('volume=0 is in the audio filter, and not for 1', () => {
    const caps = { aac: true } as never
    const info = { hasAudio: true, videoDurationSec: 2, durationSec: 2 } as never
    const mk = (volume: number) =>
      buildNormalizeArgs(
        caps,
        { input: 'a.mp4', output: 'b.mp4', aspectRatio: '9:16', volume },
        info,
      )
    expect(mk(0).join(' ')).toContain('volume=0')
    expect(mk(1).join(' ')).not.toContain('volume=')
  })
})

describe('compose: a generated clip without native voice has no model sound in the cut', () => {
  it('muted clip is silent in the cut, a requested one is audible, an uploaded one keeps the timeline volume', async (ctx) => {
    if (!media) return ctx.skip()
    const env = await makePipelineEnv(media, {
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
    const loud = (n: number) => env.media.videoWithAudio(n, 2)
    const mkShot = async (
      n: number,
      flag: boolean | undefined,
      source: 'generated' | 'uploaded',
      dialogue: boolean,
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
      const bytes = await loud(n)
      const stored = await ports.files.put(projectId, path, bytes)
      let slot: MediaSlot = emptySlot()
      slot = appendVersion(slot, {
        id: `${s.id}_v1`,
        kind: 'video',
        source,
        createdAt: 1,
        file: { path, mime: 'video/mp4', bytes: stored.bytes, sha256: stored.sha256 },
        ...(flag === undefined ? {} : { withNativeAudio: flag }),
      })
      const shot = {
        ...s,
        video: slot,
        dialogue: dialogue ? [{ text: '你好。' }] : [],
        narration: dialogue ? undefined : '旁白。',
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
      return shot
    }
    // 1: narration by post-production, generated WITHOUT native voice, but the model's track is there anyway
    // 2: dialogue, generated WITH native voice
    // 3: narration, an uploaded video (no flag)
    const a = await mkShot(1, false, 'generated', false)
    const b = await mkShot(2, true, 'generated', true)
    const c = await mkShot(3, undefined, 'uploaded', false)
    await ports.store.scenes.put({ ...sc, shotOrder: [a.id, b.id, c.id] })
    await ports.store.episodes.put({ ...ep, sceneOrder: [sc.id] })
    const project = (await ports.store.projects.get(projectId))!
    await ports.store.projects.put({ ...project, episodeOrder: [ep.id] })

    await ensureTimeline(deps, ep.id)
    // the artifact records a real run leaves behind (the cut is registered on top of the shot videos)
    const exps = buildExpectations(await loadProjection(ports.store, projectId))
    const recs = new Map<string, ArtifactRecord>()
    for (const sh of [a, b, c]) {
      const img = sh.image.versions[0]!
      const vid = sh.video.versions[0]!
      for (const [key, file, versionId] of [
        [`shot_image:${sh.id}`, img.file, img.id],
        [`shot_video:${sh.id}`, vid.file, vid.id],
      ] as const) {
        const rec = buildRecord({
          projectId,
          expectation: exps.get(key)!,
          upstreamRecords: recs,
          file,
          versionId,
          now,
        })
        recs.set(key, rec)
        await ports.store.artifacts.put(rec)
      }
    }
    seen.length = 0
    const res = await composeEpisode(deps, ep.id, { subtitles: 'none', shortSide: 180 })

    // the volumes the three clips were normalised with: muted, as asked, the 0.3 duck for post-production narration
    expect(seen.map((s) => s.volume)).toEqual([0, 1, 0.3])

    const local = await ports.files.localPath(projectId, res.path)
    const info = await probeMedia(media!.bins, local)
    expect(info.hasAudio).toBe(true)
    const maxVolume = async (from: number, len: number) => {
      const r = await runProcess(media!.bins.ffmpeg, [
        '-hide_banner',
        '-ss',
        String(from),
        '-t',
        String(len),
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
    expect(await maxVolume(0.1, 1.6)).toBeLessThan(-60) // clip 1: nothing of the model's sound
    expect(await maxVolume(2.1, 1.6)).toBeGreaterThan(-30) // clip 2: audible
    expect(await maxVolume(4.1, 1.6)).toBeGreaterThan(-45) // clip 3: kept (ducked by the timeline)
  }, 120_000)
})
