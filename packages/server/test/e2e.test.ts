import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupAll, startServer } from './helpers.ts'
import type { Harness } from './helpers.ts'
import { addProviders, prepareEpisodeViaApi, waitJobsIdle } from './api-flow.ts'
import { fakeLlm, fakeProviders, locateMedia, mediaFactory } from './fakes.ts'
import type { MediaEnv } from './fakes.ts'

/**
 * 端到端（只走 HTTP 接口）：建项目 → 上传原文 → 分集 → 分镜 → 实体 → 提示词 → 设定图 → 分镜图 →
 * 视频 + 旁白 → 时间线 → 合成 → 下载成片 / 字幕 / 素材包。LLM 与服务商是替身，ffmpeg 是真的。
 */
let media: MediaEnv | undefined
let h: Harness
let projectId: string
let episodeId: string
let shotIds: string[] = []
let providerIds: Record<string, string>

beforeAll(async () => {
  media = await locateMedia()
  if (!media) {
    console.warn('[server e2e] SKIPPED: ffmpeg not found')
    return
  }
  const providers = fakeProviders(mediaFactory(media.bins), { videoHasAudio: true })
  h = await startServer({
    llm: fakeLlm().client,
    executor: { fetch: providers.fetch, sleep: async () => {} },
    workerIntervalMs: 20,
  })
  providerIds = await addProviders(h)
  const prepared = await prepareEpisodeViaApi(h, providerIds)
  projectId = prepared.projectId
  episodeId = prepared.episode.id
  const detail = await h.client.call('episodes.get', { params: { episodeId } })
  shotIds = detail.shots.map((s) => s.id)
}, 240_000)

afterAll(cleanupAll)

const real = (name: string, fn: () => Promise<void>, timeout = 120_000) =>
  it(
    name,
    async (ctx) => {
      if (!media) return ctx.skip()
      await fn()
    },
    timeout,
  )

describe('create project → export the cut, only through the API', () => {
  real('the long source became several episodes and far more than 12 shots', async () => {
    const list = await h.client.call('projects.list', { query: {} })
    const item = list.items.find((p) => p.id === projectId)!
    expect(item.episodes.length).toBeGreaterThanOrEqual(2)
    expect(shotIds.length).toBeGreaterThan(12)
    const materials = await h.client.call('materials.list', { params: { projectId } })
    expect(materials.items[0]!.charCount).toBeGreaterThan(4000)
  })

  real('generates sheets, shot images, videos and narration through generate.submit', async () => {
    const { items: assets } = await h.client.call('assets.list', { params: { projectId } })
    const sheets = await h.client.call('generate.submit', {
      params: { projectId },
      body: {
        items: assets.map((a) => ({ target: { kind: 'asset_sheet' as const, assetId: a.id } })),
      },
    })
    expect(sheets.failed).toEqual([])
    expect(sheets.blocked).toEqual([])
    await waitJobsIdle(h, projectId)

    await h.client.call('generate.submit', {
      params: { projectId },
      body: {
        items: shotIds.map((shotId) => ({ target: { kind: 'shot_image' as const, shotId } })),
      },
    })
    await waitJobsIdle(h, projectId)

    await h.client.call('generate.submit', {
      params: { projectId },
      body: {
        items: shotIds.map((shotId) => ({
          target: { kind: 'shot_video' as const, shotId },
          providerId: providerIds.seedance,
          resolution: '720p',
        })),
        confirmUnverified: true,
      },
    })
    await waitJobsIdle(h, projectId)

    const detail = await h.client.call('episodes.get', { params: { episodeId } })
    const narrated = detail.shots.filter((s) => s.narration)
    await h.client.call('generate.submit', {
      params: { projectId },
      body: {
        items: narrated.map((s) => ({ target: { kind: 'shot_audio' as const, shotId: s.id } })),
        confirmUnverified: true,
      },
    })
    await waitJobsIdle(h, projectId)
  })

  real('the timeline has no blocking issues, then compose produces a cut', async () => {
    const view = await h.client.call('timeline.get', { params: { episodeId }, query: {} })
    expect(view.issues.filter((i) => i.severity === 'blocking')).toEqual([])
    const { job } = await h.client.call('episodes.compose', {
      params: { episodeId },
      body: { shortSide: 270, subtitles: 'soft' },
    })
    expect(job.operation).toBe('compose')
    await waitJobsIdle(h, projectId)
    const done = await h.client.call('jobs.get', { params: { jobId: job.id } })
    expect(done.status).toBe('succeeded')
  })

  real('downloads the cut with Range support, plus SRT/VTT and the material package', async () => {
    const cut = await h.raw(`/api/episodes/${episodeId}/export/cut`)
    expect(cut.status).toBe(200)
    expect(cut.headers.get('content-type')).toBe('video/mp4')
    const whole = new Uint8Array(await cut.arrayBuffer())
    expect(whole.byteLength).toBeGreaterThan(1000)
    // MP4: 'ftyp' box
    expect(Buffer.from(whole.slice(4, 8)).toString()).toBe('ftyp')

    const part = await h.raw(`/api/episodes/${episodeId}/export/cut`, {
      headers: { Range: 'bytes=0-99' },
    })
    expect(part.status).toBe(206)
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(whole.slice(0, 100))

    const srt = await (await h.raw(`/api/episodes/${episodeId}/export/srt`)).text()
    expect(srt).toMatch(/^1\n\d\d:\d\d:\d\d,\d{3} --> /)
    const vtt = await (await h.raw(`/api/episodes/${episodeId}/export/vtt`)).text()
    expect(vtt.startsWith('WEBVTT')).toBe(true)

    const pkg = await h.raw(`/api/episodes/${episodeId}/export/package`)
    expect(pkg.status).toBe(200)
    const zip = await JSZip.loadAsync(new Uint8Array(await pkg.arrayBuffer()))
    expect(
      Object.keys(zip.files).some((n) => n.endsWith('manifest.json') || n.includes('manifest')),
    ).toBe(true)
  })

  real('artifact reports and the project list reflect the finished episode', async () => {
    const { items } = await h.client.call('episodes.artifacts', { params: { episodeId } })
    const cut = items.find((a) => a.key === `cut:${episodeId}`)
    expect(cut?.status).toBe('current')
    const list = await h.client.call('projects.list', { query: {} })
    const item = list.items.find((p) => p.id === projectId)!
    expect(item.shotCounts.withVideo).toBeGreaterThan(0)
    expect(item.thumbnails.length).toBeGreaterThan(0)
    // 缩略图能通过文件接口取到
    const t = item.thumbnails[0]!
    const img = await h.raw(`/api/projects/${projectId}/files/${t.path}`)
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toContain('image/')
  })

  real('no API response anywhere contains a provider key', async () => {
    const KEY = 'sk-test-img-0123456789'
    const paths = [
      '/api/providers',
      '/api/settings',
      '/api/system',
      `/api/jobs?projectId=${projectId}`,
      `/api/projects/${projectId}/artifacts`,
    ]
    for (const p of paths) expect(await (await h.raw(p)).text()).not.toContain(KEY)
  })
})
