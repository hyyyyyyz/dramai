import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildExpectations, buildRecord, evaluateArtifacts } from '../artifacts/staleness.ts'
import { currentVersion } from '../domain/media.ts'
import type { Episode } from '../domain/project.ts'
import type { Shot } from '../domain/shot.ts'
import type { TimelineDocument } from '../domain/timeline.ts'
import { countChars } from '../parsers/chapters.ts'
import { nativeAudioDefaultVolume, providerConfigMap } from './native-audio.ts'
import { loadProjection } from '../generation/projection.ts'
import type { ProjectProjection } from '../generation/projection.ts'
import { deriveEpisodeStatus, episodeProgress } from '../generation/progress.ts'
import { JobFailure } from '../jobs/worker.ts'
import type { JobContext, JobHandler } from '../jobs/worker.ts'
import {
  concatClips,
  mixTracks,
  normalizeClip,
  burnSubtitles,
  embedSoftSubtitles,
} from '../media/render.ts'
import { bundledFontsDir, SUBTITLE_FONT_FAMILY } from '../data-dir.ts'
import type { MixTrack, RenderEnv, SubtitleMode, SubtitleStyle } from '../media/render.ts'
import { probeMedia, requireFeature } from '../media/ffmpeg.ts'
import { buildSrt, buildVtt } from '../subtitles/index.ts'
import type { Cue } from '../subtitles/index.ts'
import {
  appendRevision,
  buildInitialContent,
  createTimeline,
  headRevision,
  secToUs,
  usToSec,
} from '../timeline/document.ts'
import { placeTimeline } from '../timeline/placement.ts'
import type { ClipFacts, Placement } from '../timeline/placement.ts'
import { hasBlockingIssues, readTimelineIssues } from '../timeline/issues.ts'
import type { TimelineIssue } from '../timeline/issues.ts'
import type { PipelineDeps } from './deps.ts'
import { episodeShots } from './entities.ts'
import { notFoundError } from '../errors.ts'
import { removeRetry } from '../util/fs.ts'

/**
 * 步骤 7：合成。从时间线文档出发——摆放（纯函数）驱动 ffmpeg 渲染。
 * 成片、字幕导出、素材包都用同一份摆放结果。
 */

export class RenderBlockedError extends Error {
  readonly issues: TimelineIssue[]
  constructor(issues: TimelineIssue[]) {
    super(
      `时间线有阻断问题，不能渲染：${issues
        .filter((i) => i.severity === 'blocking')
        .map((i) => i.message)
        .join('；')}`,
    )
    this.name = 'RenderBlockedError'
    this.issues = issues
  }
}

export const bgmPath = (bgmId: string) => `audio/bgm/${bgmId}`

export { nativeAudioDefaultVolume } from './native-audio.ts'

/**
 * 取得（或按镜头顺序创建）一集的时间线。
 *
 * 创建是一个事务：读镜头、算每个片段的默认音量、写入时间线是原子的，和视频任务保存新版本的事务互斥。
 * 否则一个关不掉原声的视频（可灵）刚好在“读镜头”和“写时间线”之间保存的话，这个镜头既赶不上“创建片段时按当时的视频算默认值”，
 * 又因为那一刻还没有时间线而被“第一次拿到视频”的钩子跳过，自动静音就丢了。现在两种先后都不会漏：
 * 时间线先建好 → 视频保存后的静音步骤看得到它；视频先保存 → 建时间线时就按这个视频算出 0。
 */
