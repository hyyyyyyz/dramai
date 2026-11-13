import { afterEach, describe, expect, it } from 'vitest'
import {
  appendVersion,
  buildExpectations,
  buildRecord,
  loadProjection,
  createAsset,
  createEpisode,
  createProject,
  createScene,
  createShot,
  emptySlot,
} from '@dramai/core'
import type { ProviderConfig } from '@dramai/core'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const VIDEO = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]) // not decodable; no ffprobe is configured

const ARK: ProviderConfig = {
  id: 'ark',
  label: 'Seedance 2.0',
  kind: 'video',
  protocol: 'ark-video',
  baseUrl: 'https://ark.fake/api/v3',
  model: 'doubao-seedance-2-0-260128',
  enabled: true,
  secretRef: 'k-ark',
  acceptedUnverified: [
    'mode:i2v',
    'mode:omni_ref',
    'firstFrame',
    'refImages',
    'aspectRatio',
    'duration',
    'resolution',
  ],
}

async function setup() {
  const posts: Array<{ content: Array<{ type: string; role?: string; text?: string }> }> = []
  const h = await startServer({
    startWorker: true,
    workerIntervalMs: 20,
    executor: {
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url)
        if (u === 'https://ark.fake/api/v3/contents/generations/tasks') {
          posts.push(JSON.parse(String(init?.body)))
          return new Response(JSON.stringify({ id: 'cgt-1' }), { status: 200 })
        }
        if (u.endsWith('/tasks/cgt-1'))
          return new Response(
            JSON.stringify({
              status: 'succeeded',
              content: { video_url: 'https://cdn.fake/v.mp4' },
            }),
            { status: 200 },
          )
        if (u === 'https://cdn.fake/v.mp4')
          return new Response(VIDEO, { status: 200, headers: { 'content-type': 'video/mp4' } })
        return new Response('not found', { status: 404 })
      }) as typeof globalThis.fetch,
      sleep: async () => {},
    },
  })
  const { store, secrets, settings, files } = h.server.ctx
  await secrets.set('k-ark', 'ark-key-123456')
  await store.providers.put(ARK)
  await settings.patchActive('video', 'ark')
  const now = Date.now()
  const put = async (path: string) => {
    const info = await files.put('p1', path, new Uint8Array(PNG))
    return { path, mime: 'image/png', bytes: info.bytes, sha256: info.sha256 }
  }
  const version = async (id: string, path: string) =>
    appendVersion(emptySlot(), {
      id,
      kind: 'image',
      source: 'generated',
      createdAt: 1,
      file: await put(path),
    })
  let hero = createAsset({
    id: 'a1',
    projectId: 'p1',
    number: 1,
    kind: 'character',
    name: '林夏',
    now,
    description: '女主',
  })
  hero = { ...hero, sheet: await version('a1_v1', 'images/a1/v1.png') }
  const shot = {
    ...createShot({ id: 'sh1', projectId: 'p1', sceneId: 's1', number: 1, now, durationSec: 5 }),
    prompts: { keyFrame: '@{a1} 站在街头', video: '镜头缓慢推近' },
    image: await version('sh1_v1', 'images/sh1/v1.png'),
  }
  let project = createProject({ id: 'p1', name: '测试', aspectRatio: '9:16', now })
  const episode = {
    ...createEpisode({ id: 'e1', projectId: 'p1', number: 1, title: '一', now }),
    sceneOrder: ['s1'],
  }
  const scene = {
    ...createScene({ id: 's1', projectId: 'p1', episodeId: 'e1', number: 1, now }),
    shotOrder: ['sh1'],
  }
  project = { ...project, episodeOrder: ['e1'] }
  await store.projects.put(project)
  await store.assets.put(hero)
  await store.episodes.put(episode)
  await store.scenes.put(scene)
  await store.shots.put(shot)
  await store.shotRefs.replaceForShot('sh1', [{ shotId: 'sh1', assetId: 'a1' }])
  // the artifact records a real run leaves behind: the sheet and the shot image (the video is registered on top of them)
  const exps = buildExpectations(await loadProjection(store, 'p1'))
  const recs = new Map()
  for (const [key, file, versionId] of [
    ['asset_sheet:a1', hero.sheet.versions[0]!.file, 'a1_v1'],
    ['shot_image:sh1', shot.image.versions[0]!.file, 'sh1_v1'],
  ] as const) {
    const rec = buildRecord({
      projectId: 'p1',
      expectation: exps.get(key)!,
      upstreamRecords: recs,
      file,
      versionId,
      now,
    })
    recs.set(key, rec)
    await store.artifacts.put(rec)
  }
  return { h, posts }
}

const item = (videoRefs?: boolean) => ({
  target: { kind: 'shot_video' as const, shotId: 'sh1' },
  resolution: '720p',
  confirmUnverified: true,
  ...(videoRefs === undefined ? {} : { videoRefs }),
})

