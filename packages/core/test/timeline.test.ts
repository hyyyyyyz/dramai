import { describe, expect, it } from 'vitest'
import type { TimelineBgmClip } from '../src/domain/index.ts'
import {
  appendRevision,
  buildInitialContent,
  createTimeline,
  hasBlockingIssues,
  headRevision,
  moveClip,
  placeTimeline,
  readTimelineIssues,
  removeClip,
  rollbackTo,
  secToUs,
  setBgm,
  updateClip,
  usToSec,
  VOICEOVER_SOURCE_VOLUME,
} from '../src/timeline/index.ts'
import type { ClipFacts } from '../src/timeline/index.ts'

const S = 1_000_000
const shot = (id: string, over: { narration?: string; dialogue?: string[] } = {}) => ({
  id,
  narration: over.narration,
  dialogue: (over.dialogue ?? []).map((text) => ({ text })),
})
type F = {
  video?: number
  audio?: number
  narrationText?: string
  dialogue?: Array<{ text: string }>
}
const facts = (entries: Record<string, F>): Map<string, ClipFacts> =>
  new Map(
    Object.entries(entries).map(([id, e]) => [
      id,
      {
        video:
          e.video === undefined ? undefined : { versionId: `${id}_v`, durationUs: e.video * S },
        narrationAudio:
          e.audio === undefined ? undefined : { versionId: `${id}_a`, durationUs: e.audio * S },
        narrationText: e.narrationText,
        dialogue: e.dialogue ?? [],
      },
    ]),
  )

describe('time units: integer microseconds internally', () => {
  it('converts with at most three decimals', () => {
    expect(secToUs(1.5)).toBe(1_500_000)
    expect(secToUs(0.0004)).toBe(0)
    expect(secToUs(2.3456)).toBe(2_346_000)
    expect(usToSec(2_500_000)).toBe(2.5)
    expect(Number.isInteger(secToUs(1.234))).toBe(true)
  })
})

