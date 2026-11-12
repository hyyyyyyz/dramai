import { describe, expect, it } from 'vitest'
import { actionOf } from '@/features/compose/issue-actions'
import {
  clipFinished,
  narrationsToStart,
  previewClips,
  resolveAt,
  timelineAt,
} from '@/features/compose/preview-model'
import {
  clock,
  countIssues,
  isKnownIssue,
  moveClip,
  rulerStep,
  setBgm,
  setBgmVolume,
  sortIssues,
  trackBox,
  updateClip,
} from '@/features/compose/timeline-model'
import { makeTimeline, placedClip } from './fixtures-compose'

const content = () => makeTimeline().revision.content

describe('timeline edits produce new content and never mutate the old', () => {
  it('moves a clip one step and ignores moves past either end', () => {
    const c = content()
    expect(moveClip(c, 'clip_1', 1).clips.map((x) => x.id)).toEqual(['clip_2', 'clip_1'])
    expect(moveClip(c, 'clip_1', -1)).toBe(c)
    expect(moveClip(c, 'clip_2', 1)).toBe(c)
    expect(c.clips.map((x) => x.id)).toEqual(['clip_1', 'clip_2'])
  })

  it('patches only the chosen clip', () => {
    const next = updateClip(content(), 'clip_2', { sourceVolume: 0.9 })
    expect(next.clips.map((x) => x.sourceVolume)).toEqual([0.3, 0.9])
  })

  it('keeps a single music track: setting replaces it, null removes it, volume applies to it', () => {
    const one = setBgm(content(), { bgmId: 'b1', durationUs: 30_000_000 })
    expect(one.bgm).toHaveLength(1)
    expect(one.bgm[0]).toMatchObject({ bgmId: 'b1', outUs: 30_000_000, startUs: 0, inUs: 0 })
    const two = setBgm(one, { bgmId: 'b2', durationUs: 10_000_000 })
    expect(two.bgm.map((b) => b.bgmId)).toEqual(['b2'])
    expect(setBgmVolume(two, 0.5).bgm[0]!.volume).toBe(0.5)
    expect(setBgm(two, null).bgm).toEqual([])
  })
})

describe('issues', () => {
  const issues = [
    { severity: 'info' as const, code: 'TRIM_IGNORED', message: '' },
    { severity: 'blocking' as const, code: 'VIDEO_MISSING', message: '' },
    { severity: 'warning' as const, code: 'CUT_STALE', message: '' },
    { severity: 'blocking' as const, code: 'EMPTY_TIMELINE', message: '' },
  ]
  it('sorts blocking first, then warnings, then info, keeping server order within a level', () => {
    expect(sortIssues(issues).map((i) => i.code)).toEqual([
      'VIDEO_MISSING',
      'EMPTY_TIMELINE',
      'CUT_STALE',
      'TRIM_IGNORED',
    ])
    expect(countIssues(issues)).toEqual({ blocking: 2, warning: 1, info: 1 })
  })

  it('every known issue code with a place to fix it maps to an action; unknown codes do not crash', () => {
    expect(
      actionOf({ severity: 'blocking', code: 'VIDEO_MISSING', shotId: 's1', message: '' }),
    ).toEqual({ kind: 'storyboard', shotId: 's1' })
    expect(
      actionOf({
        severity: 'blocking',
        code: 'NARRATION_AUDIO_MISSING',
        shotId: 's1',
        message: '',
      }),
    ).toEqual({ kind: 'voice', shotId: 's1' })
    expect(
      actionOf({ severity: 'warning', code: 'NARRATION_OVERLAPS_NEXT', clipId: 'c1', message: '' }),
    ).toEqual({ kind: 'select', clipId: 'c1' })
    expect(actionOf({ severity: 'warning', code: 'BGM_MISSING', message: '' })).toEqual({
      kind: 'bgm',
    })
    expect(actionOf({ severity: 'warning', code: 'CUT_STALE', message: '' })).toEqual({
      kind: 'render',
    })
    expect(actionOf({ severity: 'info', code: 'SOMETHING_NEW', message: '' })).toBeUndefined()
    expect(isKnownIssue('CUT_STALE')).toBe(true)
    expect(isKnownIssue('SOMETHING_NEW')).toBe(false)
  })
})

describe('track geometry', () => {
  it('converts times to pixels with a minimum width, picks a ruler step and formats m:ss', () => {
    expect(trackBox(5_000_000, 10_000_000, 24)).toEqual({ left: 120, width: 120 })
    expect(trackBox(0, 1, 24).width).toBe(2)
    expect([rulerStep(40), rulerStep(120), rulerStep(900)]).toEqual([5, 10, 30])
    expect([clock(0), clock(65), clock(600)]).toEqual(['0:00', '1:05', '10:00'])
  })
})

describe('in-browser preview timing', () => {
  const placement = () => {
    const p = makeTimeline().placement
    p.clips[1] = placedClip('clip_2', 'shot_2', 5_000_000, {
      srcInUs: 1_000_000,
      srcOutUs: 4_000_000,
      endUs: 8_000_000,
    })
    p.narrations = [
      {
        clipId: 'clip_1',
        shotId: 'shot_1',
        startUs: 1_000_000,
        endUs: 3_000_000,
        fullDurationUs: 2_000_000,
        truncated: false,
        versionId: 'a1',
      },
    ]
    return p
  }
  it('finds the clip at a timeline time and maps it onto the source video', () => {
    const clips = previewClips(placement())
    expect(resolveAt(clips, 2_000_000)).toEqual({ index: 0, sourceUs: 2_000_000 })
    expect(resolveAt(clips, 6_000_000)).toEqual({ index: 1, sourceUs: 2_000_000 })
    expect(resolveAt(clips, 99_000_000)?.index).toBe(1)
    expect(resolveAt([], 0)).toBeUndefined()
  })
  it('maps source time back to timeline time and knows when a clip is finished (trim out point)', () => {
    const [, second] = previewClips(placement())
    expect(timelineAt(second!, 2_500_000)).toBe(6_500_000)
    expect(timelineAt(second!, 9_000_000)).toBe(8_000_000)
    expect(clipFinished(second!, 3_990_000)).toBe(true)
    expect(clipFinished(second!, 2_000_000)).toBe(false)
  })
  it('starts a narration once, in the step that crosses its start', () => {
    const p = placement()
    expect(narrationsToStart(p, 0, 900_000)).toEqual([])
    expect(narrationsToStart(p, 900_000, 1_100_000)).toHaveLength(1)
    expect(narrationsToStart(p, 1_000_000, 1_200_000)).toHaveLength(0)
  })
})
