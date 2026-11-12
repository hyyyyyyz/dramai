import type { TimelineContent, TimelineView } from '@dramai/api'

/**
 * 合成页的纯逻辑：时间线内容的编辑（得到新的内容，由 timeline.update 追加成新修订）、
 * 轨道上的位置换算、问题的整理。后端目前转场只有硬切、配乐只支持一条，这里如实只表达这些。
 */
export type TimelineIssue = TimelineView['issues'][number]
export type Placement = TimelineView['placement']
export type Clip = TimelineContent['clips'][number]

export const US = 1_000_000
export const usToSec = (us: number) => us / US
export const secToUs = (sec: number) => Math.round(sec * US)

/** 片段在时间线上的名字：c1、c2……（按当前顺序）。 */
export const clipName = (content: Pick<TimelineContent, 'clips'>, clipId: string): string => {
  const i = content.clips.findIndex((c) => c.id === clipId)
  return i < 0 ? clipId : `c${i + 1}`
}

export function updateClip(
  content: TimelineContent,
  clipId: string,
  patch: Partial<Clip>,
): TimelineContent {
  return { ...content, clips: content.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) }
}

/** 把片段往前 / 往后挪一格（越界不动）。 */
export function moveClip(content: TimelineContent, clipId: string, dir: -1 | 1): TimelineContent {
  const i = content.clips.findIndex((c) => c.id === clipId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= content.clips.length) return content
  const clips = [...content.clips]
  ;[clips[i], clips[j]] = [clips[j]!, clips[i]!]
  return { ...content, clips }
}

/** 只有一条配乐：设置（替换）它；null 就是去掉。 */
export function setBgm(
  content: TimelineContent,
  bgm: { bgmId: string; durationUs: number; volume?: number } | null,
): TimelineContent {
  if (!bgm) return { ...content, bgm: [] }
  return {
    ...content,
    bgm: [
      {
        id: 'bgm1',
        bgmId: bgm.bgmId,
        startUs: 0,
        inUs: 0,
        outUs: bgm.durationUs,
        volume: bgm.volume ?? 0.25,
        fadeInUs: US,
        fadeOutUs: US,
      },
    ],
  }
}

export function setBgmVolume(content: TimelineContent, volume: number): TimelineContent {
  return { ...content, bgm: content.bgm.map((b) => ({ ...b, volume })) }
}

/** 问题按严重程度分组计数。 */
export function countIssues(issues: readonly TimelineIssue[]) {
  const c = { blocking: 0, warning: 0, info: 0 }
  for (const i of issues) c[i.severity]++
  return c
}

/** 阻断在前，其次警告、提示；同级保持服务端给的顺序。 */
export function sortIssues(issues: readonly TimelineIssue[]): TimelineIssue[] {
  const rank = { blocking: 0, warning: 1, info: 2 } as const
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => rank[a.issue.severity] - rank[b.issue.severity] || a.i - b.i)
    .map((x) => x.issue)
}

/** 轨道上一格的左边距和宽度（像素）。 */
export function trackBox(startUs: number, endUs: number, pxPerSec: number) {
  return {
    left: usToSec(startUs) * pxPerSec,
    width: Math.max(2, usToSec(endUs - startUs) * pxPerSec),
  }
}

/** 时间标尺的刻度：总长在 1 分钟内每 5 秒一格，更长就每 10 / 30 秒。 */
export function rulerStep(totalSec: number): number {
  return totalSec <= 60 ? 5 : totalSec <= 300 ? 10 : 30
}

/** 刻度上的“m:ss”。 */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 哪个片段承载哪段旁白缺配音：用于在旁白轨上给“缺配音”画一格（缺配音的旁白不在 placement.narrations 里）。 */
export function missingNarrationClips(issues: readonly TimelineIssue[]): string[] {
  return issues
    .filter((i) => i.code === 'NARRATION_AUDIO_MISSING' && i.clipId)
    .map((i) => i.clipId!)
}

/** 服务端目前会给出的问题码（开放集合：以后新增的码界面落到“未知问题”，不会崩）。 */
export const ISSUE_CODES = [
  'EMPTY_TIMELINE',
  'VIDEO_MISSING',
  'NARRATION_AUDIO_MISSING',
  'NARRATION_NOT_CARRIED',
  'BGM_MISSING',
  'NARRATION_PAST_END',
  'NARRATION_OVERLAPS_NEXT',
  'NARRATION_OVER_DIALOGUE',
  'CLIP_VIDEO_STALE',
  'CUT_STALE',
  'TRIM_IGNORED',
  'TRANSITION_IGNORED',
] as const
export type IssueCode = (typeof ISSUE_CODES)[number]
export const isKnownIssue = (code: string): code is IssueCode =>
  (ISSUE_CODES as readonly string[]).includes(code)
