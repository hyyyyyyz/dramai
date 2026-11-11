import { describe, expect, it } from 'vitest'
import type { EpisodeProgress } from '@dramai/api'
import { computeNextSteps, shotSegments } from '@/features/overview/next-steps'
import { pickCurrentEpisode } from '@/data/current-episode'
import { sourceChapterRange } from '@/lib/episode'
import { matchesFilter, projectStatus } from '@/features/projects/project-status'
import { toStyleChoice } from '@/features/projects/style-choice'

const progress = (patch: Partial<EpisodeProgress> = {}): EpisodeProgress => ({
  episodeId: 'e1',
  split: { scenes: 0, shots: 0, shotsReady: 0 },
  candidates: { total: 0, pending: 0, accepted_new: 0, linked: 0, ignored: 0, handled: 0 },
  sheets: { total: 0, done: 0 },
  images: { total: 0, done: 0 },
  videos: { total: 0, done: 0 },
  composition: { done: false },
  ...patch,
})

describe('next steps checklist', () => {
  it('a fresh episode starts at "break into shots"', () => {
    const s = computeNextSteps(progress())
    expect(s.map((x) => x.state)).toEqual(['now', 'todo', 'todo', 'todo', 'todo', 'todo'])
  })

  it('after the breakdown, candidates are the current step; not yet extracted is its own variant', () => {
    const s = computeNextSteps(progress({ split: { scenes: 5, shots: 7, shotsReady: 0 } }))
    expect(s[0]!.state).toBe('done')
    expect(s[1]).toMatchObject({ state: 'now', variant: 'notExtracted' })
  })

  it('pending candidates block the step; handling them all completes it', () => {
    const split = { scenes: 5, shots: 7, shotsReady: 0 }
    const pending = computeNextSteps(
      progress({
        split,
        candidates: { total: 5, pending: 5, accepted_new: 0, linked: 0, ignored: 0, handled: 0 },
      }),
    )
    expect(pending[1]).toMatchObject({ state: 'now', variant: 'pending', n: { pending: 5 } })
    const handled = computeNextSteps(
      progress({
        split,
        candidates: { total: 5, pending: 0, accepted_new: 3, linked: 1, ignored: 1, handled: 5 },
      }),
    )
    expect(handled[1]!.state).toBe('done')
    expect(handled[2]!.state).toBe('now')
  })

  it('counts come from the progress summary, with stale counts', () => {
    const s = computeNextSteps(
      progress({
        split: { scenes: 5, shots: 7, shotsReady: 7 },
        candidates: { total: 5, pending: 0, accepted_new: 5, linked: 0, ignored: 0, handled: 5 },
        sheets: { total: 10, done: 10 },
        images: { total: 7, done: 5 },
        videos: { total: 7, done: 2, stale: 1 },
      }),
    )
    expect(s[3]).toMatchObject({ key: 'images', state: 'now', n: { done: 5, total: 7 } })
    expect(s[4]).toMatchObject({ key: 'videos', state: 'todo', n: { done: 2, total: 7, stale: 1 } })
  })

  it('everything done leaves no current step', () => {
    const s = computeNextSteps(
      progress({
        split: { scenes: 1, shots: 2, shotsReady: 2 },
        candidates: { total: 1, pending: 0, accepted_new: 1, linked: 0, ignored: 0, handled: 1 },
        sheets: { total: 1, done: 1 },
        images: { total: 2, done: 2 },
        videos: { total: 2, done: 2 },
        composition: { done: true },
      }),
    )
    expect(s.every((x) => x.state === 'done')).toBe(true)
  })

  it('shot segments order video → image → none and never exceed the shot count', () => {
    const p = progress({
      split: { scenes: 1, shots: 5, shotsReady: 0 },
      images: { total: 5, done: 3 },
      videos: { total: 5, done: 1 },
    })
    expect(shotSegments(p)).toEqual(['success', 'info', 'info', 'none', 'none'])
    expect(
      shotSegments(
        progress({ split: { scenes: 1, shots: 2, shotsReady: 0 }, videos: { total: 2, done: 9 } }),
      ),
    ).toEqual(['success', 'success'])
  })
})

describe('episodes', () => {
  it('picks the saved episode, else the first one that is not exported', () => {
    const eps = [
      { id: 'a', status: 'exported' },
      { id: 'b', status: 'producing' },
      { id: 'c', status: 'planned' },
    ]
    expect(pickCurrentEpisode(eps, 'c')?.id).toBe('c')
    expect(pickCurrentEpisode(eps, 'gone')?.id).toBe('b')
    expect(pickCurrentEpisode([{ id: 'a', status: 'exported' }], undefined)?.id).toBe('a')
    expect(pickCurrentEpisode([], undefined)).toBeUndefined()
  })

  it('maps an episode’s line range to chapter numbers', () => {
    const chapters = [
      { index: 0, startLine: 1, endLine: 10 },
      { index: 1, startLine: 11, endLine: 20 },
      { index: 2, startLine: 21, endLine: 30 },
    ].map((c) => ({ ...c, title: '', startOffset: 0, endOffset: 0, charCount: 0 }))
    const materials = [{ id: 'm1', chapters }]
    expect(
      sourceChapterRange(
        { sourceRange: { materialId: 'm1', startLine: 5, endLine: 25 } },
        materials,
      ),
    ).toEqual({ from: 1, to: 3 })
    expect(
      sourceChapterRange(
        { sourceRange: { materialId: 'm1', startLine: 11, endLine: 20 } },
        materials,
      ),
    ).toEqual({ from: 2, to: 2 })
    expect(
      sourceChapterRange(
        { sourceRange: { materialId: 'nope', startLine: 1, endLine: 2 } },
        materials,
      ),
    ).toBeUndefined()
    expect(sourceChapterRange({}, materials)).toBeUndefined()
  })
})

describe('projects', () => {
  const ep = (
    number: number,
    status: 'planned' | 'storyboarding' | 'producing' | 'composed' | 'exported',
  ) => ({ id: `e${number}`, number, title: '', status, progress: progress() })
  it('status picks the episode being worked on', () => {
    expect(projectStatus({ episodes: [] })).toEqual({ kind: 'draft' })
    expect(
      projectStatus({ episodes: [ep(1, 'exported'), ep(2, 'producing'), ep(3, 'planned')] }),
    ).toEqual({ kind: 'episode', number: 2, status: 'producing' })
    expect(projectStatus({ episodes: [ep(1, 'exported'), ep(2, 'exported')] })).toEqual({
      kind: 'exported',
    })
    expect(projectStatus({ episodes: [ep(1, 'planned'), ep(2, 'planned')] })).toEqual({
      kind: 'allPlanned',
      episodes: 2,
    })
  })
  it('filters', () => {
    const done = { episodes: [ep(1, 'exported')] }
    const active = { episodes: [ep(1, 'producing')] }
    expect(matchesFilter(done, 'done')).toBe(true)
    expect(matchesFilter(active, 'done')).toBe(false)
    expect(matchesFilter(active, 'active')).toBe(true)
    expect(matchesFilter(done, 'all')).toBe(true)
  })
  it('style choice: template wins, then a custom description, else none', () => {
    expect(toStyleChoice({ templateId: 't1', custom: '' })).toEqual({
      source: 'template',
      templateId: 't1',
    })
    expect(toStyleChoice({ custom: '  水墨  ' })).toEqual({ source: 'custom', description: '水墨' })
    expect(toStyleChoice({ custom: '   ' })).toEqual({ source: 'none' })
  })
})
