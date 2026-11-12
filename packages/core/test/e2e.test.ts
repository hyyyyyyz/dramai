import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { evaluateArtifacts } from '../src/artifacts/staleness.ts'
import { currentVersion } from '../src/domain/index.ts'
import { loadProjection } from '../src/generation/projection.ts'
import { exportMaterialPackage, ExportBlockedError } from '../src/export/package.ts'
import { buildEpisodeSubtitles } from '../src/export/subtitles.ts'
import { probeMedia, runProcess } from '../src/media/ffmpeg.ts'
import { breakdownEpisode } from '../src/pipeline/breakdown.ts'
import {
  composeEpisode,
  ensureTimeline,
  readEpisodeTimeline,
  RenderBlockedError,
} from '../src/pipeline/compose.ts'
import { confirmCandidate, episodeShots, extractEntities } from '../src/pipeline/entities.ts'
import { enqueueStep } from '../src/pipeline/handlers.ts'
import { requestGeneration } from '../src/pipeline/request.ts'
import { appendRevision, headRevision, secToUs, setBgm, updateClip } from '../src/timeline/index.ts'
import { HERO, locateMedia, makePipelineEnv } from './fakes.ts'
import type { MediaEnv, PipelineEnv } from './fakes.ts'
import { makeWorker, prepareEpisode, runAll } from './helpers-pipeline.ts'
import type { AdmissionTarget } from '../src/admission/index.ts'
import type { Episode, Shot } from '../src/domain/index.ts'

/**
 * 端到端：多章节原文 → 分集 → 分场分镜 → 实体 → 提示词 → 设定图 → 分镜图 → 视频 + 旁白配音 → 时间线 → 成片。
 * LLM 与服务商是替身（LLM 按任务回放，图 / 视频 / 配音由 lavfi 生成）；ffmpeg 是真实的二进制。
 */
let media: MediaEnv | undefined
let env: PipelineEnv
let ep: Episode
let shots: Shot[]
let cutPath: string

const SHORT_SIDE = 270 // 9:16 → 270×480，测试里渲染得快一点

beforeAll(async () => {
  media = await locateMedia()
  if (!media) {
    console.warn('[e2e] SKIPPED: ffmpeg not found')
    return
  }
  env = await makePipelineEnv(media, { aspectRatio: '9:16', videoHasAudio: true })
  ep = await prepareEpisode(env, { chapters: 4, fill: 6 })
  shots = await episodeShots(env.deps.store, ep.id)

  // 1. 设定图
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
  // 2. 分镜图
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
  // 3. 视频（对白由视频模型的原生人声承载，所以用 Seedance 这个自带人声的模型）+ 旁白配音
  await requestGeneration(
    env.deps,
    env.projectId,
    shots.map(
      (s): AdmissionTarget => ({
        target: { kind: 'shot_video', shotId: s.id },
        provider: env.provider('seedance'),
        resolution: '720p',
        confirmUnverified: true,
      }),
    ),
    { confirmUnverified: true },
  )
  await runAll(env)
  const narr = shots.filter((s) => s.narration)
  await requestGeneration(
    env.deps,
    env.projectId,
    narr.map(
      (s): AdmissionTarget => ({
        target: { kind: 'shot_audio', shotId: s.id },
        provider: env.provider('tts'),
        confirmUnverified: true,
      }),
    ),
    { confirmUnverified: true },
  )
}, 240_000)

const real = (name: string, fn: () => Promise<void>, timeout = 120_000) =>
  it(
    name,
    async (ctx) => {
      if (!media) return ctx.skip()
      await fn()
    },
    timeout,
  )

