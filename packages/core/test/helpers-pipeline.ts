import { createPipelineHandlers } from '../src/pipeline/handlers.ts'
import { confirmCandidate, extractEntities } from '../src/pipeline/entities.ts'
import { breakdownEpisode } from '../src/pipeline/breakdown.ts'
import { planEpisodes } from '../src/pipeline/episodes.ts'
import { generateShotPrompts } from '../src/pipeline/frames.ts'
import { ingestMaterial } from '../src/pipeline/materials.ts'
import { JobWorker } from '../src/jobs/worker.ts'
import type { Job } from '../src/jobs/types.ts'
import { makeNovel } from './fakes.ts'
import type { PipelineEnv } from './fakes.ts'

export function makeWorker(
  env: PipelineEnv,
  lanes?: ConstructorParameters<typeof JobWorker>[0]['lanes'],
) {
  return new JobWorker({
    jobs: env.deps.store.jobs,
    clock: env.deps.clock,
    events: env.deps.events,
    handlers: createPipelineHandlers(env.deps),
    lanes,
    recovery: { listProviderConfigs: async () => env.deps.providers.list() },
  })
}

/** 反复 tick 直到没有排队 / 运行中的任务。 */
export async function runAll(env: PipelineEnv, worker = makeWorker(env)): Promise<Job[]> {
  for (let i = 0; i < 200; i++) {
    await worker.tick()
    await worker.idle()
    const open = await env.deps.store.jobs.list({ status: ['queued', 'running'] })
    if (open.length === 0) break
  }
  return env.deps.store.jobs.list()
}

/** 原文 → 分集 → 分镜 → 实体（全部确认为新资产）→ 镜头提示词。返回第一集。 */
export async function prepareEpisode(
  env: PipelineEnv,
  options: { chapters?: number; episode?: number; fill?: number } = {},
) {
  await ingestMaterial(env.deps, env.projectId, {
    name: '长篇.txt',
    bytes: new TextEncoder().encode(makeNovel(options.chapters ?? 2, 8, options.fill ?? 1)),
  })
  await planEpisodes(env.deps, env.projectId)
  const episodes = (await env.deps.store.episodes.listByProject(env.projectId)).sort(
    (a, b) => a.number - b.number,
  )
  const ep = episodes[options.episode ?? 0]
  await breakdownEpisode(env.deps, ep.id)
  const { candidates } = await extractEntities(env.deps, ep.id)
  for (const c of candidates.filter((x) => x.status === 'pending'))
    await confirmCandidate(env.deps, c.id, { action: 'accept_new' })
  await generateShotPrompts(env.deps, ep.id)
  return ep
}
