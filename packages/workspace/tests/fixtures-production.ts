import type {
  ArtifactReport,
  Asset,
  Candidate,
  CallOutput,
  Shot,
  Verdict,
  PreflightResult,
} from '@dramai/api'

let n = 0
const id = (p: string) => `${p}_${++n}`

export const emptySlot = () => ({ currentVersionId: null, versions: [] })

export function version(
  kind: 'image' | 'video',
  vid = id('ver'),
  extra: Record<string, unknown> = {},
) {
  return {
    id: vid,
    kind,
    file: {
      path: `${kind}s/${vid}.${kind === 'image' ? 'png' : 'mp4'}`,
      mime: kind === 'image' ? 'image/png' : 'video/mp4',
      bytes: 1,
      sha256: vid,
    },
    source: 'generated' as const,
    createdAt: 1,
    ...extra,
  }
}

export function slotWith(kind: 'image' | 'video', count = 1) {
  const versions = Array.from({ length: count }, () => version(kind))
  return { currentVersionId: versions[count - 1]!.id, versions }
}

export function makeShot(patch: Partial<Shot> = {}): Shot {
  const sid = patch.id ?? id('shot')
  return {
    schemaVersion: 1,
    id: sid,
    projectId: 'proj_1',
    sceneId: 'scene_1',
    number: 1,
    title: '黄昏的夹道',
    scriptExcerpt: '黄昏，红墙夹道。小宫女端着食盒低头疾走。',
    cameraShot: 'LS',
    angle: 'eye_level',
    movement: 'dolly_in',
    durationSec: 5,
    moodTags: [],
    dialogue: [],
    actionBeats: [],
    prompts: { firstFrame: 'a maid on a red palace wall at dusk', video: 'slow push in' },
    ready: true,
    stages: { image: 'pending', video: 'pending', audio: 'pending' },
    image: emptySlot(),
    video: emptySlot(),
    narrationAudio: emptySlot(),
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

export function makeAsset(patch: Partial<Asset> = {}): Asset {
  return {
    schemaVersion: 1,
    id: patch.id ?? id('asset'),
    projectId: 'proj_1',
    number: 1,
    kind: 'character',
    name: '小宫女',
    aliases: [],
    sheet: emptySlot(),
    originals: [],
    variants: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

export function makeCandidate(patch: Partial<Candidate> = {}): Candidate {
  return {
    schemaVersion: 1,
    id: patch.id ?? id('cand'),
    projectId: 'proj_1',
    kind: 'character',
    name: '掌事姑姑',
    aliases: [],
    confidence: 0.9,
    confidenceBand: 'high',
    evidence: '掌事姑姑站在门外，没有进来。',
    shotIds: [],
    variants: [],
    status: 'pending',
    extractedAt: 1,
    createdAt: 1,
    ...patch,
  }
}

export const makeVerdict = (targetId: string, patch: Partial<Verdict> = {}): Verdict => ({
  targetId,
  status: 'accepted',
  reasons: [],
  warnings: [],
  unverified: [],
  ...patch,
})

export const emptyTotals = (): PreflightResult['totals'] => ({
  byCurrency: {},
  unpriced: 0,
  remaining: {},
  isEstimate: true,
})

export const makePreflight = (
  results: Verdict[],
  totals: Partial<PreflightResult['totals']> = {},
): PreflightResult => ({
  ok: results.every((r) => r.status === 'accepted'),
  results,
  totals: { ...emptyTotals(), ...totals },
})

export const staleReport = (key: string, changes: ArtifactReport['changes']): ArtifactReport => ({
  key,
  kind: key.startsWith('shot_video') ? 'shot_video' : 'shot_image',
  status: 'stale',
  reason: 'upstream_changed',
  changes,
  staleUpstream: [],
})

export function makeEpisodeDetail(
  shots: Shot[],
  sceneTitle = '宫墙夹道',
): CallOutput<'episodes.get'> {
  const scene = {
    schemaVersion: 1,
    id: 'scene_1',
    projectId: 'proj_1',
    episodeId: 'ep_1',
    number: 1,
    title: sceneTitle,
    timeOfDay: '黄昏',
    shotOrder: shots.map((s) => s.id),
    createdAt: 1,
    updatedAt: 1,
  }
  return {
    episode: {
      schemaVersion: 1,
      id: 'ep_1',
      projectId: 'proj_1',
      number: 2,
      title: '那封信',
      status: 'storyboarding',
      sceneOrder: ['scene_1'],
      createdAt: 1,
      updatedAt: 1,
    },
    scenes: [scene],
    shots: shots.map((s) => ({ ...s, sceneId: 'scene_1' })),
    refs: [],
    progress: {
      episodeId: 'ep_1',
      split: { scenes: 1, shots: shots.length, shotsReady: shots.length },
      candidates: { total: 0, pending: 0, accepted_new: 0, linked: 0, ignored: 0, handled: 0 },
      sheets: { total: 0, done: 0 },
      images: { total: shots.length, done: 0 },
      videos: { total: shots.length, done: 0 },
      composition: { done: false },
    },
  }
}

export const makeProvider = (patch: Record<string, unknown> = {}) => ({
  id: 'prov_v',
  label: 'Wan Flash',
  kind: 'video' as const,
  protocol: 'aliyun-video' as const,
  baseUrl: 'http://127.0.0.1:8788',
  model: 'wan2.2-i2v-flash',
  enabled: true,
  hasKey: true,
  keyMask: 'moc…cret',
  ...patch,
})

export const makeCapabilityView = (
  nativeAudio: 'supported' | 'unsupported' | 'unverified' = 'unsupported',
) => ({
  declared: true,
  capability: {
    media: 'video' as const,
    modes: { i2v: 'supported' as const },
    refImages: { support: 'unsupported' as const },
    refVideos: { support: 'unsupported' as const },
    refAudios: { support: 'unsupported' as const },
    firstFrame: 'supported' as const,
    lastFrame: 'unsupported' as const,
    nativeAudio,
    durations: { support: 'supported' as const, value: { values: [5] } },
    resolutions: { support: 'supported' as const, value: ['720P'] },
    aspectRatios: { support: 'unverified' as const },
  },
  pricing: [],
  quirks: [],
})