export async function ensureTimeline(
  deps: PipelineDeps,
  episodeId: string,
): Promise<TimelineDocument> {
  const episode = await deps.store.episodes.get(episodeId)
  if (!episode) throw notFoundError('episode', episodeId)
  const find = async (store: PipelineDeps['store']) =>
    (await store.timelines.listByProject(episode.projectId)).find((t) => t.episodeId === episodeId)
  const existing = await find(deps.store)
  if (existing) return existing
  const configs = await providerConfigMap(deps)
  return deps.store.transaction(async (tx) => {
    const again = await find(tx) // 等锁期间别人可能已经建好了
    if (again) return again
    const project = (await tx.projects.get(episode.projectId))!
    const shots = await episodeShots(tx, episodeId)
    const init = buildInitialContent(shots, project.narrationDelivery, 1, (s) =>
      nativeAudioDefaultVolume(s, deps.catalog.models, configs),
    )
    const doc = createTimeline({
      id: deps.ids.next('tl'),
      projectId: project.id,
      episodeId,
      name: episode.title,
      content: init.content,
      nextClipNumber: init.nextClipNumber,
      author: { kind: 'creator' },
      now: deps.clock.now(),
    })
    await tx.timelines.put(doc)
    return doc
  })
}

/**
 * 镜头新增 / 删除 / 重排后，把时间线同步成当前的镜头顺序：已有片段保留（含截取、音量等设置），
 * 新镜头追加初始片段，已删除镜头的片段去掉。变了才追加一个修订。
 * 和创建一样是一个事务：读镜头、算新片段的默认音量、写回是原子的（理由见 `ensureTimeline`）。
 */
export async function syncTimelineWithShots(
  deps: PipelineDeps,
  episodeId: string,
): Promise<TimelineDocument> {
  const configs = await providerConfigMap(deps)
  return deps.store.transaction(async (tx) => {
    const doc = await ensureTimeline(deps, episodeId)
    const episode = (await tx.episodes.get(episodeId))!
    const project = (await tx.projects.get(episode.projectId))!
    const shots = await episodeShots(tx, episodeId)
    const head = headRevision(doc)
    const have = new Map(head.content.clips.map((c) => [c.shotId, c]))
    let next = doc.nextClipNumber
    const fresh = buildInitialContent(
      shots.filter((s) => !have.has(s.id)),
      project.narrationDelivery,
      next,
      (s) => nativeAudioDefaultVolume(s, deps.catalog.models, configs),
    )
    const freshById = new Map(fresh.content.clips.map((c) => [c.shotId, c]))
    next = fresh.nextClipNumber
    const clips = shots.map((s) => have.get(s.id) ?? freshById.get(s.id)!)
    const same =
      clips.length === head.content.clips.length &&
      clips.every((c, i) => c.id === head.content.clips[i].id)
    if (same) return doc
    const updated = appendRevision(doc, {
      content: { ...head.content, clips },
      summary: '同步镜头顺序',
      author: { kind: 'creator' },
      now: deps.clock.now(),
      nextClipNumber: next,
    })
    await tx.timelines.put(updated)
    return updated
  })
}

const CHARS_PER_SEC = 4.5

/** 摆放需要的素材层事实。配音没有实测时长时按字数估算（并在 `estimated` 里标出）。 */
export function gatherClipFacts(
  projection: ProjectProjection,
  shots: ReadonlyArray<Shot>,
): Map<string, ClipFacts> {
  const out = new Map<string, ClipFacts>()
  for (const s of shots) {
    const v = currentVersion(s.video)
    const a = currentVersion(s.narrationAudio)
    out.set(s.id, {
      video: v
        ? { versionId: v.id, durationUs: secToUs(v.facts?.durationSec ?? s.durationSec) }
        : undefined,
      narrationAudio: a
        ? {
            versionId: a.id,
            durationUs: secToUs(
              a.facts?.durationSec ?? Math.max(1, countChars(s.narration ?? '') / CHARS_PER_SEC),
            ),
          }
        : undefined,
      narrationText: s.narration,
      dialogue: s.dialogue.map((d) => ({ text: d.text })),
    })
  }
  void projection
  return out
}

export interface TimelineReading {
  doc: TimelineDocument
  placement: Placement
  issues: TimelineIssue[]
  facts: Map<string, ClipFacts>
}

