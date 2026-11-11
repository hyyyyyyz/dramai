import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@dramai/api'
import { createServer } from '@dramai/server'
import type { DramaiServer } from '@dramai/server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { startMockProviders } from '../src/index.ts'
import type { MockProviders } from '../src/index.ts'
import { addProviders, waitJobs } from './flow.ts'
import { STORY } from './story.ts'

/**
 * 端到端：真实的本地服务 + 模拟服务商（走真实协议、没有任何注入的替身），只通过 HTTP 接口，
 * 把一篇真实的中文短篇从上传原文一路跑到成片。
 */
let mock: MockProviders
let server: DramaiServer
let api: ReturnType<typeof createClient>
let dataDir: string
let ffmpegOk = false

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'dramai-mock-e2e-'))
  mock = await startMockProviders({ config: { videoMs: 150, streamChunkMs: 0 } })
  server = await createServer({
    dataDir,
    port: 0,
    validateResponses: true,
    workerIntervalMs: 20,
    executor: { sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))) },
    demo: { notice: '演示模式（测试）' },
    logger: { error: () => {} },
  })
  api = createClient({ baseUrl: server.url })
  ffmpegOk = (await api.call('system.get')).ffmpeg.ok
}, 60_000)

afterAll(async () => {
  await server?.close({ graceful: false })
  await mock?.close()
  await rm(dataDir, { recursive: true, force: true })
})

const real = (name: string, fn: () => Promise<void>, timeout = 180_000) =>
  it(
    name,
    async (ctx) => {
      if (!ffmpegOk) return ctx.skip()
      await fn()
    },
    timeout,
  )

let projectId = ''
let episodeId = ''

