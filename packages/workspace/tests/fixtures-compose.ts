import type { TimelineView } from '@dramai/api'

type Clip = TimelineView['placement']['clips'][number]
export type Issue = TimelineView['issues'][number]

export const clipContent = (id: string, shotId: string) => ({
  id,
  shotId,
  sourceVolume: 0.3,
  holdUs: 0,
  carriesNarration: true,
})

export const placedClip = (
  clipId: string,
  shotId: string,
  startUs: number,
  over: Partial<Clip> = {},
): Clip => ({
  clipId,
  shotId,
  startUs,
  endUs: startUs + 5_000_000,
  srcInUs: 0,
  srcOutUs: 5_000_000,
  holdUs: 0,
  sourceVolume: 0.3,
  videoVersionId: `ver_${shotId}`,
  trimIgnored: false,
  missingVideo: false,
  ...over,
})

/** 两个片段的时间线；issues 自己传。 */
export function makeTimeline(
  patch: { issues?: Issue[]; head?: number; clips?: string[] } = {},
): TimelineView {
  const shots = patch.clips ?? ['shot_1', 'shot_2']
  const issues = patch.issues ?? []
  const content = {
    clips: shots.map((s, i) => clipContent(`clip_${i + 1}`, s)),
    bgm: [],
  }
  const head = patch.head ?? 3
  return {
    id: 'tl_1',
    episodeId: 'ep_1',
    name: '主时间线',
    head,
    revisions: [3, 2, 1]
      .filter((n) => n <= head)
      .map((n) => ({
        number: n,
        author: { kind: 'creator' as const },
        summary: n === 1 ? '初始时间线' : `修订 ${n}`,
        createdAt: 1,
      })),
    revision: {
      number: head,
      author: { kind: 'creator' as const },
      summary: 'x',
      createdAt: 1,
      content,
    },
    placement: {
      totalUs: shots.length * 5_000_000,
      clips: shots.map((s, i) => placedClip(`clip_${i + 1}`, s, i * 5_000_000)),
      narrations: [],
      subtitles: [],
      bgm: [],
      ignoredTransitions: [],
    },
    issues,
    hasBlockingIssues: issues.some((i) => i.severity === 'blocking'),
  }
}