/** 读取时间线：摆放 + 问题检查（阻断 / 警告 / 提示）。纯读，不写。 */
export async function readEpisodeTimeline(
  deps: PipelineDeps,
  episodeId: string,
  revision?: number,
): Promise<TimelineReading> {
  const doc = await ensureTimeline(deps, episodeId)
  const episode = (await deps.store.episodes.get(episodeId))!
  const projection = await loadProjection(deps.store, episode.projectId)
  const rev = revision ? doc.revisions.find((r) => r.number === revision) : headRevision(doc)
  if (!rev)
    throw notFoundError('timeline_revision', String(revision), `unknown revision: ${revision}`)
  const shots = rev.content.clips
    .map((c) => projection.shots.get(c.shotId))
    .filter((s): s is Shot => s !== undefined)
  const facts = gatherClipFacts(projection, shots)
  const placement = placeTimeline(rev.content, facts)
  const reports = evaluateArtifacts(projection)
  const staleVideo = new Set(
    rev.content.clips
      .filter((c) => reports.get(`shot_video:${c.shotId}`)?.status === 'stale')
      .map((c) => c.shotId),
  )
  const bgmKnown = new Set<string>()
  for (const b of rev.content.bgm)
    if (await deps.files.exists(episode.projectId, bgmPath(b.bgmId))) bgmKnown.add(b.bgmId)
  const issues = readTimelineIssues(rev.content, placement, {
    delivery: projection.project.narrationDelivery,
    facts,
    staleVideoShotIds: staleVideo,
    cutStale: reports.get(`cut:${episodeId}`)?.status === 'stale',
    bgmExists: (id) => bgmKnown.has(id),
  })
  return { doc: { ...doc, revisions: doc.revisions }, placement, issues, facts }
}

export function cuesFromPlacement(placement: Placement): Cue[] {
  return placement.subtitles.map((s) => ({
    startMs: Math.round(s.startUs / 1000),
    endMs: Math.round(s.endUs / 1000),
    text: s.text,
  }))
}

/**
 * 烧录字幕用的字体设置：缺省用随包的 Noto Sans SC（`data/fonts`），所以烧录不依赖系统字体；
 * 调用方给了 `fontsDir` / `subtitleStyle.fontName` 就用调用方的（想用自己的字体）。
 */
export function subtitleBurnOptions(
  options: Pick<ComposeEpisodeOptions, 'fontsDir' | 'subtitleStyle'>,
): {
  fontsDir: string
  style: SubtitleStyle
} {
  const custom = options.fontsDir !== undefined
  return {
    fontsDir: options.fontsDir ?? bundledFontsDir(),
    style: {
      // 自带字体目录时不强行指定字族（用户的字体叫什么我们不知道）；用随包字体时指定它的字族名。
      ...(custom ? {} : { fontName: SUBTITLE_FONT_FAMILY }),
      ...options.subtitleStyle,
    },
  }
}

export interface ComposeEpisodeOptions {
  /** 字幕：soft（默认，mov_text 软字幕）/ burn（烧进画面，需要 libass，没有则报错）/ none。 */
  subtitles?: SubtitleMode
  fontsDir?: string
  subtitleStyle?: SubtitleStyle
  /** 画布短边，默认 1080。 */
  shortSide?: number
  fps?: number
  signal?: AbortSignal
  onProgress?: (p: { phase: string; index?: number; total?: number }) => void
}

export interface ComposeEpisodeResult {
  path: string
  revision: number
  subtitleMode: SubtitleMode
  durationSec?: number
  issues: TimelineIssue[]
  srtPath?: string
  vttPath?: string
}

