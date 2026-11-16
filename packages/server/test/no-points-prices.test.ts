import { afterEach, describe, expect, it } from 'vitest'
import { createEpisode, createProject, createScene, createShot } from '@dramai/core'
import { cleanupAll, startServer } from './helpers.ts'

afterEach(cleanupAll)

/**
 * The price tables in a reseller's points (currency `PTC`) were removed from six model profiles, because a price in
 * someone else's points was shown on every address that used the same protocol + model (also on the vendor's own).
 * Their estimates are now honestly "unpriced". Nothing else about the admission verdict changed: the `status`, reasons
 * and warnings below are what `generate.preflight` answered for the same input before the tables were removed.
 */
const SIX: Array<{
  protocol: string
  model: string
  kind: 'image' | 'video'
  status: 'accepted' | 'blocked'
  reasons: string[]
  warnings: string[]
}> = [
  {
    protocol: 'gemini-image',
    model: 'gemini-2.5-flash-image',
    kind: 'image',
    status: 'accepted',
    reasons: [],
    warnings: ['CAPABILITY_UNVERIFIED'],
  },
  {
    protocol: 'openai-images',
    model: 'doubao-seedream-5-0-260128',
    kind: 'image',
    status: 'accepted',
    reasons: [],
    warnings: ['CAPABILITY_UNVERIFIED'],
  },
  {
    protocol: 'aliyun-video',
    model: 'wan2.2-i2v-flash',
    kind: 'video',
    status: 'blocked',
    reasons: ['START_FRAME_MISSING'],
    warnings: [],
  },
  {
    protocol: 'aliyun-video',
    model: 'wan2.2-i2v-plus',
    kind: 'video',
    status: 'blocked',
    reasons: ['START_FRAME_MISSING'],
    warnings: [
      'CAPABILITY_UNVERIFIED',
      'CAPABILITY_UNVERIFIED',
      'CAPABILITY_UNVERIFIED',
      'CAPABILITY_UNVERIFIED',
    ],
  },
  {
    protocol: 'aliyun-video',
    model: 'wan2.5-i2v-preview',
    kind: 'video',
    status: 'blocked',
    reasons: ['START_FRAME_MISSING'],
    warnings: [
      'CAPABILITY_UNVERIFIED',
      'CAPABILITY_UNVERIFIED',
      'CAPABILITY_UNVERIFIED',
      'CAPABILITY_UNVERIFIED',
    ],
  },
  {
    protocol: 'aliyun-video',
    model: 'wan2.7-i2v',
    kind: 'video',
    status: 'blocked',
    reasons: ['START_FRAME_MISSING'],
    warnings: [
      'CAPABILITY_UNVERIFIED',
      'CAPABILITY_UNVERIFIED',
      'CAPABILITY_UNVERIFIED',
      'CAPABILITY_UNVERIFIED',
    ],
  },
]
const ACCEPTED = [
  'mode:t2i',
  'mode:i2i',
  'mode:i2v',
  'refImages',
  'aspectRatio',
  'firstFrame',
  'duration',
  'resolution',
]

describe('generate.preflight for the models whose points prices were removed', () => {
  it.each(SIX)(
    '$protocol / $model: same verdict as before, estimate "unpriced", no points anywhere',
    async (m) => {
      const h = await startServer({ startWorker: false })
      const { store, secrets } = h.server.ctx
      await secrets.set('k', 'sk-test-key-0123456789')
      const now = 1
      let project = createProject({ id: 'p1', name: 't', aspectRatio: '9:16', now })
      let episode = createEpisode({ id: 'e1', projectId: 'p1', number: 1, title: 'e', now })
      let scene = createScene({ id: 's1', projectId: 'p1', episodeId: 'e1', number: 1, now })
      const shot = {
        ...createShot({ id: 'sh1', projectId: 'p1', sceneId: 's1', number: 1, now }),
        prompts: { firstFrame: 'a rainy street', video: 'camera pushes in' },
        durationSec: 5,
      }
      scene = { ...scene, shotOrder: ['sh1'] }
      episode = { ...episode, sceneOrder: ['s1'] }
      project = { ...project, episodeOrder: ['e1'] }
      await store.projects.put(project)
      await store.episodes.put(episode)
      await store.scenes.put(scene)
      await store.shots.put(shot)
      await store.providers.put({
        id: 'prov',
        label: 'prov',
        kind: m.kind,
        protocol: m.protocol,
        baseUrl: 'https://x.example.test',
        model: m.model,
        enabled: true,
        secretRef: 'k',
        acceptedUnverified: ACCEPTED,
      } as never)
      const target =
        m.kind === 'image'
          ? { kind: 'shot_image' as const, shotId: 'sh1' }
          : { kind: 'shot_video' as const, shotId: 'sh1' }
      const res = await h.client.call('generate.preflight', {
        params: { projectId: 'p1' },
        body: {
          items: [
            { target, providerId: 'prov', ...(m.kind === 'video' ? { resolution: '720P' } : {}) },
          ],
          confirmUnverified: true,
        },
      })
      const r = res.results[0]!
      expect({
        status: r.status,
        reasons: r.reasons.map((x) => x.code),
        warnings: r.warnings.map((x) => x.code),
      }).toEqual({
        status: m.status,
        reasons: m.reasons,
        warnings: m.warnings,
      })
      expect(r.estimate).toEqual({ priced: false, reason: '该型号未定价' })
      expect(res.totals.byCurrency).toEqual({})
      expect(res.totals.unpriced).toBe(1)
      expect(JSON.stringify(res)).not.toContain('PTC')
    },
  )
})