describe('timeline document: append-only revisions', () => {
  const mk = () => {
    const init = buildInitialContent(
      [shot('a'), shot('b', { narration: '旁白' }), shot('c', { dialogue: ['你好'] })],
      'tts',
    )
    return createTimeline({
      id: 'tl-1',
      projectId: 'p',
      episodeId: 'e',
      name: '第一集',
      content: init.content,
      nextClipNumber: init.nextClipNumber,
      author: { kind: 'creator' },
      now: 1,
    })
  }

  it('the initial content is one hard-cut clip per shot, with voice-ownership defaults', () => {
    const c = headRevision(mk()).content
    expect(c.clips.map((x) => x.id)).toEqual(['c1', 'c2', 'c3'])
    expect(c.clips.map((x) => x.shotId)).toEqual(['a', 'b', 'c'])
    expect(c.clips.map((x) => x.sourceVolume)).toEqual([1, VOICEOVER_SOURCE_VOLUME, 1]) // 画外音镜原声压到 0.3，台词镜 1.0
    expect(c.clips.map((x) => x.carriesNarration)).toEqual([false, true, false])
    expect(c.clips.every((x) => !x.transitionToNext && x.holdUs === 0)).toBe(true)
    expect(c.bgm).toEqual([])
  })

  it('post-production narration is not carried (nothing to mix) but still ducks the source audio', () => {
    const c = buildInitialContent([shot('b', { narration: '旁白' })], 'post').content.clips[0]
    expect(c).toMatchObject({ carriesNarration: false, sourceVolume: VOICEOVER_SOURCE_VOLUME })
  })

  it('appends immutable revisions numbered from 1 and never rewrites history', () => {
    const doc = mk()
    const next = appendRevision(doc, {
      content: updateClip(headRevision(doc).content, 'c1', { holdUs: S }),
      summary: '定格 1 秒',
      author: { kind: 'creator' },
      now: 2,
      changedClipIds: ['c1'],
    })
    expect(next.revisions.map((r) => r.number)).toEqual([1, 2])
    expect(next.revisions[1]).toMatchObject({ parent: 1, changedClipIds: ['c1'] })
    expect(doc.revisions).toHaveLength(1) // 原文档不变
    expect(next.revisions[0].content.clips[0].holdUs).toBe(0)
    expect(next.revisions[1].content.clips[0].holdUs).toBe(S)
  })

  it('exec 21: only a revision appended with a reason carries one; initial, user and rollback revisions never do', () => {
    let doc = mk()
    expect(doc.revisions[0]).not.toHaveProperty('reason')
    doc = appendRevision(doc, {
      content: updateClip(headRevision(doc).content, 'c1', { sourceVolume: 0 }),
      summary: '默认音量：测试',
      author: { kind: 'agent' },
      now: 2,
      changedClipIds: ['c1'],
      reason: 'native_audio_default',
    })
    doc = appendRevision(doc, {
      content: updateClip(headRevision(doc).content, 'c1', { sourceVolume: 0.5 }),
      summary: 'user',
      author: { kind: 'creator' },
      now: 3,
    })
    doc = rollbackTo(doc, 2, { author: { kind: 'creator' }, now: 4 })
    expect(doc.revisions.map((r) => r.reason)).toEqual([
      undefined,
      'native_audio_default',
      undefined,
      undefined,
    ])
    expect(doc.revisions[0]).not.toHaveProperty('reason') // no key at all, not `reason: undefined`
    expect(doc.revisions[2]).not.toHaveProperty('reason')
  })

  it('rollback appends the old content as a new revision (history is kept)', () => {
    let doc = mk()
    doc = appendRevision(doc, {
      content: removeClip(headRevision(doc).content, 'c2'),
      summary: '删掉第二段',
      author: { kind: 'creator' },
      now: 2,
    })
    doc = appendRevision(doc, {
      content: moveClip(headRevision(doc).content, 'c3', 0),
      summary: '调顺序',
      author: { kind: 'creator' },
      now: 3,
    })
    const back = rollbackTo(doc, 1, { author: { kind: 'creator' }, now: 4 })
    expect(back.revisions.map((r) => r.number)).toEqual([1, 2, 3, 4])
    expect(back.revisions[3]).toMatchObject({ restoredFrom: 1, summary: '回滚到修订 1' })
    expect(headRevision(back).content.clips.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    expect(back.revisions[2].content.clips.map((c) => c.id)).toEqual(['c3', 'c1']) // 旧修订原样
    expect(() => rollbackTo(doc, 9, { author: { kind: 'creator' }, now: 5 })).toThrow(
      /unknown revision/,
    )
  })

  it('edit helpers are pure and validate the clip id', () => {
    const c = headRevision(mk()).content
    expect(moveClip(c, 'c3', 0).clips.map((x) => x.id)).toEqual(['c3', 'c1', 'c2'])
    expect(c.clips.map((x) => x.id)).toEqual(['c1', 'c2', 'c3'])
    expect(() => moveClip(c, 'nope', 0)).toThrow()
    expect(() => updateClip(c, 'nope', {})).toThrow()
    const bgm: TimelineBgmClip = {
      id: 'b1',
      bgmId: 'x',
      startUs: 0,
      inUs: 0,
      outUs: 10 * S,
      volume: 0.25,
      fadeInUs: S,
      fadeOutUs: S,
    }
    expect(setBgm(c, bgm).bgm).toEqual([bgm])
    expect(setBgm(setBgm(c, bgm), undefined).bgm).toEqual([])
  })

  it('clip ids keep growing so a deleted clip id is never reused', () => {
    const init = buildInitialContent([shot('a'), shot('b')], 'tts', 10)
    expect(init.content.clips.map((c) => c.id)).toEqual(['c10', 'c11'])
    expect(init.nextClipNumber).toBe(12)
  })
})

describe('placement is a pure function (A8)', () => {
  const content = (
    clips: Array<
      Partial<ReturnType<typeof buildInitialContent>['content']['clips'][number]> & {
        id: string
        shotId: string
      }
    >,
    bgm: TimelineBgmClip[] = [],
  ) => ({
    clips: clips.map((c) => ({ sourceVolume: 1, holdUs: 0, carriesNarration: false, ...c })),
    bgm,
  })

  it('lays clips end to end on one track', () => {
    const p = placeTimeline(
      content([
        { id: 'c1', shotId: 'a' },
        { id: 'c2', shotId: 'b' },
        { id: 'c3', shotId: 'c' },
      ]),
      facts({ a: { video: 5 }, b: { video: 3.5 }, c: { video: 2 } }),
    )
    expect(p.clips.map((c) => [c.startUs, c.endUs])).toEqual([
      [0, 5 * S],
      [5 * S, 8.5 * S],
      [8.5 * S, 10.5 * S],
    ])
    expect(p.totalUs).toBe(10.5 * S)
  })

  it('is deterministic and does not touch its inputs', () => {
    const c = content([{ id: 'c1', shotId: 'a' }])
    const f = facts({ a: { video: 4 } })
    const before = JSON.stringify([c, [...f]])
    expect(placeTimeline(c, f)).toEqual(placeTimeline(c, f))
    expect(JSON.stringify([c, [...f]])).toBe(before)
  })

  it('trim only applies to the video version it was recorded against; hold extends with a freeze frame', () => {
    const f = facts({ a: { video: 6 } })
    const trimmed = placeTimeline(
      content([
        {
          id: 'c1',
          shotId: 'a',
          trim: { inUs: 1 * S, outUs: 4 * S, basisVersionId: 'a_v' },
          holdUs: 2 * S,
        },
      ]),
      f,
    )
    expect(trimmed.clips[0]).toMatchObject({
      srcInUs: S,
      srcOutUs: 4 * S,
      holdUs: 2 * S,
      startUs: 0,
      endUs: 5 * S,
      trimIgnored: false,
    })
    const other = placeTimeline(
      content([
        {
          id: 'c1',
          shotId: 'a',
          trim: { inUs: 1 * S, outUs: 4 * S, basisVersionId: 'old_version' },
        },
      ]),
      f,
    )
    expect(other.clips[0]).toMatchObject({
      srcInUs: 0,
      srcOutUs: 6 * S,
      endUs: 6 * S,
      trimIgnored: true,
    })
    const clamped = placeTimeline(
      content([
        { id: 'c1', shotId: 'a', trim: { inUs: 5 * S, outUs: 99 * S, basisVersionId: 'a_v' } },
      ]),
      f,
    )
    expect(clamped.clips[0]).toMatchObject({ srcInUs: 5 * S, srcOutUs: 6 * S })
  })

  it('a clip without video takes no time and is flagged', () => {
    const p = placeTimeline(
      content([
        { id: 'c1', shotId: 'a' },
        { id: 'c2', shotId: 'b' },
      ]),
      facts({ a: {}, b: { video: 3 } }),
    )
    expect(p.clips[0]).toMatchObject({ missingVideo: true, startUs: 0, endUs: 0 })
    expect(p.clips[1]).toMatchObject({ missingVideo: false, startUs: 0, endUs: 3 * S })
  })

  it('narration starts at its carrying clip and plays for the measured duration — it may run over later clips', () => {
    const p = placeTimeline(
      content([
        { id: 'c1', shotId: 'a', carriesNarration: true },
        { id: 'c2', shotId: 'b' },
        { id: 'c3', shotId: 'c' },
      ]),
      facts({
        a: { video: 3, audio: 7, narrationText: '很长的一段旁白' },
        b: { video: 3 },
        c: { video: 5 },
      }),
    )
    expect(p.narrations).toEqual([
      {
        clipId: 'c1',
        shotId: 'a',
        startUs: 0,
        endUs: 7 * S,
        fullDurationUs: 7 * S,
        truncated: false,
        versionId: 'a_a',
      },
    ])
    expect(p.narrations[0].endUs).toBeGreaterThan(p.clips[0].endUs)
  })

  it('keeps overlaps between narrations, and cuts only what runs past the end of the timeline', () => {
    const p = placeTimeline(
      content([
        { id: 'c1', shotId: 'a', carriesNarration: true },
        { id: 'c2', shotId: 'b', carriesNarration: true },
      ]),
      facts({
        a: { video: 3, audio: 5, narrationText: 'x' },
        b: { video: 3, audio: 6, narrationText: 'y' },
      }),
    )
    // 第一段旁白（0–5 秒）与第二段（3 秒起）如实重叠；第二段超出末尾（6 秒）的部分被截掉。
    expect(p.narrations.map((n) => [n.startUs, n.endUs, n.truncated])).toEqual([
      [0, 5 * S, false],
      [3 * S, 6 * S, true],
    ])
    expect(p.narrations[1].fullDurationUs).toBe(6 * S)
  })

  it('subtitles follow the narration (measured duration) when there is one; otherwise dialogue lines are spread over the clip by length', () => {
    const p = placeTimeline(
      content([
        { id: 'c1', shotId: 'a', carriesNarration: true },
        { id: 'c2', shotId: 'b' },
      ]),
      facts({
        a: { video: 3, audio: 5, narrationText: '这是旁白' },
        b: { video: 4, dialogue: [{ text: '短' }, { text: '一句稍微长一点的话' }] },
      }),
    )
    expect(p.subtitles[0]).toMatchObject({
      shotId: 'a',
      startUs: 0,
      endUs: 5 * S,
      text: '这是旁白',
      source: 'narration',
    })
    const lines = p.subtitles.filter((s) => s.source === 'dialogue')
    expect(lines).toHaveLength(2)
    expect(lines[0].startUs).toBe(3 * S)
    expect(lines[1].endUs).toBe(7 * S)
    expect(lines[0].endUs).toBe(lines[1].startUs)
    expect(lines[0].endUs - lines[0].startUs).toBeLessThan(lines[1].endUs - lines[1].startUs) // 按字数比例
  })

  it('narration text without audio (post-production) spans its clip as a subtitle', () => {
    const p = placeTimeline(
      content([{ id: 'c1', shotId: 'a', carriesNarration: false }]),
      facts({ a: { video: 4, narrationText: '后期配音的旁白' } }),
    )
    expect(p.narrations).toEqual([])
    expect(p.subtitles).toMatchObject([{ startUs: 0, endUs: 4 * S, source: 'narration_text' }])
  })

  it('BGM is placed at its absolute start; if it runs past the end it is truncated with a fixed 1 s fade-out', () => {
    const bgm: TimelineBgmClip = {
      id: 'b1',
      bgmId: 'song',
      startUs: 2 * S,
      inUs: 0,
      outUs: 60 * S,
      volume: 0.25,
      fadeInUs: S,
      fadeOutUs: 0,
    }
    const p = placeTimeline(
      content([{ id: 'c1', shotId: 'a' }], [bgm]),
      facts({ a: { video: 10 } }),
    )
    expect(p.bgm[0]).toMatchObject({
      startUs: 2 * S,
      endUs: 10 * S,
      outUs: 8 * S,
      truncated: true,
      fadeOutUs: S,
      fadeInUs: S,
      volume: 0.25,
    })
  })

  it('BGM fades are shortened proportionally when they do not fit; a BGM that fits is left alone', () => {
    const tight: TimelineBgmClip = {
      id: 'b1',
      bgmId: 's',
      startUs: 0,
      inUs: 0,
      outUs: 1 * S,
      volume: 0.25,
      fadeInUs: S,
      fadeOutUs: S,
    }
    const p = placeTimeline(
      content([{ id: 'c1', shotId: 'a' }], [tight]),
      facts({ a: { video: 10 } }),
    )
    expect(p.bgm[0].fadeInUs + p.bgm[0].fadeOutUs).toBeLessThanOrEqual(S)
    expect(p.bgm[0].truncated).toBe(false)
    const ok: TimelineBgmClip = { ...tight, outUs: 5 * S }
    expect(
      placeTimeline(content([{ id: 'c1', shotId: 'a' }], [ok]), facts({ a: { video: 10 } })).bgm[0],
    ).toMatchObject({ fadeInUs: S, fadeOutUs: S, truncated: false })
  })

  it('reports transitions it does not render (hard cuts only in this version) without changing the length', () => {
    const p = placeTimeline(
      content([
        { id: 'c1', shotId: 'a', transitionToNext: { type: 'dissolve', durationUs: S } },
        { id: 'c2', shotId: 'b' },
      ]),
      facts({ a: { video: 3 }, b: { video: 3 } }),
    )
    expect(p.ignoredTransitions).toEqual(['c1'])
    expect(p.totalUs).toBe(6 * S)
  })
})

describe('issues found when reading the timeline (blocking / warning / info)', () => {
  const clip = (id: string, shotId: string, over: Record<string, unknown> = {}) => ({
    id,
    shotId,
    sourceVolume: 1,
    holdUs: 0,
    carriesNarration: false,
    ...over,
  })
  const read = (
    clips: ReturnType<typeof clip>[],
    f: Map<string, ClipFacts>,
    over: Partial<Parameters<typeof readTimelineIssues>[2]> = {},
    bgm: TimelineBgmClip[] = [],
  ) => {
    const content = { clips, bgm }
    return readTimelineIssues(content, placeTimeline(content, f), {
      delivery: 'tts',
      facts: f,
      ...over,
    })
  }
  const codes = (issues: ReturnType<typeof read>, severity?: string) =>
    issues.filter((i) => !severity || i.severity === severity).map((i) => i.code)

  it('an empty timeline and clips without video block', () => {
    expect(codes(read([], facts({})))).toEqual(['EMPTY_TIMELINE'])
    const issues = read([clip('c1', 'a')], facts({ a: {} }))
    expect(codes(issues, 'blocking')).toEqual(['VIDEO_MISSING'])
    expect(hasBlockingIssues(issues)).toBe(true)
  })

  it('in a TTS project, narration without a voice-over blocks; an uncarried narration only warns', () => {
    const missing = read(
      [clip('c1', 'a', { carriesNarration: true })],
      facts({ a: { video: 3, narrationText: '旁白' } }),
    )
    expect(codes(missing, 'blocking')).toEqual(['NARRATION_AUDIO_MISSING'])
    const uncarried = read([clip('c1', 'a')], facts({ a: { video: 3, narrationText: '旁白' } }))
    expect(codes(uncarried, 'warning')).toEqual(['NARRATION_NOT_CARRIED'])
    expect(hasBlockingIssues(uncarried)).toBe(false)
    // 后期配音项目不报缺配音
    expect(
      codes(
        read([clip('c1', 'a')], facts({ a: { video: 3, narrationText: '旁白' } }), {
          delivery: 'post',
        }),
      ),
    ).toEqual([])
  })

  it('warns when narration runs past the end, overlaps the next one, or lands on a dialogue clip', () => {
    const f = facts({
      a: { video: 2, audio: 9, narrationText: 'x' },
      b: { video: 2, audio: 3, narrationText: 'y', dialogue: [{ text: '台词' }] },
    })
    const issues = read(
      [clip('c1', 'a', { carriesNarration: true }), clip('c2', 'b', { carriesNarration: true })],
      f,
    )
    expect(codes(issues, 'warning')).toEqual(
      expect.arrayContaining([
        'NARRATION_OVERLAPS_NEXT',
        'NARRATION_OVER_DIALOGUE',
        'NARRATION_PAST_END',
      ]),
    )
    expect(hasBlockingIssues(issues)).toBe(false)
  })

  it('NARRATION_OVER_DIALOGUE reads the clip volume that really applies: a clip defaulted to silence is not "loud sound"', () => {
    const f = facts({
      a: { video: 2, audio: 9, narrationText: 'x' },
      b: { video: 2, narrationText: undefined },
    })
    const quiet = read(
      [clip('c1', 'a', { carriesNarration: true }), clip('c2', 'b', { sourceVolume: 0 })],
      f,
    )
    expect(codes(quiet, 'warning')).not.toContain('NARRATION_OVER_DIALOGUE')
    const loud = read(
      [clip('c1', 'a', { carriesNarration: true }), clip('c2', 'b', { sourceVolume: 1 })],
      f,
    )
    expect(codes(loud, 'warning')).toContain('NARRATION_OVER_DIALOGUE')
  })

  it('flags stale clip videos, a stale cut, an ignored trim and ignored transitions as non-blocking', () => {
    const f = facts({ a: { video: 3 }, b: { video: 3 } })
    const issues = read(
      [
        clip('c1', 'a', {
          trim: { inUs: 0, outUs: S, basisVersionId: 'old' },
          transitionToNext: { type: 'dissolve', durationUs: S },
        }),
        clip('c2', 'b'),
      ],
      f,
      { staleVideoShotIds: new Set(['b']), cutStale: true },
    )
    expect(codes(issues)).toEqual(
      expect.arrayContaining([
        'TRIM_IGNORED',
        'CLIP_VIDEO_STALE',
        'CUT_STALE',
        'TRANSITION_IGNORED',
      ]),
    )
    expect(hasBlockingIssues(issues)).toBe(false)
  })

  it('a missing BGM file blocks', () => {
    const bgm: TimelineBgmClip = {
      id: 'b1',
      bgmId: 'gone',
      startUs: 0,
      inUs: 0,
      outUs: S,
      volume: 0.25,
      fadeInUs: 0,
      fadeOutUs: 0,
    }
    const issues = read([clip('c1', 'a')], facts({ a: { video: 3 } }), { bgmExists: () => false }, [
      bgm,
    ])
    expect(codes(issues, 'blocking')).toEqual(['BGM_MISSING'])
    expect(
      hasBlockingIssues(
        read([clip('c1', 'a')], facts({ a: { video: 3 } }), { bgmExists: () => true }, [bgm]),
      ),
    ).toBe(false)
  })
})
