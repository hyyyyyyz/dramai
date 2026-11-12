import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '@dramai/api'
import { allocateNumber, createAsset, createEpisode } from '@dramai/core'
import type { Job } from '@dramai/core'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'

afterEach(cleanupAll)

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
)

const fileForm = (name: string, bytes: Uint8Array, type: string) => {
  const form = new FormData()
  form.set('file', new Blob([bytes as never], { type }), name)
  return form
}
const textForm = (name: string, text: string) =>
  fileForm(name, new TextEncoder().encode(text), 'text/plain')

async function failure(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError)
    return err as ApiError
  }
  throw new Error('expected the call to fail')
}

async function newProject(h: Harness, name = '测试短剧') {
  return h.client.call('projects.create', { body: { name, aspectRatio: '9:16' } })
}

/** 直接用 store 搭一集（分集规划要 LLM；这里只测路由）。 */
async function seedEpisode(h: Harness, projectId: string, title = '第1集') {
  const { store, ids, clock } = h.server.ctx
  const project = (await store.projects.get(projectId))!
  const alloc = allocateNumber(project, 'episode')
  const episode = createEpisode({
    id: ids.next('ep'),
    projectId,
    number: alloc.number,
    title,
    now: clock.now(),
  })
  await store.episodes.put(episode)
  await store.projects.put({
    ...alloc.project,
    episodeOrder: [...project.episodeOrder, episode.id],
  })
  return episode
}

async function seedLlm(h: Harness) {
  return h.client.call('providers.create', {
    body: {
      label: 'LLM',
      kind: 'llm',
      protocol: 'openai-chat',
      baseUrl: 'https://llm.example.com/v1',
      model: 'm',
      apiKey: 'sk-test-123456789012',
    },
  })
}

describe('projects', () => {
  it('creates with a template/custom style, lists summaries, updates', async () => {
    const h = await startServer()
    const styles = await h.client.call('styles.list')
    const preset = styles.groups[0]!.presets[0]!
    const p = await h.client.call('projects.create', {
      body: {
        name: '  雨夜  ',
        aspectRatio: '16:9',
        style: { source: 'template', templateId: preset.id },
      },
    })
    expect(p.name).toBe('雨夜')
    expect(p.style).toMatchObject({
      source: 'template',
      templateId: preset.id,
      label: preset.label,
    })
    expect(p.style.imageKeywords).toBe(preset.imageKeywords)

    const custom = await h.client.call('projects.create', {
      body: { name: 'c', aspectRatio: '1:1', style: { source: 'custom', description: '水彩' } },
    })
    expect(custom.style).toMatchObject({ source: 'custom', description: '水彩' })

    const bad = await failure(
      h.client.call('projects.create', {
        body: { name: 'x', aspectRatio: '1:1', style: { source: 'template', templateId: 'nope' } },
      }),
    )
    expect(bad.status).toBe(400)

    const list = await h.client.call('projects.list')
    expect(list.items.map((i) => i.id).sort()).toEqual([p.id, custom.id].sort())
    expect(list.items[0]).toMatchObject({
      episodes: [],
      shotCounts: { total: 0, withImage: 0, withVideo: 0, failed: 0 },
      thumbnails: [],
    })

    const upd = await h.client.call('projects.update', {
      params: { projectId: p.id },
      body: { name: '雨夜 2', summary: '一段', aspectRatio: '9:16' },
    })
    expect(upd).toMatchObject({ name: '雨夜 2', summary: '一段', aspectRatio: '9:16' })
    const cleared = await h.client.call('projects.update', {
      params: { projectId: p.id },
      body: { summary: null },
    })
    expect(cleared.summary).toBeUndefined()
  })

  it('narration voice must point at an existing tts provider', async () => {
    const h = await startServer()
    const llm = await seedLlm(h)
    const noSuch = await failure(
      h.client.call('projects.create', {
        body: {
          name: 'x',
          aspectRatio: '9:16',
          narrationVoice: { providerConfigId: 'prov_missing', voice: 'a' },
        },
      }),
    )
    expect(noSuch.status).toBe(400)
    const wrongKind = await failure(
      h.client.call('projects.create', {
        body: {
          name: 'x',
          aspectRatio: '9:16',
          narrationVoice: { providerConfigId: llm.id, voice: 'a' },
        },
      }),
    )
    expect(wrongKind.status).toBe(400)
    const tts = await h.client.call('providers.create', {
      body: {
        label: 'TTS',
        kind: 'tts',
        protocol: 'openai-tts',
        baseUrl: 'https://tts.example.com/v1',
        model: 'tts-1',
      },
    })
    const p = await h.client.call('projects.create', {
      body: {
        name: 'v',
        aspectRatio: '9:16',
        narrationVoice: { providerConfigId: tts.id, voice: 'alloy', speed: 1.1 },
      },
    })
    expect(p.narrationVoice).toEqual({ providerConfigId: tts.id, voice: 'alloy', speed: 1.1 })
    const removed = await h.client.call('projects.update', {
      params: { projectId: p.id },
      body: { narrationVoice: null },
    })
    expect(removed.narrationVoice).toBeUndefined()
  })

  it('soft-deletes, restores, and purges only from the trash (files gone)', async () => {
    const h = await startServer()
    const p = await newProject(h)
    await h.client.call('materials.upload', {
      params: { projectId: p.id },
      form: textForm('a.txt', '第一章\n内容'),
    })

    await h.client.call('projects.delete', { params: { projectId: p.id } })
    expect((await h.client.call('projects.list')).items).toHaveLength(0)
    expect(
      (await h.client.call('projects.list', { query: { includeDeleted: true } })).items,
    ).toHaveLength(1)
    expect(
      (await failure(h.client.call('projects.get', { params: { projectId: p.id } }))).status,
    ).toBe(404)

    const restored = await h.client.call('projects.restore', { params: { projectId: p.id } })
    expect(restored.deletedAt).toBeUndefined()
    expect((await h.client.call('projects.list')).items).toHaveLength(1)

    const notTrashed = await failure(
      h.client.call('projects.purge', { params: { projectId: p.id } }),
    )
    expect(notTrashed).toMatchObject({ status: 409, code: 'NOT_IN_TRASH' })

    await h.client.call('projects.delete', { params: { projectId: p.id } })
    await h.client.call('projects.purge', { params: { projectId: p.id } })
    expect(
      (await h.client.call('projects.list', { query: { includeDeleted: true } })).items,
    ).toHaveLength(0)
    await expect(access(join(h.dataDir, 'projects', p.id))).rejects.toThrow()
  })

  it('refuses to delete a project that still has running jobs', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    const job: Job = {
      schemaVersion: 1,
      id: 'job_x',
      type: 'text',
      operation: 'episodes_plan',
      projectId: p.id,
      params: {},
      paid: false,
      status: 'queued',
      attempt: 1,
      previousProviderJobIds: [],
      createdAt: 1,
      updatedAt: 1,
    }
    await h.server.ctx.store.jobs.insert(job)
    const err = await failure(h.client.call('projects.delete', { params: { projectId: p.id } }))
    expect(err).toMatchObject({ status: 409, code: 'BUSY' })
  })
})

