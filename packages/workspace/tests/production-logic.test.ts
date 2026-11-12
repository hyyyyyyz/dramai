import { describe, expect, it } from 'vitest'
import type { Asset } from '@dramai/api'
import { suggestionOf, groupPending, firstShot } from '@/features/candidates/candidate-model'
import { costHeadline } from '@/features/storyboard/cost'
import { mentionsToNames, namesToMentions } from '@/features/storyboard/mentions'
import { reasonAction, isReasonCode, REASON_CODES } from '@/features/storyboard/reasons'
import {
  countViews,
  deriveShotView,
  groupScenes,
  soundOf,
  targetKey,
} from '@/features/storyboard/shot-model'
import { versionNumber } from '@/features/storyboard/version-model'
import zh from '@/i18n/locales/zh-CN'
import en from '@/i18n/locales/en'
import {
  makeAsset,
  makeCandidate,
  makeEpisodeDetail,
  makeShot,
  makeVerdict,
  slotWith,
  staleReport,
  emptyTotals,
} from './fixtures-production'
import { failedJob } from './fixtures'

const noCtx = { jobs: [], artifacts: new Map(), verdicts: new Map() }

describe('shot state', () => {
  it('phases come from the stages the server writes on the shot', () => {
    const base = makeShot()
    expect(deriveShotView(base, noCtx).phase).toBe('empty')
    expect(
      deriveShotView(
        makeShot({ stages: { image: 'queued', video: 'pending', audio: 'pending' } }),
        noCtx,
      ).phase,
    ).toBe('image_queued')
    expect(
      deriveShotView(
        makeShot({ stages: { image: 'running', video: 'pending', audio: 'pending' } }),
        noCtx,
      ).phase,
    ).toBe('image_running')
    expect(deriveShotView(makeShot({ image: slotWith('image') }), noCtx).phase).toBe('image_ready')
    expect(
      deriveShotView(
        makeShot({
          image: slotWith('image'),
          stages: { image: 'succeeded', video: 'running', audio: 'pending' },
        }),
        noCtx,
      ).phase,
    ).toBe('video_running')
    expect(
      deriveShotView(makeShot({ image: slotWith('image'), video: slotWith('video') }), noCtx).phase,
    ).toBe('video_ready')
  })

  it('the next step is the image until there is one, then the video', () => {
    expect(deriveShotView(makeShot(), noCtx).next).toBe('image')
    expect(deriveShotView(makeShot({ image: slotWith('image') }), noCtx).next).toBe('video')
  })

  it('“can’t generate” comes from the read-only preflight of the NEXT step, and only where that step is still to do', () => {
    const shot = makeShot({ image: slotWith('image') })
    const blocked = makeVerdict(targetKey('shot_video', shot.id), {
      status: 'blocked',
      reasons: [{ code: 'PROMPT_EMPTY', message: 'x' }],
    })
    expect(
      deriveShotView(shot, { ...noCtx, verdicts: new Map([[blocked.targetId, blocked]]) }).blocked,
    ).toBe(blocked)
    // 被整批拦下不是它自己的问题
    const byBatch = makeVerdict(blocked.targetId, { status: 'blocked_by_batch' })
    expect(
      deriveShotView(shot, { ...noCtx, verdicts: new Map([[byBatch.targetId, byBatch]]) }).blocked,
    ).toBeUndefined()
    // 视频已经有了：不再提示
    const done = makeShot({ id: shot.id, image: slotWith('image'), video: slotWith('video') })
    expect(
      deriveShotView(done, { ...noCtx, verdicts: new Map([[blocked.targetId, blocked]]) }).blocked,
    ).toBeUndefined()
    // 在途的镜头：预检会因为它自己的任务而拦下它，不提示
    const running = makeShot({
      id: shot.id,
      image: slotWith('image'),
      stages: { image: 'succeeded', video: 'queued', audio: 'pending' },
    })
    expect(
      deriveShotView(running, { ...noCtx, verdicts: new Map([[blocked.targetId, blocked]]) })
        .blocked,
    ).toBeUndefined()
  })

  it('stale comes from the artifact report, per kind, and only when that version exists', () => {
    const shot = makeShot({ image: slotWith('image'), video: slotWith('video') })
    const rep = staleReport(targetKey('shot_video', shot.id), [])
    const v = deriveShotView(shot, { ...noCtx, artifacts: new Map([[rep.key, rep]]) })
    expect(v.videoStale).toBe(rep)
    expect(v.imageStale).toBeUndefined()
    const noVideo = deriveShotView(makeShot({ id: shot.id, image: slotWith('image') }), {
      ...noCtx,
      artifacts: new Map([[rep.key, rep]]),
    })
    expect(noVideo.videoStale).toBeUndefined()
  })

  it('failures: the failed stage and the latest failed job for this shot', () => {
    const shot = makeShot({
      image: slotWith('image'),
      stages: { image: 'succeeded', video: 'failed', audio: 'pending' },
      failedStage: 'video',
    })
    const old = failedJob('generation_failed', {
      shotId: shot.id,
      updatedAt: 1,
      operation: 'shot_video',
    })
    const latest = failedJob('delivery_failed', {
      shotId: shot.id,
      updatedAt: 9,
      operation: 'shot_video',
    })
    const other = failedJob('internal', {
      shotId: 'someone-else',
      updatedAt: 99,
      operation: 'shot_video',
    })
    const v = deriveShotView(shot, { ...noCtx, jobs: [old, latest, other] })
    expect(v.failedStage).toBe('video')
    expect(v.failedJob).toBe(latest)
  })

  it('the status bar counts', () => {
    const views = [
      deriveShotView(makeShot({ image: slotWith('image'), video: slotWith('video') }), noCtx),
      deriveShotView(
        makeShot({ stages: { image: 'running', video: 'pending', audio: 'pending' } }),
        noCtx,
      ),
      deriveShotView(
        makeShot({
          stages: { image: 'failed', video: 'pending', audio: 'pending' },
          failedStage: 'image',
        }),
        noCtx,
      ),
      deriveShotView(makeShot(), noCtx),
    ]
    expect(countViews(views)).toEqual({
      shots: 4,
      videos: 1,
      running: 1,
      stale: 0,
      failed: 1,
      blocked: 0,
    })
  })

  it('sound ownership is derived: dialogue wins over narration, nothing means silent', () => {
    expect(soundOf(makeShot({ dialogue: [{ text: '别问' }] }))).toBe('dialogue')
    expect(soundOf(makeShot({ narration: '那年冬天' }))).toBe('narration')
    expect(soundOf(makeShot({ narration: '  ' }))).toBe('silent')
  })

  it('groups scenes and numbers shots in broadcast order across scenes', () => {
    const a = makeShot({ id: 's_a' })
    const b = makeShot({ id: 's_b' })
    const c = makeShot({ id: 's_c' })
    const detail = makeEpisodeDetail([a, b, c])
    // 把第三个镜头挪到第二个场里
    detail.scenes.push({
      ...detail.scenes[0]!,
      id: 'scene_2',
      number: 2,
      title: '回廊',
      shotOrder: ['s_c'],
    })
    detail.scenes[0]!.shotOrder = ['s_b', 's_a']
    detail.shots = detail.shots.map((s) => (s.id === 's_c' ? { ...s, sceneId: 'scene_2' } : s))
    detail.episode.sceneOrder = ['scene_1', 'scene_2']
    const groups = groupScenes(detail)
    expect(groups.map((g) => g.shots.map((s) => `${s.shot.id}:${s.index}`))).toEqual([
      ['s_b:1', 's_a:2'],
      ['s_c:3'],
    ])
    expect(groups[0]!.durationSec).toBe(10)
  })

  it('version numbers count from 1 in list order', () => {
    const slot = slotWith('image', 3)
    expect(versionNumber(slot, slot.versions[0]!.id)).toBe(1)
    expect(versionNumber(slot, slot.currentVersionId)).toBe(3)
    expect(versionNumber(slot, 'nope')).toBeUndefined()
    expect(versionNumber(slot, null)).toBeUndefined()
  })
})

