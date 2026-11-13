import { SCHEMA_VERSIONS } from '../domain/common.ts'
import type { NarrationDelivery } from '../domain/voice.ts'
import { deriveVoiceOwner, hasNarration } from '../domain/voice.ts'
import type { Shot } from '../domain/shot.ts'
import type {
  TimelineBgmClip,
  TimelineClip,
  TimelineDocument,
  TimelineRevision,
} from '../domain/timeline.ts'
import { notFoundError } from '../errors.ts'

/**
 * 时间线文档（A8）：追加式、不可变的修订；回滚 = 以旧修订的内容追加新修订。
 * 内部时间一律整数微秒。2B 只做硬切和一条配乐；转场词表保留在类型里，渲染时忽略。
 */

export type RevisionContent = TimelineRevision['content']
export type RevisionAuthor = TimelineRevision['author']

/** 秒 → 整数微秒（最多三位小数）。 */
export const secToUs = (s: number): number => Math.round(Math.round(s * 1000) * 1000)
export const usToSec = (us: number): number => us / 1_000_000

export function headRevision(doc: TimelineDocument): TimelineRevision {
  return doc.revisions[doc.revisions.length - 1]
}

/** 默认的片段原声音量：台词 / 无人声镜 1.0；画外音镜 0.3（给旁白让路）。 */
export const VOICEOVER_SOURCE_VOLUME = 0.3

/**
 * 按镜头顺序生成初始内容：一个镜头一个片段，全部硬切，旁白由配音镜头的片段承载。
 *
 * `sourceVolumeOverride`：某个镜头的片段原声默认音量不走上面的规则时返回数值（返回 undefined = 照旧）。
 * 用来处理"模型关不掉自带音频、而这个镜头又没有使用原生人声"——见 `nativeAudioDefaultVolume`。这只是**新片段的默认值**，
 * 用户可以在时间线上调；已经存在的片段不会被改。
 */
export function buildInitialContent<S extends Pick<Shot, 'id' | 'dialogue' | 'narration'>>(
  shots: ReadonlyArray<S>,
  delivery: NarrationDelivery,
  startNumber = 1,
  sourceVolumeOverride?: (shot: S) => number | undefined,
): { content: RevisionContent; nextClipNumber: number } {
  let n = startNumber
  const clips: TimelineClip[] = shots.map((s) => {
    const owner = deriveVoiceOwner(s, delivery)
    return {
      id: `c${n++}`,
      shotId: s.id,
      sourceVolume:
        sourceVolumeOverride?.(s) ??
        (owner === 'tts' || owner === 'post' ? VOICEOVER_SOURCE_VOLUME : 1),
      holdUs: 0,
      carriesNarration: owner === 'tts' && hasNarration(s),
    }
  })
  return { content: { clips, bgm: [] }, nextClipNumber: n }
}

export function createTimeline(input: {
  id: string
  projectId: string
  episodeId: string
  name: string
  content: RevisionContent
  nextClipNumber: number
  author: RevisionAuthor
  now: number
  summary?: string
}): TimelineDocument {
  return {
    schemaVersion: SCHEMA_VERSIONS.timeline,
    id: input.id,
    projectId: input.projectId,
    episodeId: input.episodeId,
    name: input.name.slice(0, 40),
    nextClipNumber: input.nextClipNumber,
    nextBgmNumber: 1 + input.content.bgm.length,
    revisions: [
      {
        number: 1,
        author: input.author,
        summary: input.summary ?? '初始时间线',
        createdAt: input.now,
        content: structuredClone(input.content),
      },
    ],
  }
}

/** 追加一个修订（不可变：返回新文档，旧修订原样保留）。 */
export function appendRevision(
  doc: TimelineDocument,
  input: {
    content: RevisionContent
    summary: string
    author: RevisionAuthor
    now: number
    changedClipIds?: string[]
    restoredFrom?: number
    nextClipNumber?: number
    nextBgmNumber?: number
  },
): TimelineDocument {
  const head = headRevision(doc)
  const rev: TimelineRevision = {
    number: head.number + 1,
    parent: head.number,
    author: input.author,
    summary: input.summary,
    createdAt: input.now,
    content: structuredClone(input.content),
    changedClipIds: input.changedClipIds,
    restoredFrom: input.restoredFrom,
  }
  return {
    ...doc,
    nextClipNumber: input.nextClipNumber ?? doc.nextClipNumber,
    nextBgmNumber: input.nextBgmNumber ?? doc.nextBgmNumber,
    revisions: [...doc.revisions, rev],
  }
}

/** 回滚：以旧修订的内容追加新修订，不改写历史。回滚总是作用在最新修订上。 */
export function rollbackTo(
  doc: TimelineDocument,
  revisionNumber: number,
  input: { author: RevisionAuthor; now: number },
): TimelineDocument {
  const old = doc.revisions.find((r) => r.number === revisionNumber)
  if (!old)
    throw notFoundError(
      'timeline_revision',
      String(revisionNumber),
      `unknown revision: ${revisionNumber}`,
    )
  return appendRevision(doc, {
    content: old.content,
    summary: `回滚到修订 ${revisionNumber}`,
    author: input.author,
    now: input.now,
    restoredFrom: revisionNumber,
  })
}

export function moveClip(
  content: RevisionContent,
  clipId: string,
  toIndex: number,
): RevisionContent {
  const clips = [...content.clips]
  const from = clips.findIndex((c) => c.id === clipId)
  if (from < 0) throw notFoundError('timeline_clip', clipId, `unknown clip: ${clipId}`)
  const [c] = clips.splice(from, 1)
  clips.splice(Math.max(0, Math.min(clips.length, toIndex)), 0, c)
  return { ...content, clips }
}

export function updateClip(
  content: RevisionContent,
  clipId: string,
  patch: Partial<Omit<TimelineClip, 'id' | 'shotId'>>,
): RevisionContent {
  if (!content.clips.some((c) => c.id === clipId))
    throw notFoundError('timeline_clip', clipId, `unknown clip: ${clipId}`)
  return { ...content, clips: content.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) }
}

export function removeClip(content: RevisionContent, clipId: string): RevisionContent {
  return { ...content, clips: content.clips.filter((c) => c.id !== clipId) }
}

/** 2B 只支持一条配乐。 */
export function setBgm(
  content: RevisionContent,
  bgm: TimelineBgmClip | undefined,
): RevisionContent {
  return { ...content, bgm: bgm ? [bgm] : [] }
}

export const DEFAULT_BGM_VOLUME = 0.25
export const DEFAULT_BGM_FADE_US = 1_000_000