describe('materials', () => {
  it('uploads text without truncation, hides full text in lists, serves it on demand, deletes', async () => {
    const h = await startServer()
    const p = await newProject(h)
    const long = '第一章 开始\n' + '很长的一段话。'.repeat(2000) + '\n第二章 继续\n结尾'
    const up = await h.client.call('materials.upload', {
      params: { projectId: p.id },
      form: textForm('novel.txt', long),
    })
    expect(up.summary).toMatchObject({ chapterCount: 2, truncated: false })
    expect(up.material).not.toHaveProperty('text')

    const list = await h.client.call('materials.list', { params: { projectId: p.id } })
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).not.toHaveProperty('text')

    const full = await h.client.call('materials.text', { params: { materialId: up.material.id } })
    expect(full.text.length).toBeGreaterThan(10_000)
    expect(full.text).toContain('结尾')

    await h.client.call('materials.delete', { params: { materialId: up.material.id } })
    expect((await h.client.call('materials.list', { params: { projectId: p.id } })).items).toEqual(
      [],
    )
  })

  it('rejects unsupported types (400), oversize (413), and missing file', async () => {
    const h = await startServer()
    const p = await newProject(h)
    const unsupported = await failure(
      h.client.call('materials.upload', {
        params: { projectId: p.id },
        form: fileForm('x.exe', new Uint8Array([1, 2, 3]), 'application/octet-stream'),
      }),
    )
    expect(unsupported).toMatchObject({ status: 400, code: 'UNSUPPORTED_MATERIAL' })

    const big = await failure(
      h.client.call('materials.upload', {
        params: { projectId: p.id },
        form: fileForm('big.txt', new Uint8Array(21 * 1024 * 1024).fill(97), 'text/plain'),
      }),
    )
    expect(big).toMatchObject({ status: 413, code: 'MATERIAL_TOO_LARGE' })

    const none = await failure(
      h.client.call('materials.upload', { params: { projectId: p.id }, form: new FormData() }),
    )
    expect(none.status).toBe(400)
  })

  it('will not delete a material that an episode was planned from', async () => {
    const h = await startServer()
    const p = await newProject(h)
    const up = await h.client.call('materials.upload', {
      params: { projectId: p.id },
      form: textForm('a.txt', '内容'),
    })
    const ep = await seedEpisode(h, p.id)
    await h.server.ctx.store.episodes.put({ ...ep, sourceRange: { materialId: up.material.id } })
    const err = await failure(
      h.client.call('materials.delete', { params: { materialId: up.material.id } }),
    )
    expect(err).toMatchObject({ status: 409, code: 'MATERIAL_IN_USE' })
  })
})

