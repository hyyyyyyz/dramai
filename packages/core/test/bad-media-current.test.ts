import { beforeAll, describe, expect, it } from 'vitest'
import type { AdmissionTarget } from '../src/admission/index.ts'
import { currentVersion } from '../src/domain/index.ts'
import type { Shot } from '../src/domain/index.ts'
import { episodeShots } from '../src/pipeline/entities.ts'
import { requestGeneration } from '../src/pipeline/request.ts'
import { locateMedia, makePipelineEnv } from './fakes.ts'
import type { MediaEnv, PipelineEnv } from './fakes.ts'
import { prepareEpisode, runAll } from './helpers-pipeline.ts'

/**
 * Exec 32, item 5 - REPORT ONLY for video and images: what happens today when the service returns bytes that are not
 * a usable video / image. This pins the CURRENT behaviour so the report is backed by a test, it is not a statement
 * that the behaviour is right. Voice-over is different: a clearly undecodable audio fails the job (see
 * speech-providers-pipeline.test.ts).
 */

let media: MediaEnv | undefined
let env: PipelineEnv
let shots: Shot[]
let garbage = false

beforeAll(async () => {
  media = await locateMedia()
  if (!media) return
  env = await makePipelineEnv(media, { aspectRatio: '9:16' })
  const inner = env.providers.fetch
  env.deps.executor = {
    sleep: async () => {},
    fetch: async (url, init) => {
      if (garbage) {
        const junk = new Uint8Array(400).map((_, i) => (i * 31) % 251)
        if (/cdn\.fake\/.*\.mp4/.test(url))
          return new Response(junk, { status: 200, headers: { 'content-type': 'video/mp4' } })
        if (url.includes(':generateContent'))
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inline_data: {
                          mime_type: 'image/png',
                          data: Buffer.from(junk).toString('base64'),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          )
      }
      return inner(url, init)
    },
  }
  const ep = await prepareEpisode(env)
  shots = await episodeShots(env.deps.store, ep.id)
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
}, 240_000)

const real = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => (media ? fn() : ctx.skip()), 120_000)

describe('today, a video or an image the service returns as garbage', () => {
  real(
    'IMAGE: the garbage is saved as the shot image and the job succeeds (no size, nothing checks it)',
    async () => {
      garbage = true
      const shot = shots[0]!
      await requestGeneration(env.deps, env.projectId, [
        { target: { kind: 'shot_image', shotId: shot.id }, provider: env.provider('img') },
      ])
      const job = (await runAll(env)).filter((j) => j.operation === 'shot_image').at(-1)!
      garbage = false
      expect(job.status).toBe('succeeded')
      const v = currentVersion((await env.deps.store.shots.get(shot.id))!.image)!
      expect(v.file.bytes).toBe(400)
      expect(v.facts?.width).toBeUndefined()
    },
  )

  real(
    'VIDEO: the garbage is saved as the shot video and the job succeeds (no duration, no size)',
    async () => {
      const shot = shots[1] ?? shots[0]!
      // a clean shot image first
      await requestGeneration(env.deps, env.projectId, [
        { target: { kind: 'shot_image', shotId: shot.id }, provider: env.provider('img') },
      ])
      await runAll(env)
      garbage = true
      await requestGeneration(
        env.deps,
        env.projectId,
        [
          {
            target: { kind: 'shot_video', shotId: shot.id },
            provider: env.provider('vid'),
            resolution: '720P',
            confirmUnverified: true,
          },
        ],
        { confirmUnverified: true },
      )
      const job = (await runAll(env)).filter((j) => j.operation === 'shot_video').at(-1)!
      garbage = false
      expect(job.status, JSON.stringify(job.error)).toBe('succeeded')
      const v = currentVersion((await env.deps.store.shots.get(shot.id))!.video)!
      expect(v.file.bytes).toBe(400)
      expect(v.facts?.durationSec).toBeUndefined()
    },
  )
})
