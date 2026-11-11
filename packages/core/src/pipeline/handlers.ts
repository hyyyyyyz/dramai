import type { JobHandler } from '../jobs/worker.ts'
import { JobFailure } from '../jobs/worker.ts'
import type { NewJob } from '../jobs/queue.ts'
import { InFlightConflictError } from '../jobs/queue.ts'
import type { Job } from '../jobs/types.ts'
import type { ProviderConfig } from '../providers/types.ts'
import { breakdownEpisode } from './breakdown.ts'
import { createComposeHandler } from './compose.ts'
import type { PipelineDeps } from './deps.ts'
import { extractEntities } from './entities.ts'
import { planEpisodes } from './episodes.ts'
import { generateShotPrompts } from './frames.ts'
import { createGenerationHandlers } from './generate.ts'
import { createQueue } from './request.ts'

/**
 * 任务处理器注册表：交给 `JobWorker` 的 `handlers`。
 *
 * | operation          | 车道   | 做什么                                           |
 * | ------------------ | ------ | ------------------------------------------------ |
 * | episodes_plan      | text   | 原文 → 分集规划                                  |
 * | episode_breakdown  | text   | 一集 → 场 → 分镜                                 |
 * | entities_extract   | text   | 逐镜抽取实体、合并、变体分析                      |
 * | shot_frames        | text   | 镜头提示词（首帧 / 视频 / 变化幅度）              |
 * | asset_sheet        | image  | 设定图（含衍生形态的图片编辑）                   |
 * | shot_image         | image  | 分镜图（多参考图）                               |
 * | shot_video         | video  | 图生视频                                         |
 * | shot_audio         | audio  | 旁白 TTS                                         |
 * | compose            | render | 时间线 → ffmpeg 成片                             |
 */
export function createPipelineHandlers(deps: PipelineDeps): Record<string, JobHandler> {
  const text =
    (fn: (job: Job, signal: AbortSignal) => Promise<Record<string, unknown>>): JobHandler =>
    async (ctx) => {
      await ctx.setStage('processing')
      return { result: await fn(ctx.job, ctx.signal) }
    }
  const need = (job: Job, key: 'episodeId' | 'projectId'): string => {
    const v = key === 'episodeId' ? job.episodeId : job.projectId
    if (!v)
      throw new JobFailure({
        category: 'invalid_input',
        code: 'BAD_JOB_PARAMS',
        message: `任务缺少 ${key}`,
        recoverable: false,
      })
    return v
  }
  return {
    ...createGenerationHandlers(deps),
    compose: createComposeHandler(deps),
    episodes_plan: text(async (job, signal) => {
      const r = await planEpisodes(deps, need(job, 'projectId'), {
        ...(job.params as object),
        signal,
      })
      return {
        episodes: r.episodes.length,
        fallbackBatches: r.fallbackBatches,
        llmCalls: r.llmCalls,
      }
    }),
    episode_breakdown: text(async (job, signal) => {
      const r = await breakdownEpisode(deps, need(job, 'episodeId'), {
        ...(job.params as object),
        signal,
      })
      return {
        scenes: r.scenes.length,
        shots: r.shots.length,
        warnings: r.warnings.length,
        llmCalls: r.llmCalls,
      }
    }),
    entities_extract: text(async (job, signal) => {
      const r = await extractEntities(deps, need(job, 'episodeId'), {
        ...(job.params as object),
        signal,
      })
      return { candidates: r.candidates.length, autoLinked: r.autoLinked, llmCalls: r.llmCalls }
    }),
    shot_frames: text(async (job, signal) => {
      const r = await generateShotPrompts(deps, need(job, 'episodeId'), {
        ...(job.params as object),
        signal,
      })
      return { shots: r.updated.length, missing: r.missing.length, llmCalls: r.llmCalls }
    }),
  }
}

export type PipelineStep =
  | { operation: 'episodes_plan'; projectId: string; params?: Record<string, unknown> }
  | {
      operation: 'episode_breakdown' | 'entities_extract' | 'shot_frames'
      projectId: string
      episodeId: string
      params?: Record<string, unknown>
    }
  | {
      operation: 'compose'
      projectId: string
      episodeId: string
      params?: { subtitles?: 'burn' | 'soft' | 'none'; shortSide?: number }
    }

/**
 * 把一个流水线步骤作为任务入队（立刻返回任务）。
 * 同一集同一步骤同一时刻只能有一个在途任务（原子互斥）；文本步骤走 `text` 车道，合成走 `render` 车道。
 */
export async function enqueueStep(
  deps: PipelineDeps,
  step: PipelineStep,
  options: { llmProvider?: ProviderConfig } = {},
): Promise<{ job: Job; deduped: boolean }> {
  const episodeId = 'episodeId' in step ? step.episodeId : undefined
  const isRender = step.operation === 'compose'
  const input: NewJob = {
    type: isRender ? 'render' : 'text',
    operation: step.operation,
    projectId: step.projectId,
    episodeId,
    params: step.params ?? {},
    // 文本步骤很便宜且写库是原子的，重跑没有副作用：重启后自动重新排队，不需要用户确认。
    paid: false,
    exclusiveKey: `${step.operation}:${episodeId ?? step.projectId}`,
    dedupeKey: `${step.operation}:${episodeId ?? step.projectId}`,
    providerLabel: options.llmProvider?.label,
    providerSnapshot: options.llmProvider
      ? {
          providerConfigId: options.llmProvider.id,
          protocol: options.llmProvider.protocol,
          baseUrl: options.llmProvider.baseUrl,
          model: options.llmProvider.model,
        }
      : undefined,
  }
  try {
    return await createQueue(deps).enqueue(input)
  } catch (err) {
    if (err instanceof InFlightConflictError) return { job: err.existing, deduped: true }
    throw err
  }
}