describe('a Chinese short story, upload → exported cut, through the mock providers', () => {
  it('system info says it is a demo', async () => {
    const info = await api.call('system.get')
    expect(info.demo).toEqual({ active: true, notice: '演示模式（测试）' })
  })

  real('plans episodes and breaks one down into scenes and shots that match the text', async () => {
    const ids = await addProviders(api, mock.url)
    const project = await api.call('projects.create', {
      body: {
        name: '旧信',
        aspectRatio: '9:16',
        style: { source: 'template', templateId: 'mystery_realistic' },
        narrationDelivery: 'tts',
        narrationVoice: { providerConfigId: ids.tts!, voice: 'alloy', speed: 1 },
      },
    })
    projectId = project.id
    const form = new FormData()
    form.set('file', new File([STORY], '旧信.txt', { type: 'text/plain' }))
    const up = await api.call('materials.upload', { params: { projectId }, form })
    expect(up.summary.chapterCount).toBe(4)

    await api.call('episodes.plan', { params: { projectId }, body: { targetChars: 600 } })
    await waitJobs(api, projectId)
    const { items: episodes } = await api.call('episodes.list', { params: { projectId } })
    expect(episodes.length).toBeGreaterThanOrEqual(2)
    expect(episodes.every((e) => e.title.length > 0 && e.title.length <= 12)).toBe(true)

    episodeId = [...episodes].sort((a, b) => a.number - b.number)[0]!.id
    await api.call('episodes.breakdown', { params: { episodeId }, body: {} })
    await waitJobs(api, projectId)
    const detail = await api.call('episodes.get', { params: { episodeId } })
    expect(detail.shots.length).toBeGreaterThanOrEqual(6)
    // 内容和输入对得上：分镜原文来自这篇故事，对白被认出来，说话人是故事里的人
    const text = detail.shots.map((s) => s.scriptExcerpt).join('')
    expect(text).toContain('老茶馆')
    const dialogue = detail.shots.flatMap((s) => s.dialogue)
    expect(dialogue.length).toBeGreaterThanOrEqual(3)
    const speakers = new Set(dialogue.map((d) => d.speakerName))
    expect(
      ['沈青禾', '阿福', '周望山'].filter((n) => speakers.has(n)).length,
    ).toBeGreaterThanOrEqual(2)
    expect(detail.scenes.length).toBeGreaterThanOrEqual(1)
  })

  real(
    'extracts the people, place and props of the story and spots the costume variant',
    async () => {
      await api.call('episodes.extractEntities', { params: { episodeId }, body: {} })
      await waitJobs(api, projectId)
      const { items: candidates } = await api.call('candidates.list', {
        params: { projectId },
        query: {},
      })
      const byKind = (k: string) => candidates.filter((c) => c.kind === k).map((c) => c.name)
      expect(byKind('character')).toEqual(expect.arrayContaining(['沈青禾', '周望山', '阿福']))
      expect(byKind('location').some((n) => n.includes('茶馆'))).toBe(true)
      expect(byKind('prop').length).toBeGreaterThanOrEqual(1)
      // 把握度有高有低（界面上能看到三档）
      expect(new Set(candidates.map((c) => c.confidenceBand)).size).toBeGreaterThanOrEqual(2)

      for (const c of candidates.filter((x) => x.status === 'pending')) {
        await api.call('candidates.accept', {
          params: { candidateId: c.id },
          body: { createVariants: c.variants.map((v) => v.variantKey) },
        })
      }
      const { items: assets } = await api.call('assets.list', { params: { projectId } })
      const hero = assets.find((a) => a.name === '沈青禾')!
      expect(hero.variants.map((v) => v.name)).toContain('蓑衣')

      await api.call('episodes.generatePrompts', { params: { episodeId }, body: {} })
      await waitJobs(api, projectId)
      const detail = await api.call('episodes.get', { params: { episodeId } })
      expect(detail.shots.every((s) => (s.prompts.keyFrame ?? '').length > 0)).toBe(true)
    },
  )

  real(
    'generates sheets, shot images, videos and narration, composes, and downloads the cut',
    async () => {
      const { items: assets } = await api.call('assets.list', { params: { projectId } })
      const detail = await api.call('episodes.get', { params: { episodeId } })
      const shotIds = detail.shots.map((s) => s.id)

      // 设定图：先每个资产一张，再基于它做每个形态（变体）的图
      const submitSheets = async (
        targets: Array<{ kind: 'asset_sheet'; assetId: string; variantName?: string }>,
      ) => {
        const res = await api.call('generate.submit', {
          params: { projectId },
          body: { items: targets.map((target) => ({ target })) },
        })
        expect(res.failed).toEqual([])
        expect(res.blocked.map((b) => b.reasons)).toEqual([])
        await waitJobs(api, projectId)
      }
      await submitSheets(assets.map((a) => ({ kind: 'asset_sheet' as const, assetId: a.id })))
      await submitSheets(
        assets.flatMap((a) =>
          a.variants.map((v) => ({
            kind: 'asset_sheet' as const,
            assetId: a.id,
            variantName: v.name,
          })),
        ),
      )

      const images = await api.call('generate.submit', {
        params: { projectId },
        body: {
          items: shotIds.map((shotId) => ({ target: { kind: 'shot_image' as const, shotId } })),
        },
      })
      expect(images.blocked.map((b) => b.reasons)).toEqual([])
      await waitJobs(api, projectId)

      const video = await api.call('generate.submit', {
        params: { projectId },
        body: {
          items: shotIds.map((shotId) => ({ target: { kind: 'shot_video' as const, shotId } })),
          confirmUnverified: true,
        },
      })
      expect(video.failed).toEqual([])
      expect(video.blocked.map((b) => [b.targetId, b.reasons])).toEqual([])
      await waitJobs(api, projectId)

      const narrated = detail.shots.filter((s) => s.narration)
      if (narrated.length > 0) {
        await api.call('generate.submit', {
          params: { projectId },
          body: {
            items: narrated.map((s) => ({ target: { kind: 'shot_audio' as const, shotId: s.id } })),
            confirmUnverified: true,
          },
        })
        await waitJobs(api, projectId)
      }

      const view = await api.call('timeline.get', { params: { episodeId }, query: {} })
      expect(view.issues.filter((i) => i.severity === 'blocking')).toEqual([])
      await api.call('episodes.compose', {
        params: { episodeId },
        body: { shortSide: 270, subtitles: 'soft' },
      })
      await waitJobs(api, projectId)

      const cut = await fetch(`${server.url}/api/episodes/${episodeId}/export/cut`)
      expect(cut.status).toBe(200)
      const bytes = new Uint8Array(await cut.arrayBuffer())
      expect(Buffer.from(bytes.slice(4, 8)).toString()).toBe('ftyp')
      expect(bytes.byteLength).toBeGreaterThan(5000)
      const srt = await (await fetch(`${server.url}/api/episodes/${episodeId}/export/srt`)).text()
      expect(srt).toMatch(/^1\n/)
      const pkg = await fetch(`${server.url}/api/episodes/${episodeId}/export/package`)
      expect(
        Object.keys((await JSZip.loadAsync(new Uint8Array(await pkg.arrayBuffer()))).files).length,
      ).toBeGreaterThan(3)

      // 模拟服务商确实收到了各类请求
      const counts = mock.counts()
      expect(counts.llm).toBeGreaterThan(3)
      expect(counts.image).toBeGreaterThanOrEqual(assets.length + shotIds.length)
      expect(counts.video).toBeGreaterThanOrEqual(shotIds.length)
    },
  )

  real('the streamed text of a text step reaches the SSE channel', async () => {
    const events: string[] = []
    const ac = new AbortController()
    const res = await fetch(`${server.url}/api/events`, { signal: ac.signal })
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          events.push(dec.decode(value))
        }
      } catch {
        /* aborted */
      }
    })()
    await new Promise((r) => setTimeout(r, 100))
    await api.call('episodes.generatePrompts', {
      params: { episodeId },
      body: { onlyMissing: false },
    })
    await waitJobs(api, projectId)
    await new Promise((r) => setTimeout(r, 200))
    ac.abort()
    const all = events.join('')
    expect(all).toContain('event: text.delta')
  })
})