describe('multi-chapter source → finished cut', () => {
  real(
    'the source was long, and the episode has far more shots than v0.4 allowed (12)',
    async () => {
      const material = (await env.deps.store.materials.listByProject(env.projectId))[0]
      expect(material.charCount).toBeGreaterThan(4000)
      expect(material.chapters.length).toBe(4)
      expect(shots.length).toBeGreaterThan(12)
      expect((await env.deps.store.episodes.listByProject(env.projectId)).length).toBe(2)
    },
  )

  real(
    'narration is missing at first: compose is refused with a blocking issue (nothing is rendered)',
    async () => {
      const reading = await readEpisodeTimeline(env.deps, ep.id)
      expect(reading.issues.filter((i) => i.severity === 'blocking').map((i) => i.code)).toContain(
        'NARRATION_AUDIO_MISSING',
      )
      await expect(composeEpisode(env.deps, ep.id)).rejects.toBeInstanceOf(RenderBlockedError)
      await expect(exportMaterialPackage(env.deps, ep.id)).rejects.toBeInstanceOf(
        ExportBlockedError,
      )
      const { job } = await enqueueStep(env.deps, {
        operation: 'compose',
        projectId: env.projectId,
        episodeId: ep.id,
      })
      const worker = makeWorker(env)
      await worker.tick()
      await worker.idle()
      const done = (await env.deps.store.jobs.get(job.id))!
      expect(done).toMatchObject({
        status: 'failed',
        error: { category: 'invalid_input', code: 'RENDER_BLOCKED' },
      })
      expect(await env.ports.files.exists(env.projectId, `output/${ep.id}`)).toBe(false)
    },
  )

  real(
    'once the narration is synthesised, the compose job (render lane) produces a 9:16 cut with audio and subtitles',
    async () => {
      await runAll(env) // 配音任务
      const queue = (await env.deps.store.jobs.list()).filter((j) => j.operation === 'shot_audio')
      expect(queue.length).toBeGreaterThan(2)
      expect(queue.every((j) => j.status === 'succeeded')).toBe(true)
      const reading = await readEpisodeTimeline(env.deps, ep.id)
      expect(reading.issues.filter((i) => i.severity === 'blocking')).toEqual([])

      const { job } = await enqueueStep(env.deps, {
        operation: 'compose',
        projectId: env.projectId,
        episodeId: ep.id,
        params: { subtitles: 'soft', shortSide: SHORT_SIDE },
      })
      expect(job.type).toBe('render')
      await runAll(env)
      const done = (await env.deps.store.jobs.get(job.id))!
      expect(done.status).toBe('succeeded')
      expect(done.result).toMatchObject({ subtitleMode: 'soft' })
      cutPath = String(done.result!.path)

      const local = await env.ports.files.localPath(env.projectId, cutPath)
      const info = await probeMedia(media!.bins, local)
      expect([info.width, info.height]).toEqual([270, 480]) // 项目画幅 9:16，不是写死的 1280×720
      expect(info.hasAudio).toBe(true)
      expect(info.hasVideo).toBe(true)
      // 画面长度 = 摆放结果
      const reading2 = await readEpisodeTimeline(env.deps, ep.id)
      const expected = reading2.placement.totalUs / 1_000_000
      expect(expected).toBeGreaterThan(20)
      expect(Math.abs(info.durationSec! - expected)).toBeLessThan(1.5)
      // 有声：旁白被混进来了（前几秒不是静音）
      const vol = await runProcess(media!.bins.ffmpeg, [
        '-hide_banner',
        '-i',
        local,
        '-vn',
        '-af',
        'volumedetect',
        '-f',
        'null',
        '-',
      ])
      expect(Number(/mean_volume:\s*(-?[\d.]+)/.exec(vol.stderr)![1])).toBeGreaterThan(-50)
      // 软字幕轨
      const streams = await runProcess(media!.bins.ffprobe!, [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type',
        '-of',
        'csv=p=0',
        local,
      ])
      expect(streams.stdout).toContain('subtitle')
    },
  )

  real('everything is registered as a current artifact; the episode is "composed"', async () => {
    const projection = await loadProjection(env.deps.store, env.projectId)
    const reports = evaluateArtifacts(projection)
    const mine = [...reports.values()].filter(
      (r) =>
        r.key.includes(ep.id) ||
        shots.some((s) => r.key.endsWith(s.id)) ||
        r.key.startsWith('asset_sheet'),
    )
    expect(mine.length).toBeGreaterThan(shots.length * 2)
    expect(mine.filter((r) => r.status !== 'current').map((r) => [r.key, r.status])).toEqual([])
    expect(reports.get(`cut:${ep.id}`)!.status).toBe('current')
    expect(reports.get(`subtitles:${ep.id}`)!.status).toBe('current')
    expect((await env.deps.store.episodes.get(ep.id))!.status).toBe('composed')
    // 所有任务都成功
    const jobs = await env.deps.store.jobs.list()
    // 唯一失败的是前面故意触发的那次被拦下的合成
    expect(jobs.filter((j) => j.status === 'failed' && j.error?.code !== 'RENDER_BLOCKED')).toEqual(
      [],
    )
  })

  real(
    'subtitles come from the same placement: the narration text, timed by the measured voice-over',
    async () => {
      const subs = await buildEpisodeSubtitles(env.deps, ep.id)
      expect(subs.source).toBe('timeline')
      const firstNarration = shots.find((s) => s.narration)!.narration!
      expect(subs.srt).toContain(firstNarration)
      expect(subs.vtt.startsWith('WEBVTT')).toBe(true)
      expect(subs.srt).toMatch(/^1\n00:00:\d\d,\d{3} --> /)
    },
  )

  real(
    'the material package has the clips in cut order, the subtitles, the cut and a manifest with artifact statuses',
    async () => {
      const bytes = await exportMaterialPackage(env.deps, ep.id)
      const zip = await JSZip.loadAsync(bytes)
      const names = Object.keys(zip.files)
      expect(names).toEqual(
        expect.arrayContaining(['manifest.json', 'subtitles.srt', 'subtitles.vtt', 'README.txt']),
      )
      expect(names.filter((n) => /^assets\/shot_\d+\.mp4$/.test(n))).toHaveLength(shots.length)
      expect(names.some((n) => n.startsWith('cut.'))).toBe(true)
      expect(names.some((n) => n.includes('_narration.'))).toBe(true)
      const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
      expect(manifest).toMatchObject({
        format: 'dramai-material-package',
        project: { aspectRatio: '9:16' },
        episode: { id: ep.id },
        cut: { status: 'current' },
      })
      expect(manifest.shots).toHaveLength(shots.length)
      expect(manifest.shots[0]).toMatchObject({
        order: 1,
        status: { video: 'current', image: 'current' },
      })
      expect(manifest.shots[0].endSec).toBeGreaterThan(manifest.shots[0].startSec)
      expect(
        manifest.issues.filter((i: { severity: string }) => i.severity === 'blocking'),
      ).toEqual([])
      // 文件内容和库里的一致
      const first = manifest.shots[0]
      const fileBytes = await zip.file(first.videoFile)!.async('uint8array')
      const shot = (await env.deps.store.shots.get(first.shotId))!
      expect(fileBytes.byteLength).toBe(currentVersion(shot.video)!.file.bytes)
    },
  )

  real(
    'editing the timeline (trim, hold, one BGM) changes the cut accordingly, and rollback restores the earlier content',
    async () => {
      const doc = await ensureTimeline(env.deps, ep.id)
      const head = headRevision(doc)
      const first = head.content.clips[0]
      const firstShot = (await env.deps.store.shots.get(first.shotId))!
      const v = currentVersion(firstShot.video)!
      await env.ports.files.put(env.projectId, 'audio/bgm/theme.wav', await env.media.wav(99, 6))
      let content = updateClip(head.content, first.id, {
        trim: { inUs: secToUs(0.5), outUs: secToUs(1.5), basisVersionId: v.id },
        holdUs: secToUs(1),
      })
      content = setBgm(content, {
        id: 'b1',
        bgmId: 'theme.wav',
        startUs: 0,
        inUs: 0,
        outUs: secToUs(6),
        volume: 0.25,
        fadeInUs: secToUs(1),
        fadeOutUs: secToUs(1),
      })
      const edited = appendRevision(doc, {
        content,
        summary: '截取 + 定格 + 配乐',
        author: { kind: 'creator' },
        now: env.deps.clock.now(),
        changedClipIds: [first.id],
      })
      await env.deps.store.timelines.put(edited)

      const before = await readEpisodeTimeline(env.deps, ep.id, 1)
      const after = await readEpisodeTimeline(env.deps, ep.id)
      expect(after.doc.revisions).toHaveLength(2)
      // 第一个片段：截取 1 秒 + 定格 1 秒 = 2 秒（原来是整段 2 秒）；总长不变也行，但摆放里必须体现
      expect(after.placement.clips[0]).toMatchObject({
        srcInUs: secToUs(0.5),
        srcOutUs: secToUs(1.5),
        holdUs: secToUs(1),
      })
      expect(after.placement.bgm).toHaveLength(1)
      expect(after.placement.bgm[0].truncated).toBe(false)
      expect(before.placement.bgm).toHaveLength(0)

      const res = await composeEpisode(env.deps, ep.id, {
        subtitles: 'none',
        shortSide: SHORT_SIDE,
      })
      expect(res.revision).toBe(2)
      const local = await env.ports.files.localPath(env.projectId, res.path)
      const info = await probeMedia(media!.bins, local)
      expect(Math.abs(info.durationSec! - after.placement.totalUs / 1_000_000)).toBeLessThan(1.5)
      expect(info.hasAudio).toBe(true)
      // 成片依据是渲染开始时的时间线快照：之后时间线再变，成片如实判为过期
      const changed = appendRevision(edited, {
        content: updateClip(content, first.id, { holdUs: 0 }),
        summary: '去掉定格',
        author: { kind: 'creator' },
        now: env.deps.clock.now(),
      })
      await env.deps.store.timelines.put(changed)
      const r = evaluateArtifacts(await loadProjection(env.deps.store, env.projectId)).get(
        `cut:${ep.id}`,
      )!
      expect(r.status).toBe('stale')
      expect(r.changes).toEqual([{ kind: 'input', field: 'content' }])
    },
  )
})