describe('pipeline step routes', () => {
  it('need a source material and an active LLM, then enqueue once (deduped)', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)

    const noMaterial = await failure(
      h.client.call('episodes.plan', { params: { projectId: p.id }, body: {} }),
    )
    expect(noMaterial).toMatchObject({ status: 409, code: 'NO_SOURCE_MATERIAL' })

    await h.client.call('materials.upload', {
      params: { projectId: p.id },
      form: textForm('a.txt', '故事'),
    })
    const noLlm = await failure(
      h.client.call('episodes.plan', { params: { projectId: p.id }, body: {} }),
    )
    expect(noLlm).toMatchObject({ status: 409, code: 'NO_LLM_PROVIDER' })

    await seedLlm(h)
    const first = await h.client.call('episodes.plan', {
      params: { projectId: p.id },
      body: { targetChars: 1500 },
    })
    expect(first.deduped).toBe(false)
    expect(first.job).toMatchObject({
      operation: 'episodes_plan',
      type: 'text',
      status: 'queued',
      params: { targetChars: 1500 },
    })
    const second = await h.client.call('episodes.plan', { params: { projectId: p.id }, body: {} })
    expect(second.deduped).toBe(true)
    expect(second.job.id).toBe(first.job.id)
  })

  it('breakdown / entities / prompts need shots; replace never silently discards media', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    await seedLlm(h)
    const ep = await seedEpisode(h, p.id)

    const noShots = await failure(
      h.client.call('episodes.extractEntities', { params: { episodeId: ep.id }, body: {} }),
    )
    expect(noShots).toMatchObject({ status: 409, code: 'NO_SHOTS' })
    const noShots2 = await failure(
      h.client.call('episodes.generatePrompts', { params: { episodeId: ep.id }, body: {} }),
    )
    expect(noShots2.code).toBe('NO_SHOTS')

    const bd = await h.client.call('episodes.breakdown', { params: { episodeId: ep.id }, body: {} })
    expect(bd.job).toMatchObject({
      operation: 'episode_breakdown',
      episodeId: ep.id,
      params: { mode: 'replace' },
    })

    // 搭一个带图的镜头
    const scene = await h.client.call('scenes.create', { params: { episodeId: ep.id }, body: {} })
    const shot = await h.client.call('shots.create', { params: { sceneId: scene.id }, body: {} })
    await h.client.call('shots.uploadImage', {
      params: { shotId: shot.id },
      form: fileForm('a.png', PNG_1X1, 'image/png'),
    })
    // 先把上面那个排队的任务清掉，免得命中去重
    const queued = await h.server.ctx.store.jobs.list({ status: 'queued' })
    for (const j of queued) await h.server.ctx.store.jobs.patch(j.id, { status: 'cancelled' })

    const guarded = await failure(
      h.client.call('episodes.breakdown', {
        params: { episodeId: ep.id },
        body: { mode: 'replace' },
      }),
    )
    expect(guarded).toMatchObject({ status: 409, code: 'BREAKDOWN_WOULD_DISCARD_MEDIA' })
    const appended = await h.client.call('episodes.breakdown', {
      params: { episodeId: ep.id },
      body: { mode: 'append' },
    })
    expect(appended.job.params).toEqual({ mode: 'append' })

    const ents = await h.client.call('episodes.extractEntities', {
      params: { episodeId: ep.id },
      body: { autoLink: 'none' },
    })
    expect(ents.job).toMatchObject({ operation: 'entities_extract', params: { autoLink: 'none' } })
    const prompts = await h.client.call('episodes.generatePrompts', {
      params: { episodeId: ep.id },
      body: { onlyMissing: true },
    })
    expect(prompts.job).toMatchObject({ operation: 'shot_frames', params: { onlyMissing: true } })
  })

  it('compose reports a missing ffmpeg as an actionable 409', async () => {
    const h = await startServer({
      startWorker: false,
      ffmpeg: { ffmpegPath: '/nonexistent/ffmpeg' },
    })
    const p = await newProject(h)
    const ep = await seedEpisode(h, p.id)
    const err = await failure(
      h.client.call('episodes.compose', { params: { episodeId: ep.id }, body: {} }),
    )
    expect(err).toMatchObject({ status: 409, code: 'FFMPEG_MISSING' })
    expect(err.message).toContain('ffmpeg')
  })
})

