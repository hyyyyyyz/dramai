import type { TimelineIssue } from './timeline-model'

/** 读取时间线时发现的问题，每条带直达处理的地方。 */
export type IssueAction =
  | { kind: 'storyboard'; shotId?: string }
  | { kind: 'select'; clipId: string }
  | { kind: 'voice'; shotId: string }
  | { kind: 'bgm' }
  | { kind: 'render' }

export function actionOf(issue: TimelineIssue): IssueAction | undefined {
  switch (issue.code) {
    case 'VIDEO_MISSING':
    case 'CLIP_VIDEO_STALE':
      return { kind: 'storyboard', shotId: issue.shotId }
    case 'NARRATION_AUDIO_MISSING':
      return issue.shotId ? { kind: 'voice', shotId: issue.shotId } : undefined
    case 'NARRATION_NOT_CARRIED':
    case 'NARRATION_PAST_END':
    case 'NARRATION_OVERLAPS_NEXT':
    case 'NARRATION_OVER_DIALOGUE':
    case 'TRIM_IGNORED':
      return issue.clipId ? { kind: 'select', clipId: issue.clipId } : undefined
    case 'BGM_MISSING':
      return { kind: 'bgm' }
    case 'CUT_STALE':
      return { kind: 'render' }
    default:
      return undefined
  }
}
