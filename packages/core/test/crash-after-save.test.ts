import { beforeAll, describe, expect, it } from 'vitest'
import type { AdmissionTarget } from '../src/admission/index.ts'
import { currentVersion } from '../src/domain/index.ts'
import type { Shot } from '../src/domain/index.ts'
import { episodeShots } from '../src/pipeline/entities.ts'
import { requestGeneration } from '../src/pipeline/request.ts'
import { locateMedia, makePipelineEnv } from './fakes.ts'
import type { MediaEnv, PipelineEnv } from './fakes.ts'
import { SCHEMA_VERSIONS } from '../src/domain/index.ts'
import { JobQueue } from '../src/jobs/index.ts'
import { makeWorker, prepareEpisode, runAll } from './helpers-pipeline.ts'

/**
 * The process stops after the new version has been saved but before the job is marked succeeded (everything is
 * committed; the job still says "running"). The reviewer saw the shot end up with a second video version after the
 * restart, with no new upstream submission. Cause: the restart resumes the job at the download step (the result
 * address is in its checkpoint) and the handler then downloaded and saved the same product again. The behaviour is
 * the original one - the same test on 932aa26 (the 0.5.0-beta.1 release) shows 2 versions as well.
 * Fix: a resumed job first looks for a version carrying its own job id and, if there is one, finishes with it.
 */

let media: MediaEnv | undefined
let env: PipelineEnv
let shots: Shot[]

beforeAll(async () => {
  media = await locateMedia()
  if (!media) return
  env = await makePipelineEnv(media, { aspectRatio: '9:16' })
  const ep = await prepareEpisode(env)
  shots = await episodeShots(env.deps.store, ep.id)
  const used = new Set<string>()
  for (const s of shots)
    for (const r of await env.deps.store.shotRefs.listByShot(s.id)) used.add(r.assetId)
  await requestGeneration(
    env.deps,
    env.projectId,
    [...used].map(
      (id): AdmissionTarget => ({
        target: { kind: 'asset_sheet', assetId: id },
        provider: env.provider('img'),
        sheetLayout: 'multi_view',
      }),
    ),
  )
  await runAll(env)
  await requestGeneration(
    env.deps,
    env.projectId,
    shots.map(
      (s): AdmissionTarget => ({
        target: { kind: 'shot_image', shotId: s.id },
        provider: env.provider('img'),
      }),
    ),
  )
  await runAll(env)
}, 240_000)

const real = (name: string, fn: () => Promise<void>) =>
  it(name, async (ctx) => (media ? fn() : ctx.skip()), 120_000)

/** The state a crash leaves: everything committed, but the job still says "running". */
async function crashBeforeSuccess(jobId: string) {
  await env.deps.store.jobs.patch(jobId, {
    status: 'running',
    finishedAt: undefined,
    result: undefined,
    stage: 'processing',
  })
}

