import { afterEach, describe, expect, it } from 'vitest'
import {
  appendRevision,
  appendVersion,
  buildExpectations,
  buildRecord,
  createEpisode,
  createProject,
  createScene,
  createShot,
  emptySlot,
  headRevision,
  loadProjection,
} from '@dramai/core'
import type { ProviderConfig } from '@dramai/core'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'

afterEach(cleanupAll)

/**
 * Exec 25, end to end on the real SQLite store, the real worker and real HTTP (the upstream is a fake fetch):
 * - an automatic mute that fails must never cost the (already paid-for) video;
 * - many shots finishing at once: every mute lands, revision numbers stay consecutive.
 */

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const VIDEO = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50])

const KLING: ProviderConfig = {
  id: 'kling',
  label: 'Kling 4.0',
  kind: 'video',
  protocol: 'kling-contents',
  baseUrl: 'https://kling.fake',
  model: 'kling-4.0',
  enabled: true,
  secretRef: 'k-kling',
}

async function setup(shotCount: number) {
  const h = await startServer({
    startWorker: true,
    workerIntervalMs: 10,
    lanes: { video: 4 },
    executor: {
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url)
        const post = (init?.method ?? 'GET') === 'POST'
        if (u.startsWith('https://kling.fake')) {
          return new Response(
            JSON.stringify(
              post
                ? { code: 0, data: { id: 'k-1', status: 'submitted' } }
                : {
                    code: 0,
                    data: [
                      {
                        id: 'k-1',
                        status: 'succeeded',
                        outputs: [{ type: 'video', url: 'https://cdn.fake/v.mp4', duration: '2' }],
                      },
                    ],
                  },
            ),
            { status: 200 },
          )
        }
        if (u === 'https://cdn.fake/v.mp4')
          return new Response(VIDEO, { status: 200, headers: { 'content-type': 'video/mp4' } })
        return new Response('not found', { status: 404 })
      }) as typeof globalThis.fetch,
      sleep: async () => {},
    },
  })
  const { store, secrets, settings, files } = h.server.ctx
  await secrets.set('k-kling', 'kling-key-123456')
  await store.providers.put(KLING)
  await settings.patchActive('video', 'kling')
  const now = Date.now()
  const image = async (id: string, path: string) => {
    const info = await files.put('p1', path, new Uint8Array(PNG))
    return appendVersion(emptySlot(), {
      id,
      kind: 'image',
      source: 'generated',
      createdAt: 1,
      file: { path, mime: 'image/png', bytes: info.bytes, sha256: info.sha256 },
    })
  }
  const ids = Array.from({ length: shotCount }, (_, i) => `sh${i + 1}`)
  const shots = []
  for (const [i, id] of ids.entries()) {
    shots.push({
      ...createShot({ id, projectId: 'p1', sceneId: 's1', number: i + 1, now, durationSec: 5 }),
      narration: `旁白 ${i + 1}`, // narration only: no native voice wanted, so the Kling mute applies
      prompts: { keyFrame: '街头', video: '镜头缓慢推近' },
      image: await image(`${id}_v1`, `images/${id}/v1.png`),
    })
  }
  let project = createProject({ id: 'p1', name: '测试', aspectRatio: '9:16', now })
  project = { ...project, episodeOrder: ['e1'] }
  await store.projects.put(project)
  await store.episodes.put({
    ...createEpisode({ id: 'e1', projectId: 'p1', number: 1, title: '一', now }),
    sceneOrder: ['s1'],
  })
  await store.scenes.put({
    ...createScene({ id: 's1', projectId: 'p1', episodeId: 'e1', number: 1, now }),
    shotOrder: ids,
  })
  for (const s of shots) await store.shots.put(s)
  const exps = buildExpectations(await loadProjection(store, 'p1'))
  const recs = new Map()
  for (const s of shots) {
    const rec = buildRecord({
      projectId: 'p1',
      expectation: exps.get(`shot_image:${s.id}`)!,
      upstreamRecords: recs,
      file: s.image.versions[0]!.file,
      versionId: `${s.id}_v1`,
      now,
    })
    recs.set(`shot_image:${s.id}`, rec)
    await store.artifacts.put(rec)
  }
  return { h, ids }
}

const items = (ids: string[]) =>
  ids.map((id) => ({
    target: { kind: 'shot_video' as const, shotId: id },
    resolution: '720p',
    confirmUnverified: true,
  }))