describe('after the cut: changing a sheet marks things stale — with reasons — and generates nothing by itself', () => {
  real(
    'regenerating the hero sheet makes the shot images that used it stale and names the asset and versions; videos and the cut are untouched until their inputs are regenerated',
    async () => {
      const hero = (await env.deps.store.assets.listByProject(env.projectId)).find(
        (a) => a.name === HERO,
      )!
      const oldVersion = hero.sheet.currentVersionId!
      const jobsBefore = (await env.deps.store.jobs.list()).length
      await requestGeneration(env.deps, env.projectId, [
        {
          target: { kind: 'asset_sheet', assetId: hero.id },
          provider: env.provider('img'),
          sheetLayout: 'multi_view',
        },
      ])
      await runAll(env)
      expect((await env.deps.store.jobs.list()).length).toBe(jobsBefore + 1) // 只有这一个任务；没有谁自动重生
      const newVersion = (await env.deps.store.assets.get(hero.id))!.sheet.currentVersionId!

      const reports = evaluateArtifacts(await loadProjection(env.deps.store, env.projectId))
      const heroShots = shots.filter((s) => s.entityHints?.characters.includes(HERO))
      expect(heroShots.length).toBeGreaterThan(3)
      for (const s of heroShots) {
        const r = reports.get(`shot_image:${s.id}`)!
        expect(r.status).toBe('stale')
        expect(r.changes).toContainEqual(
          expect.objectContaining({
            kind: 'upstream',
            key: `asset_sheet:${hero.id}`,
            label: HERO,
            from: expect.objectContaining({ versionId: oldVersion }),
            to: expect.objectContaining({ versionId: newVersion }),
          }),
        )
        expect(reports.get(`shot_video:${s.id}`)!.status).toBe('current')
      }
      // 旧的成片文件仍可下载
      expect(await env.ports.files.exists(env.projectId, cutPath)).toBe(true)
    },
  )

  real(
    'the second episode reuses the first episode’s characters instead of creating them again',
    async () => {
      const ep2 = (await env.deps.store.episodes.listByProject(env.projectId)).find(
        (e) => e.id !== ep.id,
      )!
      const assetsBefore = await env.deps.store.assets.listByProject(env.projectId)
      await breakdownEpisode(env.deps, ep2.id)
      const res = await extractEntities(env.deps, ep2.id)
      const linked = res.candidates.filter((c) => c.status === 'linked')
      expect(linked.map((c) => c.name).sort()).toEqual(assetsBefore.map((a) => a.name).sort())
      for (const c of res.candidates.filter((x) => x.status === 'pending'))
        await confirmCandidate(env.deps, c.id, { action: 'accept_new' })
      const assetsAfter = await env.deps.store.assets.listByProject(env.projectId)
      expect(assetsAfter.length).toBe(assetsBefore.length)
      expect(new Set(assetsAfter.map((a) => a.name)).size).toBe(assetsAfter.length)
    },
  )
})