export async function composeEpisode(
  deps: PipelineDeps,
  episodeId: string,
  options: ComposeEpisodeOptions = {},
): Promise<ComposeEpisodeResult> {
  if (!deps.media)
    throw new JobFailure({
      category: 'invalid_input',
      code: 'NO_FFMPEG',
      message: '合成需要 ffmpeg，但没有找到可用的 ffmpeg',
      recoverable: false,
    })
  const media = deps.media
  const env: RenderEnv = { bins: media.bins, caps: media.caps, signal: options.signal }
  const episode = (await deps.store.episodes.get(episodeId))!
  const projectId = episode.projectId
  const reading = await readEpisodeTimeline(deps, episodeId)
  if (hasBlockingIssues(reading.issues)) throw new RenderBlockedError(reading.issues)

  // 开始时取快照：期望依据、上游记录都以此刻为准。
  const projection = await loadProjection(deps.store, projectId)
  const expectations = buildExpectations(projection)
  const head = headRevision(reading.doc)
  const mode: SubtitleMode = options.subtitles ?? 'soft'
  if (mode === 'burn') requireFeature(media.caps, 'subtitleBurnIn')

  const dir = await mkdtemp(join(tmpdir(), 'dramai-cut-'))
  try {
    const placed = reading.placement
    const normalized: string[] = []
    for (let i = 0; i < head.content.clips.length; i++) {
      const clip = head.content.clips[i]
      const pc = placed.clips[i]
      const shot = projection.shots.get(clip.shotId)!
      const v = currentVersion(shot.video)!
      const src = await deps.files.localPath(projectId, v.file.path)
      options.onProgress?.({ phase: 'normalizing', index: i + 1, total: head.content.clips.length })
      const out = join(dir, `clip_${i}.mp4`)
      await normalizeClip(env, {
        input: src,
        output: out,
        aspectRatio: projection.project.aspectRatio,
        shortSide: options.shortSide,
        fps: options.fps,
        trimInSec: pc.srcInUs > 0 ? usToSec(pc.srcInUs) : undefined,
        trimOutSec:
          pc.srcOutUs < secToUs(v.facts?.durationSec ?? shot.durationSec)
            ? usToSec(pc.srcOutUs)
            : undefined,
        holdSec: pc.holdUs > 0 ? usToSec(pc.holdUs) : undefined,
        volume: clip.sourceVolume,
      })
      normalized.push(out)
    }
    options.onProgress?.({ phase: 'concatenating' })
    let current = join(dir, 'concat.mp4')
    await concatClips(env, normalized, current, dir)

    // 旁白（按实测时长，可延伸到后续片段）+ 配乐（一条）。
    const tracks: MixTrack[] = []
    for (const n of placed.narrations) {
      const shot = projection.shots.get(n.shotId)!
      const a = currentVersion(shot.narrationAudio)!
      tracks.push({
        path: await deps.files.localPath(projectId, a.file.path),
        startSec: usToSec(n.startUs),
        maxSec: usToSec(n.endUs - n.startUs),
      })
    }
    for (const b of placed.bgm) {
      tracks.push({
        path: await deps.files.localPath(projectId, bgmPath(b.bgmId)),
        startSec: usToSec(b.startUs),
        volume: b.volume,
        fadeInSec: usToSec(b.fadeInUs),
        fadeOutSec: usToSec(b.fadeOutUs),
        maxSec: usToSec(b.endUs - b.startUs),
      })
    }
    if (tracks.length > 0) {
      options.onProgress?.({ phase: 'mixing' })
      const mixed = join(dir, 'mixed.mp4')
      await mixTracks(env, { input: current, tracks, output: mixed })
      current = mixed
    }

    const cues = cuesFromPlacement(placed)
    const srtText = buildSrt(cues)
    const vttText = buildVtt(cues)
    let appliedMode: SubtitleMode = 'none'
    if (mode !== 'none' && cues.length > 0) {
      options.onProgress?.({ phase: 'subtitles' })
      const srtFile = join(dir, 'subs.srt')
      await writeFile(srtFile, srtText, 'utf8')
      const subbed = join(dir, 'subbed.mp4')
      if (mode === 'burn') {
        const burn = subtitleBurnOptions(options)
        await burnSubtitles(env, {
          input: current,
          srtPath: srtFile,
          output: subbed,
          fontsDir: burn.fontsDir,
          style: burn.style,
        })
      } else {
        await embedSoftSubtitles(env, { input: current, srtPath: srtFile, output: subbed })
      }
      current = subbed
      appliedMode = mode
    }

    const bytes = new Uint8Array(await readFile(current))
    const info = await probeMedia(media.bins, current)
    const stamp = deps.ids.next('cut')
    const cutPath = `output/${episodeId}/${stamp}.mp4`
    const stored = await deps.files.put(projectId, cutPath, bytes)
    const cutFile = { path: cutPath, mime: 'video/mp4', bytes: stored.bytes, sha256: stored.sha256 }

    const srtPath = `output/${episodeId}/${stamp}.srt`
    const vttPath = `output/${episodeId}/${stamp}.vtt`
    const srtInfo = await deps.files.put(projectId, srtPath, new TextEncoder().encode(srtText))
    const vttInfo = await deps.files.put(projectId, vttPath, new TextEncoder().encode(vttText))

    const now = deps.clock.now()
    const cutExp = expectations.get(`cut:${episodeId}`)
    if (cutExp) {
      await deps.store.artifacts.put(
        buildRecord({
          projectId,
          expectation: cutExp,
          upstreamRecords: projection.artifacts,
          file: cutFile,
          facts: {
            width: info.width,
            height: info.height,
            durationSec: info.durationSec,
            hasAudio: info.hasAudio,
            fps: info.fps,
          },
          now,
        }),
      )
      deps.events?.emit({ type: 'artifact.changed', projectId, key: `cut:${episodeId}` })
    }
    const subExp = expectations.get(`subtitles:${episodeId}`)
    if (subExp) {
      await deps.store.artifacts.put(
        buildRecord({
          projectId,
          expectation: subExp,
          upstreamRecords: projection.artifacts,
          file: {
            path: srtPath,
            mime: 'application/x-subrip',
            bytes: srtInfo.bytes,
            sha256: srtInfo.sha256,
          },
          now,
        }),
      )
    }
    void vttInfo
    await refreshEpisodeStatus(deps, episode)
    return {
      path: cutPath,
      revision: head.number,
      subtitleMode: appliedMode,
      durationSec: info.durationSec,
      issues: reading.issues,
      srtPath,
      vttPath,
    }
  } finally {
    await removeRetry(dir)
  }
}