async function runAndWait(h: Harness, ids: string[]) {
  const res = await h.client.call('generate.submit', {
    params: { projectId: 'p1' },
    body: { items: items(ids), confirmUnverified: true },
  })
  expect(res.succeeded).toHaveLength(ids.length)
  const jobs = []
  for (const { jobId } of res.succeeded) {
    for (let i = 0; i < 500; i++) {
      const job = await h.client.call('jobs.get', { params: { jobId } })
      if (job.status === 'succeeded' || job.status === 'failed') {
        jobs.push(job)
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  expect(jobs).toHaveLength(ids.length)
  return jobs
}

describe('automatic mute on the real server', () => {
  it('a broken old timeline revision: the Kling job succeeds and the video version is saved', async () => {
    const { h, ids } = await setup(1)
    const first = await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    expect(first.head).toBe(1)
    // the reviewer's reproduction: an old revision whose content is null (head stays readable)
    const store = h.server.ctx.store
    const doc = (await store.timelines.listByProject('p1')).find((d) => d.episodeId === 'e1')!
    const two = appendRevision(doc, {
      content: headRevision(doc).content,
      summary: 'user',
      author: { kind: 'creator' },
      now: 5,
    })
    const corrupt = {
      ...two,
      revisions: two.revisions.map((r, i) => (i === 0 ? { ...r, content: null as never } : r)),
    }
    await store.timelines.put(corrupt)

    const [job] = await runAndWait(h, ids)
    expect(job!.status, JSON.stringify(job!.error)).toBe('succeeded')
    expect(job!.error).toBeUndefined()

    const shot = await h.client.call('shots.get', { params: { shotId: ids[0]! } })
    const versions = shot.shot.video.versions
    expect(versions).toHaveLength(1)
    expect(shot.shot.video.currentVersionId).toBe(versions[0]!.id)
    expect(versions[0]!.provider?.protocol).toBe('kling-contents')
    // no mute happened and nothing half-written is left in the stored timeline
    const after = (await store.timelines.listByProject('p1')).find((d) => d.episodeId === 'e1')!
    expect(after.revisions.map((r) => r.number)).toEqual([1, 2])
    expect(after.revisions.some((r) => r.reason)).toBe(false)
  })

  it('many shots finishing together: every mute lands, revision numbers are consecutive, nothing is lost or repeated', async () => {
    const { h, ids } = await setup(12)
    const first = await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    expect(first.revision.content.clips.every((c) => c.sourceVolume === 0.3)).toBe(true)
    const jobs = await runAndWait(h, ids)
    expect(jobs.every((j) => j.status === 'succeeded')).toBe(true)

    const view = await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    const numbers = view.revisions.map((r) => r.number)
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1)) // consecutive
    const autos = view.revisions.filter((r) => r.reason === 'native_audio_default')
    // one revision per mute, each naming exactly one clip (each job mutes its own shot), none twice
    const changed = autos.flatMap((r) => r.changedClipIds ?? [])
    expect(new Set(changed).size).toBe(changed.length)
    expect(changed.length).toBe(ids.length)
    expect(autos.length).toBe(ids.length)
    expect(view.head).toBe(1 + ids.length)
    expect(view.revision.content.clips.every((c) => c.sourceVolume === 0)).toBe(true)
    // and every video version is there
    for (const id of ids) {
      const s = await h.client.call('shots.get', { params: { shotId: id } })
      expect(s.shot.video.versions).toHaveLength(1)
    }
  })

  it('the timeline opened while the videos are being made (GET path creating it) never loses a mute', async () => {
    const { h, ids } = await setup(8)
    // the videos are submitted and, at the same moment, the compose page opens the timeline for the first time
    const done = runAndWait(h, ids)
    const early = await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    expect(early.head).toBeGreaterThanOrEqual(1)
    await done
    const view = await h.client.call('timeline.get', { params: { episodeId: 'e1' } })
    // whichever came first, every clip ends up muted: either at creation (video was there) or by the mute step
    expect(view.revision.content.clips).toHaveLength(ids.length)
    expect(view.revision.content.clips.every((c) => c.sourceVolume === 0)).toBe(true)
    const numbers = view.revisions.map((r) => r.number)
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1))
  })
})
