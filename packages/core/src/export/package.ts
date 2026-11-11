import JSZip from 'jszip'
import { evaluateArtifacts } from '../artifacts/staleness.ts'
import { currentVersion } from '../domain/media.ts'
import { loadProjection } from '../generation/projection.ts'
import { episodeShots } from '../pipeline/entities.ts'
import { readEpisodeTimeline, refreshEpisodeStatus } from '../pipeline/compose.ts'
import type { PipelineDeps } from '../pipeline/deps.ts'
import { hasBlockingIssues } from '../timeline/issues.ts'
import type { TimelineIssue } from '../timeline/issues.ts'
import { usToSec } from '../timeline/document.ts'
import { buildEpisodeSubtitles } from './subtitles.ts'

/**
 * 素材包导出（mp4、图、字幕、清单的压缩包）。用户拖进剪映等软件手动拼，也是将来剪映草稿的输入。
 *
 * 前置条件：时间线没有**阻断**问题（缺视频、TTS 项目缺配音、配乐文件丢失…）。有就拒绝导出并带回问题清单。
 * 过期的产物仍然会被打进包里（过期 ≠ 不可用），清单里标出状态。
 */
export class ExportBlockedError extends Error {
  readonly issues: TimelineIssue[]
  constructor(issues: TimelineIssue[]) {
    super(
      `时间线有阻断问题，不能导出素材包：${issues
        .filter((i) => i.severity === 'blocking')
        .map((i) => i.message)
        .join('；')}`,
    )
    this.name = 'ExportBlockedError'
    this.issues = issues
  }
}

export const PACKAGE_FORMAT = 'dramai-material-package'
export const PACKAGE_VERSION = 2

const pad = (n: number) => String(n).padStart(2, '0')
const extOf = (path: string, fallback: string) => /\.([A-Za-z0-9]+)$/.exec(path)?.[1] ?? fallback

export async function exportMaterialPackage(
  deps: PipelineDeps,
  episodeId: string,
  options: { includeImages?: boolean; includeCut?: boolean; markExported?: boolean } = {},
): Promise<Uint8Array> {
  const episode = await deps.store.episodes.get(episodeId)
  if (!episode) throw new Error(`episode not found: ${episodeId}`)
  const reading = await readEpisodeTimeline(deps, episodeId)
  if (hasBlockingIssues(reading.issues)) throw new ExportBlockedError(reading.issues)

  const projection = await loadProjection(deps.store, episode.projectId)
  const reports = evaluateArtifacts(projection)
  const shots = await episodeShots(deps.store, episodeId)
  const byId = new Map(shots.map((s) => [s.id, s]))
  const zip = new JSZip()
  const assets = zip.folder('assets')!

  const entries: Array<Record<string, unknown>> = []
  let order = 0
  for (const pc of reading.placement.clips) {
    const shot = byId.get(pc.shotId)!
    order++
    const prefix = `shot_${pad(order)}`
    const entry: Record<string, unknown> = {
      order,
      shotId: shot.id,
      title: shot.title,
      scriptExcerpt: shot.scriptExcerpt,
      narration: shot.narration,
      dialogue: shot.dialogue.map((d) => ({ speaker: d.speakerName, text: d.text })),
      startSec: usToSec(pc.startUs),
      endSec: usToSec(pc.endUs),
      sourceVolume: pc.sourceVolume,
      status: {
        video: reports.get(`shot_video:${shot.id}`)?.status,
        image: reports.get(`shot_image:${shot.id}`)?.status,
      },
    }
    const v = currentVersion(shot.video)
    if (v) {
      const name = `${prefix}.${extOf(v.file.path, 'mp4')}`
      assets.file(name, await deps.files.get(episode.projectId, v.file.path))
      entry.videoFile = `assets/${name}`
      entry.videoHasNativeAudio = v.withNativeAudio ?? false
    }
    const img = currentVersion(shot.image)
    if (img && options.includeImages !== false) {
      const name = `${prefix}.${extOf(img.file.path, 'png')}`
      assets.file(name, await deps.files.get(episode.projectId, img.file.path))
      entry.imageFile = `assets/${name}`
    }
    const a = currentVersion(shot.narrationAudio)
    if (a) {
      const name = `${prefix}_narration.${extOf(a.file.path, 'mp3')}`
      assets.file(name, await deps.files.get(episode.projectId, a.file.path))
      entry.narrationFile = `assets/${name}`
    }
    entries.push(entry)
  }

  const subs = await buildEpisodeSubtitles(deps, episodeId)
  zip.file('subtitles.srt', subs.srt)
  zip.file('subtitles.vtt', subs.vtt)

  const cutRec = projection.artifacts.get(`cut:${episodeId}`)
  if (cutRec && options.includeCut !== false) {
    zip.file(
      `cut.${extOf(cutRec.file.path, 'mp4')}`,
      await deps.files.get(episode.projectId, cutRec.file.path),
    )
  }
  const head = reading.doc.revisions[reading.doc.revisions.length - 1]
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        format: PACKAGE_FORMAT,
        version: PACKAGE_VERSION,
        project: {
          id: projection.project.id,
          name: projection.project.name,
          aspectRatio: projection.project.aspectRatio,
        },
        episode: { id: episode.id, number: episode.number, title: episode.title },
        timeline: {
          id: reading.doc.id,
          revision: head.number,
          totalSec: usToSec(reading.placement.totalUs),
        },
        subtitlesSource: subs.source,
        cut: cutRec
          ? {
              file: `cut.${extOf(cutRec.file.path, 'mp4')}`,
              status: reports.get(`cut:${episodeId}`)?.status,
            }
          : undefined,
        issues: reading.issues,
        shots: entries,
      },
      null,
      2,
    ),
  )
  zip.file(
    'README.txt',
    [
      'dramai 素材包',
      '',
      '  assets/            各镜头当前版本的视频 / 图片 / 旁白配音，按成片顺序编号',
      '  subtitles.srt/.vtt 字幕（和成片同一份摆放：旁白按配音实测时长）',
      '  cut.mp4            最近一次渲染的成片（如果有）',
      '  manifest.json      清单：每个镜头的文件、时间、产物状态（current / stale …）和读取时间线发现的问题',
      '',
      '导入剪映：新建草稿，把 assets 里的 mp4 按编号顺序拖到主轨，字幕拖到字幕轨。',
      '这不是剪映草稿文件：剪映对草稿加密、格式没有公开文档，能否直接导入取决于版本。',
    ].join('\n'),
  )
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  if (options.markExported) await refreshEpisodeStatus(deps, episode, { exported: true })
  return bytes
}