export async function refreshEpisodeStatus(
  deps: PipelineDeps,
  episode: Episode,
  options: { exported?: boolean } = {},
) {
  const projection = await loadProjection(deps.store, episode.projectId)
  const status = deriveEpisodeStatus(episodeProgress(projection, episode.id), options)
  const fresh = (await deps.store.episodes.get(episode.id))!
  if (fresh.status !== status)
    await deps.store.episodes.put({ ...fresh, status, updatedAt: deps.clock.now() })
}

/** 渲染车道的任务处理器：`compose`。参数：`{ episodeId, subtitles?, shortSide? }`。 */
export function createComposeHandler(deps: PipelineDeps): JobHandler {
  return async (ctx: JobContext) => {
    const p = ctx.job.params as {
      episodeId?: string
      subtitles?: SubtitleMode
      shortSide?: number
      fontsDir?: string
    }
    const episodeId = p.episodeId ?? ctx.job.episodeId
    if (!episodeId)
      throw new JobFailure({
        category: 'invalid_input',
        code: 'BAD_JOB_PARAMS',
        message: '合成任务缺少 episodeId',
        recoverable: false,
      })
    await ctx.setStage('processing')
    try {
      const r = await composeEpisode(deps, episodeId, {
        subtitles: p.subtitles,
        shortSide: p.shortSide,
        fontsDir: p.fontsDir,
        signal: ctx.signal,
        onProgress: (pr) =>
          void ctx.setStage(
            'processing',
            pr.index && pr.total ? pr.index / (pr.total + 3) : undefined,
          ),
      })
      return { result: { path: r.path, revision: r.revision, subtitleMode: r.subtitleMode } }
    } catch (err) {
      if (err instanceof RenderBlockedError) {
        throw new JobFailure({
          category: 'invalid_input',
          code: 'RENDER_BLOCKED',
          message: err.message,
          recoverable: false,
        })
      }
      throw err
    }
  }
}