describe('videoRefs through the API', () => {
  it('preflight tells the UI what happens to the first frame, with the switch off and on', async () => {
    const { h } = await setup()
    const off = await h.client.call('generate.preflight', {
      params: { projectId: 'p1' },
      body: { items: [item()] },
    })
    expect(off.results[0]).toMatchObject({
      status: 'accepted',
      video: {
        mode: 'i2v',
        refsRequested: false,
        frame: 'strict_first_frame',
        ifRefsOn: 'frame_as_reference', // "turning references on would give up the strict first frame"
        firstFrameWithRefs: 'unsupported',
      },
    })
    const on = await h.client.call('generate.preflight', {
      params: { projectId: 'p1' },
      body: { items: [item(true)] },
    })
    expect(on.results[0]).toMatchObject({
      status: 'accepted',
      video: {
        mode: 'omni_ref',
        refsRequested: true,
        frame: 'as_reference',
        referenceCount: 2,
        droppedReferences: 0,
      },
    })
    expect(on.results[0]!.warnings.map((w) => w.code)).toContain(
      'FIRST_FRAME_REPLACED_BY_REFERENCE',
    )
    // exec 21: with references on the plan lists which ones; with the switch off those fields are absent
    expect(on.results[0]!.video).toMatchObject({
      references: [
        { order: 1, role: 'start_frame' },
        { order: 2, role: 'character', assetId: 'a1', assetName: '林夏' },
      ],
      dropped: [],
      startFrame: { use: 'reference' },
    })
    for (const key of ['references', 'dropped', 'startFrame'])
      expect(off.results[0]!.video, key).not.toHaveProperty(key)
  })

  it('submit with the switch on: the job parameter, the request body and the record on the version', async () => {
    const { h, posts } = await setup()
    const pre = await h.client.call('generate.preflight', {
      params: { projectId: 'p1' },
      body: { items: [item(true)] },
    })
    const res = await h.client.call('generate.submit', {
      params: { projectId: 'p1' },
      body: { items: [item(true)], confirmUnverified: true },
    })
    expect(res.succeeded).toHaveLength(1)
    const jobId = res.succeeded[0]!.jobId
    // wait for the worker
    for (let i = 0; i < 200; i++) {
      const job = await h.client.call('jobs.get', { params: { jobId } })
      if (job.status === 'succeeded' || job.status === 'failed') {
        expect(job.status, JSON.stringify(job.error)).toBe('succeeded')
        expect((job.params as { videoRefs?: boolean }).videoRefs).toBe(true)
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(posts).toHaveLength(1)
    const roles = (posts[0]!.content as Array<{ role?: string; type: string }>).map(
      (c) => c.role ?? c.type,
    )
    expect(roles).toEqual(['text', 'reference_image', 'reference_image'])
    expect(posts[0]!.content[0].text).toContain('图1是开场画面')
    expect(posts[0]!.content[0].text).toContain('图2是林夏的参考图')
    const shot = await h.client.call('shots.get', { params: { shotId: 'sh1' } })
    const v = shot.shot.video.versions.at(-1)!
    expect(v.usedReferences).toMatchObject({
      frame: 'as_reference',
      trimmed: 0,
      references: [
        { role: 'start_frame' },
        { role: 'character', assetId: 'a1', assetName: '林夏' },
      ],
    })
    expect(v.usedReferences!.references[1]!.sha256).toMatch(/^[0-9a-f]{64}$/)
    // exec 21: the list the preflight showed (through the same contract) is the list that was used
    expect(pre.results[0]!.video!.references).toEqual(v.usedReferences!.references)
    expect(v.usedReferences!.references.map((r) => r.order)).toEqual([1, 2])
  })

  it("submit with the switch off sends today's request: first_frame, no parameter, no record", async () => {
    const { h, posts } = await setup()
    const res = await h.client.call('generate.submit', {
      params: { projectId: 'p1' },
      body: { items: [item()], confirmUnverified: true },
    })
    const jobId = res.succeeded[0]!.jobId
    for (let i = 0; i < 200; i++) {
      const job = await h.client.call('jobs.get', { params: { jobId } })
      if (job.status === 'succeeded' || job.status === 'failed') {
        expect(job.status, JSON.stringify(job.error)).toBe('succeeded')
        expect(job.params).not.toHaveProperty('videoRefs')
        break
      }
      await new Promise((r) => setTimeout(r, 20))
    }
    const roles = (posts[0]!.content as Array<{ role?: string; type: string }>).map(
      (c) => c.role ?? c.type,
    )
    expect(roles).toEqual(['text', 'first_frame'])
    const shot = await h.client.call('shots.get', { params: { shotId: 'sh1' } })
    expect(shot.shot.video.versions.at(-1)!.usedReferences).toBeUndefined()
  })
})
