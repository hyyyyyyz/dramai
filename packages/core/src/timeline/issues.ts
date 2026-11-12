import type { NarrationDelivery } from '../domain/voice.ts'
import type { RevisionContent } from './document.ts'
import type { ClipFacts, Placement } from './placement.ts'

/**
 * 读取时间线时检查并报告的问题，分“阻断 / 警告 / 提示”。有阻断问题时：渲染成片、导出剪映素材包都被拦下。
 */
export type IssueSeverity = 'blocking' | 'warning' | 'info'

export type TimelineIssueCode =
  | 'EMPTY_TIMELINE'
  | 'VIDEO_MISSING'
  | 'NARRATION_AUDIO_MISSING'
  | 'NARRATION_NOT_CARRIED'
  | 'BGM_MISSING'
  | 'NARRATION_PAST_END'
  | 'NARRATION_OVERLAPS_NEXT'
  | 'NARRATION_OVER_DIALOGUE'
  | 'CLIP_VIDEO_STALE'
  | 'CUT_STALE'
  | 'TRIM_IGNORED'
  | 'TRANSITION_IGNORED'

export interface TimelineIssue {
  severity: IssueSeverity
  code: TimelineIssueCode
  clipId?: string
  shotId?: string
  message: string
}

export interface IssueContext {
  delivery: NarrationDelivery
  facts: ReadonlyMap<string, ClipFacts>
  /** 视频已过期的镜头 id。 */
  staleVideoShotIds?: ReadonlySet<string>
  /** 上一次成片已过期。 */
  cutStale?: boolean
  /** 配乐文件是否存在（bgmId → 存在）。 */
  bgmExists?: (bgmId: string) => boolean
}

export function readTimelineIssues(
  content: RevisionContent,
  placement: Placement,
  ctx: IssueContext,
): TimelineIssue[] {
  const out: TimelineIssue[] = []
  if (content.clips.length === 0) {
    out.push({ severity: 'blocking', code: 'EMPTY_TIMELINE', message: '时间线上没有片段' })
    return out
  }
  content.clips.forEach((c, i) => {
    const placed = placement.clips[i]
    const f = ctx.facts.get(c.shotId)
    if (placed.missingVideo) {
      out.push({
        severity: 'blocking',
        code: 'VIDEO_MISSING',
        clipId: c.id,
        shotId: c.shotId,
        message: '这个片段对应的镜头还没有视频',
      })
    }
    if (placed.trimIgnored) {
      out.push({
        severity: 'info',
        code: 'TRIM_IGNORED',
        clipId: c.id,
        shotId: c.shotId,
        message: '截取是针对旧版视频记录的，换了版本后整段使用',
      })
    }
    if (ctx.staleVideoShotIds?.has(c.shotId)) {
      out.push({
        severity: 'warning',
        code: 'CLIP_VIDEO_STALE',
        clipId: c.id,
        shotId: c.shotId,
        message: '这个片段用的视频已过期（依据变了），仍可使用',
      })
    }
    const hasText = Boolean(f?.narrationText?.trim())
    if (hasText && ctx.delivery === 'tts') {
      if (!c.carriesNarration) {
        out.push({
          severity: 'warning',
          code: 'NARRATION_NOT_CARRIED',
          clipId: c.id,
          shotId: c.shotId,
          message: '这个镜头有旁白文字，但没有片段承载它的配音',
        })
      } else if (!f?.narrationAudio) {
        // TTS 项目下缺配音：阻断带旁白的成片。
        out.push({
          severity: 'blocking',
          code: 'NARRATION_AUDIO_MISSING',
          clipId: c.id,
          shotId: c.shotId,
          message: '旁白还没有配音（项目的旁白交付方式是 TTS）',
        })
      }
    }
  })
  placement.narrations.forEach((n, i) => {
    if (n.truncated) {
      out.push({
        severity: 'warning',
        code: 'NARRATION_PAST_END',
        clipId: n.clipId,
        shotId: n.shotId,
        message: '旁白超出了时间线末尾，超出的部分会被截掉',
      })
    }
    const next = placement.narrations[i + 1]
    if (next && n.endUs > next.startUs) {
      out.push({
        severity: 'warning',
        code: 'NARRATION_OVERLAPS_NEXT',
        clipId: n.clipId,
        shotId: n.shotId,
        message: '这段旁白会和下一段旁白重叠，两段会同时响起',
      })
    }
    // 旁白延伸到有对白原声的片段上，可能相撞。
    placement.clips.forEach((p, k) => {
      if (p.startUs >= n.endUs || p.startUs <= n.startUs || p.clipId === n.clipId) return
      const hasDialogue = (ctx.facts.get(p.shotId)?.dialogue.length ?? 0) > 0
      if (hasDialogue || p.sourceVolume > 0.3) {
        out.push({
          severity: 'warning',
          code: 'NARRATION_OVER_DIALOGUE',
          clipId: n.clipId,
          shotId: n.shotId,
          message: `旁白延伸到了第 ${k + 1} 个片段上，那里有对白或较大的原声，可能相撞`,
        })
      }
    })
  })
  for (const b of content.bgm) {
    if (ctx.bgmExists && !ctx.bgmExists(b.bgmId)) {
      out.push({
        severity: 'blocking',
        code: 'BGM_MISSING',
        message: `配乐 ${b.bgmId} 的文件不存在`,
      })
    }
  }
  for (const id of placement.ignoredTransitions) {
    out.push({
      severity: 'info',
      code: 'TRANSITION_IGNORED',
      clipId: id,
      message: '当前版本只做硬切，转场会被忽略',
    })
  }
  if (ctx.cutStale)
    out.push({ severity: 'info', code: 'CUT_STALE', message: '上一次成片已过期，建议重新渲染' })
  return out
}

export const hasBlockingIssues = (issues: readonly TimelineIssue[]): boolean =>
  issues.some((i) => i.severity === 'blocking')
