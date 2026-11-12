import { describe, expect, it } from 'vitest'
import { evaluateArtifacts } from '../src/artifacts/index.ts'
import { EPISODE_STATUSES } from '../src/domain/index.ts'
import type { EntityCandidate } from '../src/domain/index.ts'
import { deriveEpisodeStatus, episodeProgress } from '../src/generation/progress.ts'
import { makeWorld, putFile, slotWith } from './helpers.ts'
import type { World } from './helpers.ts'
import { buildRecord, buildExpectations } from '../src/artifacts/index.ts'

const cand = (
  projectId: string,
  id: string,
  status: EntityCandidate['status'],
  shotIds: string[],
): EntityCandidate => ({
  schemaVersion: 1,
  id,
  projectId,
  kind: 'character',
  name: id,
  aliases: [],
  shotIds,
  variants: [],
  status,
  extractedAt: 1,
  createdAt: 1,
})

async function giveImage(w: World, shotId: string) {
  const s = (await w.ports.store.shots.get(shotId))!
  const f = await putFile(w.ports, w.project.id, `images/${shotId}/v1.png`, `img-${shotId}`)
  await w.ports.store.shots.put({ ...s, image: slotWith('image', `${shotId}_i1`, f) })
}

describe('episode status values', () => {
  it('are explicit and ordered along the workflow', () => {
    expect(EPISODE_STATUSES).toEqual([
      'planned',
      'storyboarding',
      'producing',
      'composed',
      'exported',
    ])
  })
})

describe('episode progress is computed, never stored', () => {
  it('counts split, candidates, sheets, images, videos and composition', async () => {
    const w = await makeWorld()
    await w.ports.store.candidates.put(cand(w.project.id, 'c1', 'pending', [w.shot.id]))
    await w.ports.store.candidates.put(cand(w.project.id, 'c2', 'linked', [w.shot2.id]))
    await w.ports.store.candidates.put(
      cand(w.project.id, 'c3', 'ignored', ['some_other_episode_shot']),
    )
    await giveImage(w, w.shot.id)
    const p = episodeProgress(await w.reload(), w.episodeId)
    expect(p).toEqual({
      episodeId: w.episodeId,
      split: { scenes: 1, shots: 2, shotsReady: 0 },
      candidates: { total: 2, pending: 1, accepted_new: 0, linked: 1, ignored: 0, handled: 1 },
      sheets: { total: 3, done: 3 },
      images: { total: 2, done: 1 },
      videos: { total: 2, done: 0 },
      composition: { done: false },
    })
  })

  it('counts assets without a sheet as not done', async () => {
    const w = await makeWorld({ sheets: false })
    const p = episodeProgress(await w.reload(), w.episodeId)
    expect(p.sheets).toEqual({ total: 3, done: 0 })
  })

  it('reflects the current data on every call — nothing is cached or stored', async () => {
    const w = await makeWorld()
    expect(episodeProgress(await w.reload(), w.episodeId).images.done).toBe(0)
    await giveImage(w, w.shot.id)
    await giveImage(w, w.shot2.id)
    expect(episodeProgress(await w.reload(), w.episodeId).images.done).toBe(2)
    expect(Object.keys((await w.ports.store.episodes.get(w.episodeId)) ?? {})).not.toContain(
      'progress',
    )
  })

  it('adds stale counts when artifact reports are supplied', async () => {
    const w = await makeWorld()
    await giveImage(w, w.shot.id)
    // 登记资产图与镜头图，再改镜头提示词 → 镜头图过期
    const reg = async (kind: string) => {
      const p = await w.reload()
      for (const e of buildExpectations(p).values()) {
        if (e.kind !== kind) continue
        const file =
          kind === 'asset_sheet'
            ? p.assets.get(e.key.split(':')[1])!.sheet.versions[0].file
            : p.shots.get(e.key.split(':')[1])!.image.versions[0].file
        await w.ports.store.artifacts.put(
          buildRecord({
            projectId: w.project.id,
            expectation: e,
            upstreamRecords: p.artifacts,
            file,
            now: 1,
          }),
        )
      }
    }
    await reg('asset_sheet')
    const p0 = await w.reload()
    const e = buildExpectations(p0).get(`shot_image:${w.shot.id}`)!
    await w.ports.store.artifacts.put(
      buildRecord({
        projectId: w.project.id,
        expectation: e,
        upstreamRecords: p0.artifacts,
        file: p0.shots.get(w.shot.id)!.image.versions[0].file,
        now: 1,
      }),
    )
    await w.ports.store.shots.put({
      ...(await w.ports.store.shots.get(w.shot.id))!,
      prompts: { keyFrame: 'changed' },
    })
    const p = await w.reload()
    const progress = episodeProgress(p, w.episodeId, evaluateArtifacts(p))
    expect(progress.images).toEqual({ total: 2, done: 1, stale: 1 })
    expect(progress.sheets.stale).toBe(0)
  })

  it('composition is done once a cut is registered for the episode', async () => {
    const w = await makeWorld()
    const f = await putFile(w.ports, w.project.id, 'output/cut.mp4', 'cut', 'video/mp4')
    await w.ports.store.artifacts.put({
      schemaVersion: 1,
      projectId: w.project.id,
      key: `cut:${w.episodeId}`,
      kind: 'cut',
      file: f,
      basisDigest: 'x',
      contentHash: f.sha256,
      upstream: {},
      upstreamVersions: {},
      basisFields: {},
      origin: 'generated',
      createdAt: 1,
    })
    expect(episodeProgress(await w.reload(), w.episodeId).composition.done).toBe(true)
  })

  it('rejects an unknown episode', async () => {
    const w = await makeWorld()
    const projection = await w.reload()
    expect(() => episodeProgress(projection, 'nope')).toThrow(/episode not found/)
  })
})

describe('deriveEpisodeStatus', () => {
  const base = {
    episodeId: 'e',
    split: { scenes: 1, shots: 4, shotsReady: 4 },
    candidates: { total: 0, pending: 0, accepted_new: 0, linked: 0, ignored: 0, handled: 0 },
    sheets: { total: 0, done: 0 },
    images: { total: 4, done: 0 },
    videos: { total: 4, done: 0 },
    composition: { done: false },
  }
  it('walks the workflow', () => {
    expect(deriveEpisodeStatus({ ...base, split: { scenes: 0, shots: 0, shotsReady: 0 } })).toBe(
      'planned',
    )
    expect(deriveEpisodeStatus({ ...base, split: { scenes: 1, shots: 4, shotsReady: 2 } })).toBe(
      'storyboarding',
    )
    expect(deriveEpisodeStatus(base)).toBe('producing')
    expect(deriveEpisodeStatus({ ...base, composition: { done: true } })).toBe('composed')
    expect(deriveEpisodeStatus({ ...base, composition: { done: true } }, { exported: true })).toBe(
      'exported',
    )
  })
  it('"exported" needs a cut to export', () => {
    expect(deriveEpisodeStatus(base, { exported: true })).toBe('producing')
  })
})