describe('prompt mentions', () => {
  const hero = makeAsset({ id: 'asset_1', name: '小宫女' })
  const loc = makeAsset({ id: 'asset_2', name: '宫墙夹道', kind: 'location' })
  const map = new Map<string, Asset>([hero, loc].map((a) => [a.id, a]))

  it('shows names for people and turns them back into ids on save', () => {
    const stored = '@{asset_1/冬装} walks along @{asset_2} at dusk, @{asset_gone} too'
    const shown = mentionsToNames(stored, map)
    expect(shown).toBe('@小宫女/冬装 walks along @宫墙夹道 at dusk, @{asset_gone} too')
    expect(namesToMentions(shown, map)).toBe(stored)
  })

  it('a longer name is replaced before a shorter one that it contains', () => {
    const a = makeAsset({ id: 'a1', name: '小宫女' })
    const b = makeAsset({ id: 'a2', name: '小宫女长' })
    const m = new Map([a, b].map((x) => [x.id, x]))
    expect(namesToMentions('@小宫女长 与 @小宫女', m)).toBe('@{a2} 与 @{a1}')
  })

  it('names with regex characters do not break', () => {
    const a = makeAsset({ id: 'a1', name: 'A.B (C)' })
    expect(namesToMentions('@A.B (C) here', new Map([[a.id, a]]))).toBe('@{a1} here')
  })
})