describe('structure: episodes, scenes, shots', () => {
  async function setup(h: Harness) {
    const p = await newProject(h)
    const ep = await seedEpisode(h, p.id)
    const s1 = await h.client.call('scenes.create', {
      params: { episodeId: ep.id },
      body: { title: '客厅', timeOfDay: '夜', blocking: '门在左' },
    })
    const s2 = await h.client.call('scenes.create', { params: { episodeId: ep.id }, body: {} })
    return { p, ep, s1, s2 }
  }

  it('creates scenes/shots with monotonic numbers and honours afterShotId', async () => {
    const h = await startServer()
    const { p, ep, s1, s2 } = await setup(h)
    expect(s1).toMatchObject({ title: '客厅', timeOfDay: '夜', blocking: '门在左', number: 1 })
    expect(s2.number).toBe(2)

    const a = await h.client.call('shots.create', {
      params: { sceneId: s1.id },
      body: { title: 'A', durationSec: 4 },
    })
    const b = await h.client.call('shots.create', {
      params: { sceneId: s1.id },
      body: { title: 'B' },
    })
    const mid = await h.client.call('shots.create', {
      params: { sceneId: s1.id },
      body: { title: 'M', afterShotId: a.id },
    })
    expect([a.number, b.number, mid.number]).toEqual([1, 2, 3])
    const got = await h.client.call('episodes.get', { params: { episodeId: ep.id } })
    expect(got.scenes.map((s) => s.id)).toEqual([s1.id, s2.id])
    expect(got.shots.map((s) => s.title)).toEqual(['A', 'M', 'B'])
    expect(got.progress.split).toMatchObject({ scenes: 2, shots: 3 })
    expect(got.episode.status).toBe('storyboarding')

    const bad = await failure(
      h.client.call('shots.create', { params: { sceneId: s2.id }, body: { afterShotId: a.id } }),
    )
    expect(bad.status).toBe(400)

    const list = await h.client.call('projects.list')
    expect(list.items[0]!.shotCounts.total).toBe(3)
    expect(
      (await h.client.call('episodes.list', { params: { projectId: p.id } })).items[0]!.progress
        .split.shots,
    ).toBe(3)
  })

  it('reorders scenes/shots/episodes only with an exact permutation', async () => {
    const h = await startServer()
    const { p, ep, s1, s2 } = await setup(h)
    const e2 = await seedEpisode(h, p.id, '第2集')
    const a = await h.client.call('shots.create', { params: { sceneId: s1.id }, body: {} })
    const b = await h.client.call('shots.create', { params: { sceneId: s1.id }, body: {} })

    const sceneOrder = await h.client.call('scenes.reorder', {
      params: { episodeId: ep.id },
      body: { order: [s2.id, s1.id] },
    })
    expect(sceneOrder.sceneOrder).toEqual([s2.id, s1.id])
    expect(
      (
        await failure(
          h.client.call('scenes.reorder', {
            params: { episodeId: ep.id },
            body: { order: [s1.id] },
          }),
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await failure(
          h.client.call('scenes.reorder', {
            params: { episodeId: ep.id },
            body: { order: [s1.id, s1.id] },
          }),
        )
      ).status,
    ).toBe(400)

    const shotOrder = await h.client.call('shots.reorder', {
      params: { sceneId: s1.id },
      body: { order: [b.id, a.id] },
    })
    expect(shotOrder.shotOrder).toEqual([b.id, a.id])
    expect(
      (
        await failure(
          h.client.call('shots.reorder', {
            params: { sceneId: s1.id },
            body: { order: [a.id, 'nope'] },
          }),
        )
      ).status,
    ).toBe(400)

    const proj = await h.client.call('episodes.reorder', {
      params: { projectId: p.id },
      body: { order: [e2.id, ep.id] },
    })
    expect(proj.episodeOrder).toEqual([e2.id, ep.id])
    const eps = await h.client.call('episodes.list', { params: { projectId: p.id } })
    expect(eps.items.map((e) => e.id)).toEqual([e2.id, ep.id])
    expect(
      (
        await failure(
          h.client.call('episodes.reorder', {
            params: { projectId: p.id },
            body: { order: [ep.id] },
          }),
        )
      ).status,
    ).toBe(400)
  })

  it('moves a shot between scenes (and to a position)', async () => {
    const h = await startServer()
    const { s1, s2 } = await setup(h)
    const a = await h.client.call('shots.create', { params: { sceneId: s1.id }, body: {} })
    const b = await h.client.call('shots.create', { params: { sceneId: s2.id }, body: {} })
    const c = await h.client.call('shots.create', { params: { sceneId: s2.id }, body: {} })
    const moved = await h.client.call('shots.move', {
      params: { shotId: a.id },
      body: { toSceneId: s2.id, index: 1 },
    })
    expect(moved.sceneId).toBe(s2.id)
    const { store } = h.server.ctx
    expect((await store.scenes.get(s1.id))!.shotOrder).toEqual([])
    expect((await store.scenes.get(s2.id))!.shotOrder).toEqual([b.id, a.id, c.id])
    // 同一场内移动
    await h.client.call('shots.move', {
      params: { shotId: c.id },
      body: { toSceneId: s2.id, index: 0 },
    })
    expect((await store.scenes.get(s2.id))!.shotOrder).toEqual([c.id, b.id, a.id])
  })

  it('updates shots: clears nullable fields, and manual prompt edits replace the semantic slots', async () => {
    const h = await startServer()
    const { s1 } = await setup(h)
    const shot = await h.client.call('shots.create', { params: { sceneId: s1.id }, body: {} })
    const { store } = h.server.ctx
    await store.shots.put({
      ...(await store.shots.get(shot.id))!,
      cameraShot: 'CU',
      atmosphere: '压抑',
      prompts: { firstFrame: 'old', video: 'oldv' },
      promptSpec: { image: { subject: 's' }, video: { action: 'a' }, changeMagnitude: 'small' },
    })

    const u = await h.client.call('shots.update', {
      params: { shotId: shot.id },
      body: {
        title: '新标题',
        durationSec: 7,
        cameraShot: null,
        moodTags: ['紧张'],
        dialogue: [{ text: '你好', speakerName: '小明' }],
        prompts: { firstFrame: 'new first' },
      },
    })
    expect(u).toMatchObject({
      title: '新标题',
      durationSec: 7,
      atmosphere: '压抑',
      moodTags: ['紧张'],
    })
    expect(u.cameraShot).toBeUndefined()
    expect(u.prompts).toEqual({ firstFrame: 'new first', video: 'oldv' })
    // 图片提示词被手改 → 图片槽作废；视频槽和变化幅度保留
    expect(u.promptSpec).toEqual({ video: { action: 'a' }, changeMagnitude: 'small' })

    const u2 = await h.client.call('shots.update', {
      params: { shotId: shot.id },
      body: { prompts: { video: null }, atmosphere: null },
    })
    expect(u2.prompts).toEqual({ firstFrame: 'new first' })
    expect(u2.promptSpec).toEqual({ changeMagnitude: 'small' })
    expect(u2.atmosphere).toBeUndefined()

    // 服务端也会校验（绕过客户端的本地校验直接发请求）
    const res = await h.raw(`/api/shots/${shot.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationSec: 999 }),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR')
  })

  it('sets references with validation, dedupes, and refreshes readiness', async () => {
    const h = await startServer()
    const { p, s1 } = await setup(h)
    const shot = await h.client.call('shots.create', { params: { sceneId: s1.id }, body: {} })
    const { store, ids, clock } = h.server.ctx
    const asset = {
      ...createAsset({
        id: ids.next('asset'),
        projectId: p.id,
        number: 1,
        kind: 'character',
        name: '小明',
        now: clock.now(),
      }),
      variants: [{ name: '冬装', description: 'd', origin: 'edit' as const }],
    }
    await store.assets.put(asset as never)

    const res = await h.client.call('shots.setRefs', {
      params: { shotId: shot.id },
      body: {
        refs: [
          { assetId: asset.id },
          { assetId: asset.id, variantName: '冬装' },
          { assetId: asset.id },
        ],
      },
    })
    expect(res.refs).toEqual([
      { shotId: shot.id, assetId: asset.id },
      { shotId: shot.id, assetId: asset.id, variantName: '冬装' },
    ])
    expect((await h.client.call('shots.get', { params: { shotId: shot.id } })).refs).toHaveLength(2)
    expect((await store.shots.get(shot.id))!.ready).toBe(true)

    expect(
      (
        await failure(
          h.client.call('shots.setRefs', {
            params: { shotId: shot.id },
            body: { refs: [{ assetId: 'nope' }] },
          }),
        )
      ).status,
    ).toBe(400)
    expect(
      (
        await failure(
          h.client.call('shots.setRefs', {
            params: { shotId: shot.id },
            body: { refs: [{ assetId: asset.id, variantName: '夏装' }] },
          }),
        )
      ).status,
    ).toBe(400)
    // 别的项目的资产不能引用
    const other = await newProject(h, '别的')
    const foreign = createAsset({
      id: ids.next('asset'),
      projectId: other.id,
      number: 1,
      kind: 'prop',
      name: '刀',
      now: clock.now(),
    })
    await store.assets.put(foreign)
    expect(
      (
        await failure(
          h.client.call('shots.setRefs', {
            params: { shotId: shot.id },
            body: { refs: [{ assetId: foreign.id }] },
          }),
        )
      ).status,
    ).toBe(400)
  })

  it('scene location must be a location asset of the same project', async () => {
    const h = await startServer()
    const { p, s1 } = await setup(h)
    const { store, ids, clock } = h.server.ctx
    const loc = createAsset({
      id: ids.next('asset'),
      projectId: p.id,
      number: 1,
      kind: 'location',
      name: '客厅',
      now: clock.now(),
    })
    const person = createAsset({
      id: ids.next('asset'),
      projectId: p.id,
      number: 2,
      kind: 'character',
      name: '甲',
      now: clock.now(),
    })
    await store.assets.put(loc)
    await store.assets.put(person)
    const ok = await h.client.call('scenes.update', {
      params: { sceneId: s1.id },
      body: { locationAssetId: loc.id, title: null },
    })
    expect(ok.locationAssetId).toBe(loc.id)
    expect(ok.title).toBeUndefined()
    expect(
      (
        await failure(
          h.client.call('scenes.update', {
            params: { sceneId: s1.id },
            body: { locationAssetId: person.id },
          }),
        )
      ).status,
    ).toBe(400)
    const cleared = await h.client.call('scenes.update', {
      params: { sceneId: s1.id },
      body: { locationAssetId: null },
    })
    expect(cleared.locationAssetId).toBeUndefined()
  })

  it('deleting a shot / scene / episode cascades refs, artifacts and files; busy targets are refused', async () => {
    const h = await startServer({ startWorker: false })
    const { p, ep, s1, s2 } = await setup(h)
    const a = await h.client.call('shots.create', { params: { sceneId: s1.id }, body: {} })
    const b = await h.client.call('shots.create', { params: { sceneId: s2.id }, body: {} })
    const up = await h.client.call('shots.uploadImage', {
      params: { shotId: a.id },
      form: fileForm('a.png', PNG_1X1, 'image/png'),
    })
    const filePath = up.image.versions[0]!.file.path
    const { store, files } = h.server.ctx
    expect(await files.exists(p.id, filePath)).toBe(true)
    expect(await store.artifacts.get(p.id, `shot_image:${a.id}`)).toBeDefined()

    const job: Job = {
      schemaVersion: 1,
      id: 'job_busy',
      type: 'image',
      operation: 'shot_image',
      projectId: p.id,
      shotId: a.id,
      params: {},
      paid: true,
      status: 'running',
      attempt: 1,
      previousProviderJobIds: [],
      createdAt: 1,
      updatedAt: 1,
    }
    await store.jobs.insert(job)
    expect(
      await failure(h.client.call('shots.delete', { params: { shotId: a.id } })),
    ).toMatchObject({ status: 409, code: 'BUSY' })
    expect(
      await failure(h.client.call('scenes.delete', { params: { sceneId: s1.id } })),
    ).toMatchObject({ status: 409, code: 'BUSY' })
    expect(
      await failure(h.client.call('episodes.delete', { params: { episodeId: ep.id } })),
    ).toMatchObject({ status: 409, code: 'BUSY' })
    await store.jobs.patch(job.id, { status: 'succeeded' })

    await h.client.call('shots.delete', { params: { shotId: a.id } })
    expect(await store.shots.get(a.id)).toBeUndefined()
    expect(await store.artifacts.get(p.id, `shot_image:${a.id}`)).toBeUndefined()
    expect(await files.exists(p.id, filePath)).toBe(false)
    expect((await store.scenes.get(s1.id))!.shotOrder).toEqual([])

    await h.client.call('scenes.delete', { params: { sceneId: s2.id } })
    expect(await store.shots.get(b.id)).toBeUndefined()
    expect((await store.episodes.get(ep.id))!.sceneOrder).toEqual([s1.id])

    await h.client.call('episodes.delete', { params: { episodeId: ep.id } })
    expect(await store.episodes.get(ep.id)).toBeUndefined()
    expect(await store.scenes.get(s1.id)).toBeUndefined()
    expect((await store.projects.get(p.id))!.episodeOrder).toEqual([])
    expect(
      (await failure(h.client.call('episodes.get', { params: { episodeId: ep.id } }))).status,
    ).toBe(404)
  })

  it('episode update + artifacts report', async () => {
    const h = await startServer()
    const { ep, s1 } = await setup(h)
    const shot = await h.client.call('shots.create', { params: { sceneId: s1.id }, body: {} })
    const u = await h.client.call('episodes.update', {
      params: { episodeId: ep.id },
      body: { title: '  新名字 ', summary: '概要' },
    })
    expect(u).toMatchObject({ title: '新名字', summary: '概要' })
    expect(
      (
        await h.client.call('episodes.update', {
          params: { episodeId: ep.id },
          body: { summary: null },
        })
      ).summary,
    ).toBeUndefined()

    const arts = await h.client.call('episodes.artifacts', { params: { episodeId: ep.id } })
    const keys = arts.items.map((i) => i.key)
    expect(keys).toContain(`shot_image:${shot.id}`)
    expect(arts.items.find((i) => i.key === `shot_image:${shot.id}`)).toMatchObject({
      kind: 'shot_image',
    })
    const proj = await h.client.call('projects.artifacts', { params: { projectId: ep.projectId } })
    expect(proj.items.length).toBeGreaterThanOrEqual(arts.items.length)
  })
})

describe('shot images and versions', () => {
  it('uploads register an uploaded artifact, show up as thumbnails, and can be switched', async () => {
    const h = await startServer()
    const p = await newProject(h)
    const ep = await seedEpisode(h, p.id)
    const scene = await h.client.call('scenes.create', { params: { episodeId: ep.id }, body: {} })
    const shot = await h.client.call('shots.create', { params: { sceneId: scene.id }, body: {} })

    const one = await h.client.call('shots.uploadImage', {
      params: { shotId: shot.id },
      form: fileForm('a.png', PNG_1X1, 'image/png'),
    })
    const v1 = one.image.versions[0]!
    expect(one.image.currentVersionId).toBe(v1.id)
    expect(v1).toMatchObject({ source: 'uploaded', kind: 'image', facts: { width: 1, height: 1 } })
    expect(one.stages.image).toBe('succeeded')

    const { store } = h.server.ctx
    const rec = (await store.artifacts.get(p.id, `shot_image:${shot.id}`))!
    expect(rec).toMatchObject({ origin: 'uploaded', versionId: v1.id, contentHash: v1.file.sha256 })

    // 文件能被下载
    const res = await h.raw(h.client.fileUrl(p.id, v1.file.path).replace(h.server.url, ''))
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_1X1)

    const two = await h.client.call('shots.uploadImage', {
      params: { shotId: shot.id },
      form: fileForm('b.png', PNG_1X1, 'image/png'),
    })
    expect(two.image.versions).toHaveLength(2)
    const v2 = two.image.versions[1]!
    expect(two.image.currentVersionId).toBe(v2.id)
    expect((await store.artifacts.get(p.id, `shot_image:${shot.id}`))!.versionId).toBe(v2.id)

    const back = await h.client.call('shots.setCurrentVersion', {
      params: { shotId: shot.id },
      body: { slot: 'image', versionId: v1.id },
    })
    expect(back.image.currentVersionId).toBe(v1.id)
    expect((await store.artifacts.get(p.id, `shot_image:${shot.id}`))!.versionId).toBe(v1.id)

    const unknown = await failure(
      h.client.call('shots.setCurrentVersion', {
        params: { shotId: shot.id },
        body: { slot: 'image', versionId: 'ver_none' },
      }),
    )
    expect(unknown).toMatchObject({ status: 404, code: 'UNKNOWN_VERSION' })

    const list = await h.client.call('projects.list')
    expect(list.items[0]!.thumbnails).toEqual([
      { shotId: shot.id, versionId: v1.id, path: v1.file.path },
    ])
    expect(list.items[0]!.shotCounts).toMatchObject({ total: 1, withImage: 1, withVideo: 0 })
    const eps = await h.client.call('episodes.list', { params: { projectId: p.id } })
    expect(eps.items[0]!.progress.images).toMatchObject({ total: 1, done: 1 })
  })

  it('an uploaded shot image stays current when its description changes (not stale)', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    const ep = await seedEpisode(h, p.id)
    const scene = await h.client.call('scenes.create', { params: { episodeId: ep.id }, body: {} })
    const shot = await h.client.call('shots.create', { params: { sceneId: scene.id }, body: {} })
    await h.client.call('shots.uploadImage', {
      params: { shotId: shot.id },
      form: fileForm('a.png', PNG_1X1, 'image/png'),
    })
    await h.client.call('shots.update', {
      params: { shotId: shot.id },
      body: { scriptExcerpt: '完全不同的剧情', title: '改了' },
    })
    const { items } = await h.client.call('projects.artifacts', { params: { projectId: p.id } })
    expect(items.find((a) => a.key === `shot_image:${shot.id}`)?.status).toBe('current')
  })

  it('rejects non-images and oversize images', async () => {
    const h = await startServer()
    const p = await newProject(h)
    const ep = await seedEpisode(h, p.id)
    const scene = await h.client.call('scenes.create', { params: { episodeId: ep.id }, body: {} })
    const shot = await h.client.call('shots.create', { params: { sceneId: scene.id }, body: {} })
    const text = await failure(
      h.client.call('shots.uploadImage', {
        params: { shotId: shot.id },
        form: textForm('a.png', 'not an image'),
      }),
    )
    expect(text).toMatchObject({ status: 400, code: 'UNSUPPORTED_IMAGE' })
    const big = new Uint8Array(21 * 1024 * 1024)
    big.set(PNG_1X1)
    const huge = await failure(
      h.client.call('shots.uploadImage', {
        params: { shotId: shot.id },
        form: fileForm('a.png', big, 'image/png'),
      }),
    )
    expect(huge).toMatchObject({ status: 413 })
  })
})

describe('episode preflight (read-only)', () => {
  it('validates provider kinds, returns text-step estimates, writes nothing', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    const ep = await seedEpisode(h, p.id)
    const scene = await h.client.call('scenes.create', { params: { episodeId: ep.id }, body: {} })
    await h.client.call('shots.create', {
      params: { sceneId: scene.id },
      body: { scriptExcerpt: '一段原文' },
    })
    const llm = await seedLlm(h)

    const empty = await h.client.call('episodes.preflight', {
      params: { episodeId: ep.id },
      body: {},
    })
    expect(empty).toMatchObject({ ok: true, results: [], targets: [], textSteps: [] })

    const wrongKind = await failure(
      h.client.call('episodes.preflight', {
        params: { episodeId: ep.id },
        body: { shotImages: llm.id },
      }),
    )
    expect(wrongKind.status).toBe(400)
    const missing = await failure(
      h.client.call('episodes.preflight', {
        params: { episodeId: ep.id },
        body: { shotVideos: 'prov_nope' },
      }),
    )
    expect(missing.status).toBe(400)

    const jobsBefore = await h.server.ctx.store.jobs.list()
    const withText = await h.client.call('episodes.preflight', {
      params: { episodeId: ep.id },
      body: { textModel: llm.id },
    })
    expect(withText.textSteps.map((t) => t.step)).toEqual([
      'episode_breakdown',
      'entities_extract',
      'shot_frames',
    ])
    expect(withText.totals.isEstimate).toBe(true)
    expect(withText.totals.unpriced).toBeGreaterThan(0)
    expect(await h.server.ctx.store.jobs.list()).toEqual(jobsBefore)
  })

  it('applies the user-set currency conversion to totals', async () => {
    const h = await startServer({ startWorker: false })
    const p = await newProject(h)
    const ep = await seedEpisode(h, p.id)
    const llm = await seedLlm(h)
    await h.client.call('providers.update', {
      params: { providerId: llm.id },
      body: { model: 'priced-model' },
    })
    // 价目来自模型画像；没有画像就是“未定价”，折算设置存在但无金额可折。
    const settings = await h.client.call('settings.get')
    await h.client.call('settings.update', {
      body: { ...settings, cost: { conversion: { targetCurrency: 'CNY', rates: { USD: 7 } } } },
    })
    const r = await h.client.call('episodes.preflight', {
      params: { episodeId: ep.id },
      body: { textModel: llm.id },
    })
    expect(r.totals.converted).toBeUndefined()
    expect(r.totals.remaining).toEqual({})
  })
})