describe('restart after the version was saved but before the job was marked succeeded', () => {
  const video = (shot: Shot): AdmissionTarget => ({
    target: { kind: 'shot_video', shotId: shot.id },
    provider: env.provider('vid'),
    resolution: '720P',
    confirmUnverified: true,
  })
  const versions = async (shotId: string) =>
    (await env.deps.store.shots.get(shotId))!.video.versions.map((v) => v.id)
  const resume = async (jobId: string) => {
    await makeWorker(env).reconcileOrphans()
    return (await runAll(env)).find((j) => j.id === jobId)!
  }

  real(
    'VIDEO: the job finishes with the version it already saved - no second version, nothing downloaded again',
    async () => {
      const shot = shots[0]!
      await requestGeneration(env.deps, env.projectId, [video(shot)], { confirmUnverified: true })
      const first = (await runAll(env)).filter((j) => j.operation === 'shot_video').at(-1)!
      expect(first.status).toBe('succeeded')
      expect(first.providerJobId).toBeTruthy()
      expect(first.resultUrl).toBeTruthy()
      const before = await versions(shot.id)
      const current = currentVersion((await env.deps.store.shots.get(shot.id))!.video)!.id
      const requestsBefore = env.providers.requests.length

      await crashBeforeSuccess(first.id)
      const after = await resume(first.id)

      expect(after.status).toBe('succeeded')
      expect(await versions(shot.id)).toEqual(before) // not a second version
      expect(currentVersion((await env.deps.store.shots.get(shot.id))!.video)!.id).toBe(current)
      expect(env.providers.requests.length).toBe(requestsBefore) // not a download, not a poll, not a submit
      expect(after.result).toMatchObject({ versionId: current, alreadySaved: true })
    },
  )

  real(
    'VIDEO: a crash BEFORE the version was saved still finishes normally, with exactly one version',
    async () => {
      const shot = shots[1] ?? shots[0]!
      await requestGeneration(env.deps, env.projectId, [video(shot)], { confirmUnverified: true })
      const first = (await runAll(env))
        .filter((j) => j.id !== undefined && j.shotId === shot.id)
        .at(-1)!
      expect(first.status).toBe('succeeded')
      // roll the shot back to "nothing saved yet" but keep the checkpoint (upstream task number and result address)
      const sh = (await env.deps.store.shots.get(shot.id))!
      await env.deps.store.shots.put({ ...sh, video: { currentVersionId: null, versions: [] } })
      const submitsBefore = env.providers.posts('/video-synthesis').length
      await crashBeforeSuccess(first.id)
      const after = await resume(first.id)
      expect(after.status).toBe('succeeded')
      expect(await versions(shot.id)).toHaveLength(1)
      expect(after.result).not.toHaveProperty('alreadySaved')
      expect(env.providers.posts('/video-synthesis').length).toBe(submitsBefore) // resumed, never re-submitted
    },
  )

  real(
    "review scenario: an earlier attempt saved a version and failed; the paid retry is killed before it saves - the retry's product is downloaded (both versions stay)",
    async () => {
      const shot = shots[3] ?? shots[0]!
      await requestGeneration(env.deps, env.projectId, [video(shot)], { confirmUnverified: true })
      const first = (await runAll(env))
        .filter((j) => j.shotId === shot.id && j.operation === 'shot_video')
        .at(-1)!
      expect(first.status).toBe('succeeded')
      const v1 = (await versions(shot.id)).at(-1)!
      const stored = (await env.deps.store.shots.get(shot.id))!.video.versions.find(
        (v) => v.id === v1,
      )!
      expect(stored).toMatchObject({ jobId: first.id, attempt: first.attempt })
      // attempt 1 saved the version but the job ended up failed (e.g. the stage write after the save failed)
      await env.deps.store.jobs.patch(first.id, {
        status: 'failed',
        error: {
          category: 'generation_failed',
          code: 'LATE_FAILURE',
          message: 'x',
          recoverable: false,
        },
        finishedAt: env.deps.clock.now(),
      })
      // the user confirms and retries: same job id, attempt + 1, a new upstream task
      const retried = await new JobQueue({
        jobs: env.deps.store.jobs,
        clock: env.deps.clock,
        ids: env.deps.ids,
      }).retry(first.id, { confirmRecharge: true })
      expect(retried.ok).toBe(true)
      expect((await env.deps.store.jobs.get(first.id))!.attempt).toBe(first.attempt + 1)
      // the second attempt submitted and got a result address, then the process was killed before saving
      await env.deps.store.jobs.patch(first.id, {
        status: 'running',
        startedAt: env.deps.clock.now(),
        providerJobId: first.providerJobId,
        resultUrl: first.resultUrl,
        stage: 'downloading',
      })
      const requestsBefore = env.providers.requests.length
      const after = await resume(first.id)
      expect(after.status, JSON.stringify(after.error)).toBe('succeeded')
      const all = await versions(shot.id)
      expect(all).toHaveLength(2) // the old one and the product of the second attempt
      expect(all).toContain(v1)
      expect(after.result).not.toHaveProperty('alreadySaved')
      expect(env.providers.requests.slice(requestsBefore).some((r) => r.method === 'GET')).toBe(
        true,
      ) // it was downloaded
      const second = (await env.deps.store.shots.get(shot.id))!.video.versions.find(
        (v) => v.id !== v1,
      )!
      expect(second).toMatchObject({ jobId: first.id, attempt: first.attempt + 1 })
    },
  )

  real(
    'a version saved before versions carried an attempt number cannot be confirmed: the product is downloaded again (the safe direction)',
    async () => {
      const shot = shots[4] ?? shots[0]!
      await requestGeneration(env.deps, env.projectId, [video(shot)], { confirmUnverified: true })
      const first = (await runAll(env))
        .filter((j) => j.shotId === shot.id && j.operation === 'shot_video')
        .at(-1)!
      const sh = (await env.deps.store.shots.get(shot.id))!
      await env.deps.store.shots.put({
        ...sh,
        video: {
          ...sh.video,
          versions: sh.video.versions.map((v) => {
            const rest = { ...v }
            delete rest.attempt
            return rest
          }),
        },
      })
      const before = (await versions(shot.id)).length
      await crashBeforeSuccess(first.id)
      const after = await resume(first.id)
      expect(after.status).toBe('succeeded')
      expect(after.result).not.toHaveProperty('alreadySaved')
      expect(await versions(shot.id)).toHaveLength(before + 1) // one too many is acceptable, one too few is not
    },
  )

  real(
    'a result the user chose to ignore (not the current version) is still recognised; two shots never mix up their jobs',
    async () => {
      const [a, b] = [shots[0]!, shots[1] ?? shots[0]!]
      expect(a.id).not.toBe(b.id)
      const ja = (await env.deps.store.jobs.list()).filter(
        (j) => j.shotId === a.id && j.operation === 'shot_video',
      )[0]!
      const jb = (await env.deps.store.jobs.list()).filter(
        (j) => j.shotId === b.id && j.operation === 'shot_video',
      )[0]!
      // shot a: the saved version is not current (as if the result had been ignored)
      const sa = (await env.deps.store.shots.get(a.id))!
      await env.deps.store.shots.put({ ...sa, video: { ...sa.video, currentVersionId: null } })
      const beforeA = await versions(a.id)
      const beforeB = await versions(b.id)
      const requestsBefore = env.providers.requests.length
      await crashBeforeSuccess(ja.id)
      await crashBeforeSuccess(jb.id)
      await makeWorker(env).reconcileOrphans()
      const done = await runAll(env)
      expect(done.find((j) => j.id === ja.id)!.result).toMatchObject({ alreadySaved: true })
      expect(done.find((j) => j.id === jb.id)!.result).toMatchObject({ alreadySaved: true })
      expect(await versions(a.id)).toEqual(beforeA)
      expect(await versions(b.id)).toEqual(beforeB)
      expect(env.providers.requests.length).toBe(requestsBefore)
    },
  )

  real(
    'IMAGE (a resumed job whose version is already saved) finishes with it; an asset sheet and its variant too',
    async () => {
      const shot = shots[2] ?? shots[0]!
      const sh = (await env.deps.store.shots.get(shot.id))!
      const saved = sh.image.versions.at(-1)!
      const now = env.deps.clock.now()
      const asset = (await env.deps.store.assets.listByProject(env.projectId))[0]!
      const mkJob = async (id: string, target: Record<string, unknown>) =>
        env.deps.store.jobs.insert({
          schemaVersion: SCHEMA_VERSIONS.job,
          id,
          type: 'image',
          operation: target.kind === 'shot_image' ? 'shot_image' : 'asset_sheet',
          projectId: env.projectId,
          shotId: target.kind === 'shot_image' ? shot.id : undefined,
          params: { target },
          paid: true,
          status: 'running',
          attempt: 0,
          previousProviderJobIds: [],
          providerJobId: 'up-1', // an upstream task number: the restart resumes instead of failing
          resultUrl: 'https://cdn.fake/x.png',
          createdAt: now,
          updatedAt: now,
          providerSnapshot: {
            providerConfigId: 'img',
            protocol: env.provider('img').protocol,
            baseUrl: env.provider('img').baseUrl,
            model: env.provider('img').model,
          },
        })
      // the shot image: the version that carries this job's id
      await env.deps.store.shots.put({
        ...sh,
        image: {
          ...sh.image,
          versions: sh.image.versions.map((v) =>
            v.id === saved.id ? { ...v, jobId: 'job_img_saved', attempt: 0 } : v,
          ),
        },
      })
      await mkJob('job_img_saved', { kind: 'shot_image', shotId: shot.id })
      // the asset sheet: same idea on the asset
      const a = (await env.deps.store.assets.get(asset.id))!
      const sheetSaved = a.sheet.versions.at(-1)!
      await env.deps.store.assets.put({
        ...a,
        sheet: {
          ...a.sheet,
          versions: a.sheet.versions.map((v) =>
            v.id === sheetSaved.id ? { ...v, jobId: 'job_sheet_saved', attempt: 0 } : v,
          ),
        },
      })
      await mkJob('job_sheet_saved', { kind: 'asset_sheet', assetId: asset.id })
      const requestsBefore = env.providers.requests.length
      await makeWorker(env).reconcileOrphans()
      const jobs = await runAll(env)
      const img = jobs.find((j) => j.id === 'job_img_saved')!
      const sheet = jobs.find((j) => j.id === 'job_sheet_saved')!
      expect(img.status, JSON.stringify(img.error)).toBe('succeeded')
      expect(img.result).toMatchObject({ versionId: saved.id, alreadySaved: true })
      expect(sheet.status, JSON.stringify(sheet.error)).toBe('succeeded')
      expect(sheet.result).toMatchObject({ versionId: sheetSaved.id, alreadySaved: true })
      expect(env.providers.requests.length).toBe(requestsBefore)
      expect((await env.deps.store.shots.get(shot.id))!.image.versions).toHaveLength(
        sh.image.versions.length,
      )
      expect((await env.deps.store.assets.get(asset.id))!.sheet.versions).toHaveLength(
        a.sheet.versions.length,
      )
    },
  )

  real(
    "an asset sheet whose extra view (not the main sheet) carries the job's version is recognised too",
    async () => {
      const asset = (await env.deps.store.assets.listByProject(env.projectId))[1]!
      const a = (await env.deps.store.assets.get(asset.id))!
      const base = a.sheet.versions.at(-1)!
      await env.deps.store.assets.put({
        ...a,
        sheetViews: {
          ...(a.sheetViews ?? {}),
          side: {
            currentVersionId: 'v_side',
            versions: [{ ...base, id: 'v_side', jobId: 'job_view_saved', attempt: 3 }],
          },
        },
      })
      const now = env.deps.clock.now()
      await env.deps.store.jobs.insert({
        schemaVersion: SCHEMA_VERSIONS.job,
        id: 'job_view_saved',
        type: 'image',
        operation: 'asset_sheet',
        projectId: env.projectId,
        params: { target: { kind: 'asset_sheet', assetId: asset.id } },
        paid: true,
        status: 'running',
        attempt: 3,
        previousProviderJobIds: [],
        providerJobId: 'up-9',
        resultUrl: 'https://cdn.fake/y.png',
        createdAt: now,
        updatedAt: now,
        providerSnapshot: {
          providerConfigId: 'img',
          protocol: env.provider('img').protocol,
          baseUrl: env.provider('img').baseUrl,
          model: env.provider('img').model,
        },
      })
      const requestsBefore = env.providers.requests.length
      await makeWorker(env).reconcileOrphans()
      const job = (await runAll(env)).find((j) => j.id === 'job_view_saved')!
      expect(job.status, JSON.stringify(job.error)).toBe('succeeded')
      expect(job.result).toMatchObject({ versionId: 'v_side', alreadySaved: true })
      expect(env.providers.requests.length).toBe(requestsBefore)
    },
  )

  real(
    'AUDIO and sync IMAGE (no upstream task number): unchanged - the job is marked failed, no second version',
    async () => {
      // reported, not changed: recovery cannot tell a lost call from a saved one without the store (see the report)
      const shot = shots.find((s) => s.narration && !s.dialogue.some((d) => d.text.trim()))!
      await requestGeneration(
        env.deps,
        env.projectId,
        [
          {
            target: { kind: 'shot_audio', shotId: shot.id },
            provider: env.provider('tts'),
            confirmUnverified: true,
          },
        ],
        { confirmUnverified: true },
      )
      const first = (await runAll(env)).filter((j) => j.operation === 'shot_audio').at(-1)!
      expect(first.status).toBe('succeeded')
      const n = async () =>
        (await env.deps.store.shots.get(shot.id))!.narrationAudio.versions.length
      const before = await n()
      await crashBeforeSuccess(first.id)
      const after = await resume(first.id)
      expect(after.status).toBe('failed')
      expect(after.error).toMatchObject({
        category: 'submission_unknown',
        code: 'SYNC_CALL_INTERRUPTED',
      })
      expect(await n()).toBe(before)
    },
  )
})