describe('reason codes', () => {
  it('every known reason code has copy in both languages', () => {
    for (const code of REASON_CODES) {
      expect((zh as { reasons: Record<string, string> }).reasons, `zh ${code}`).toHaveProperty(code)
      expect((en as { reasons: Record<string, string> }).reasons, `en ${code}`).toHaveProperty(code)
    }
    expect(isReasonCode('PROMPT_EMPTY')).toBe(true)
    expect(isReasonCode('SOMETHING_NEW')).toBe(false)
  })

  it('each blocking reason points at the place that fixes it', () => {
    expect(reasonAction({ code: 'ASSET_SHEET_MISSING', assetId: 'a1' })).toEqual({
      kind: 'asset',
      assetId: 'a1',
    })
    expect(reasonAction({ code: 'ASSET_SHEET_MISSING' })).toBeUndefined()
    expect(reasonAction({ code: 'ASSET_NOT_REGISTERED' })).toEqual({ kind: 'candidates' })
    expect(reasonAction({ code: 'PROMPT_EMPTY' })).toEqual({ kind: 'prompts' })
    expect(reasonAction({ code: 'START_FRAME_MISSING' })).toEqual({ kind: 'generateImage' })
    expect(reasonAction({ code: 'RECOVER_ORIGINAL_FIRST' })).toEqual({ kind: 'tasks' })
    expect(reasonAction({ code: 'REFERENCE_NOT_SUPPORTED' })).toEqual({ kind: 'providers' })
    expect(reasonAction({ code: 'VOICE_CONFLICT' })).toEqual({ kind: 'edit' })
    expect(reasonAction({ code: 'UNKNOWN_CODE' })).toBeUndefined()
  })
})

describe('cost headline', () => {
  const money = (a: number, c: string) => `${c} ${a}`
  it('uses the converted total when the user set a conversion', () => {
    expect(
      costHeadline(
        { ...emptyTotals(), converted: { currency: 'CNY', amount: 1.4, approx: true } },
        money,
      ),
    ).toBe('≈ CNY 1.4')
  })
  it('keeps currencies apart when there is no conversion', () => {
    expect(
      costHeadline(
        {
          ...emptyTotals(),
          byCurrency: { PTC: { amount: 0.2, approx: true }, USD: { amount: 3, approx: false } },
        },
        money,
      ),
    ).toBe('≈ PTC 0.2 + USD 3')
  })
  it('says nothing when nothing could be priced', () => {
    expect(costHeadline({ ...emptyTotals(), unpriced: 3 }, money)).toBeUndefined()
  })
})

describe('candidates', () => {
  it('pending ones are grouped by kind in a fixed order, high confidence first', () => {
    const groups = groupPending([
      makeCandidate({ name: 'b', kind: 'prop', confidenceBand: 'low' }),
      makeCandidate({ name: 'a', kind: 'character', confidenceBand: 'medium' }),
      makeCandidate({ name: 'c', kind: 'character', confidenceBand: 'high' }),
      makeCandidate({ name: 'd', kind: 'prop', status: 'ignored' }),
    ])
    expect(groups.map((g) => [g.kind, g.items.map((i) => i.name)])).toEqual([
      ['character', ['c', 'a']],
      ['prop', ['b']],
    ])
  })

  it('a suggestion only counts when the asset still exists and is of the same kind', () => {
    const asset = makeAsset({ id: 'a1', kind: 'character', name: '总管太监' })
    const m = new Map([[asset.id, asset]])
    const sugg = { assetId: 'a1', score: 0.9, basis: [{ type: 'alias' as const }] }
    expect(suggestionOf(makeCandidate({ suggestedMatch: sugg }), m)?.asset.name).toBe('总管太监')
    expect(
      suggestionOf(makeCandidate({ suggestedMatch: { ...sugg, assetId: 'gone' } }), m),
    ).toBeUndefined()
    expect(suggestionOf(makeCandidate({ kind: 'prop', suggestedMatch: sugg }), m)).toBeUndefined()
  })

  it('first appearance is the earliest shot in broadcast order', () => {
    expect(
      firstShot([
        { episodeNumber: 2, index: 1 },
        { episodeNumber: 1, index: 5 },
        { episodeNumber: 1, index: 3 },
      ]),
    ).toEqual({ episodeNumber: 1, index: 3 })
  })
})