describe('burning subtitles into the picture (runs only where ffmpeg has libass)', () => {
  it('burns the narration subtitles into the cut — the picture really changes, with no system fonts at all', async (ctx) => {
    if (!media) return ctx.skip()
    if (!media.caps.features.subtitleBurnIn) {
      console.warn(
        '[e2e] burn-in test SKIPPED: this ffmpeg has no libass (subtitles filter). CI installs ffmpeg with libass, where it runs.',
      )
      return ctx.skip('ffmpeg has no libass')
    }
    // A machine with no usable CJK font (a bare Linux runner, a container): fontconfig finds nothing but the bundled
    // font that the burn step hands to libass. (libass on macOS uses CoreText and ignores this variable; there the
    // bundled font is what makes the text render too, because the system CJK font cannot be opened by ffmpeg.)
    const emptyDir = await mkdtemp(join(tmpdir(), 'dramai-nofonts-'))
    await writeFile(
      join(emptyDir, 'fonts.conf'),
      `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><cachedir>${emptyDir}/cache</cachedir></fontconfig>`,
    )
    const previousFontconfig = process.env.FONTCONFIG_FILE
    process.env.FONTCONFIG_FILE = join(emptyDir, 'fonts.conf')
    const plain = await composeEpisode(env.deps, ep.id, {
      subtitles: 'none',
      shortSide: SHORT_SIDE,
    })
    const burned = await composeEpisode(env.deps, ep.id, {
      subtitles: 'burn',
      shortSide: SHORT_SIDE,
    })
    if (previousFontconfig === undefined) delete process.env.FONTCONFIG_FILE
    else process.env.FONTCONFIG_FILE = previousFontconfig
    expect(burned.subtitleMode).toBe('burn')
    const dims = async (p: string) =>
      probeMedia(media!.bins, await env.ports.files.localPath(env.projectId, p))
    expect(await dims(burned.path)).toMatchObject({ width: 270, height: 480, hasAudio: true })
    // 字幕在画面下方：同一时刻、同一区域，烧录后和没烧录的画面不同。
    // 取第一条字幕的中点，保证这一刻画面上一定有字幕（第一条字幕从 1.0 秒才开始，取 0.5 秒时画面上本来就没有字）。
    const srt = new TextDecoder().decode(await env.ports.files.get(env.projectId, burned.srtPath!))
    const first = /(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)/.exec(srt)!
    const sec = (h: string, m: string, s: string, ms: string) =>
      +h * 3600 + +m * 60 + +s + +ms / 1000
    const mid = (
      (sec(first[1]!, first[2]!, first[3]!, first[4]!) +
        sec(first[5]!, first[6]!, first[7]!, first[8]!)) /
      2
    ).toFixed(3)
    expect(Number(mid)).toBeGreaterThan(0.5) // the old fixed 0.5 s sat before the first cue
    const frame = async (p: string) =>
      runProcess(media!.bins.ffmpeg, [
        '-hide_banner',
        '-ss',
        mid,
        '-i',
        await env.ports.files.localPath(env.projectId, p),
        '-vf',
        'crop=270:140:0:340,signalstats,metadata=print:key=lavfi.signalstats.YAVG',
        '-frames:v',
        '1',
        '-f',
        'null',
        '-',
      ])
    const yavg = (r: { stderr: string; stdout: string }) =>
      Number(/YAVG=([\d.]+)/.exec(r.stderr + r.stdout)![1])
    expect(
      Math.abs(yavg(await frame(burned.path)) - yavg(await frame(plain.path))),
    ).toBeGreaterThan(0.2)
  }, 120_000)
})
