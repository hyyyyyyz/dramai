import { submitBatch } from '../admission/index.ts'
import type {
  AdmissionContext,
  AdmissionTarget,
  BatchAdmission,
  BatchSubmitResult,
} from '../admission/index.ts'
import { loadProjection } from '../generation/projection.ts'
import { targetId } from '../generation/inputs.ts'
import { JobQueue } from '../jobs/queue.ts'
import type { PipelineDeps } from './deps.ts'
import { preflight } from '../admission/index.ts'

/**
 * 生成请求的入口：准入（整批）→ 入队 → 把镜头阶段标成 queued。
 * 只读预检用 `preflightTargets`，它和这里用的是同一份准入计算，不创建任务、不写任何东西。
 */
async function admissionContext(deps: PipelineDeps, projectId: string): Promise<AdmissionContext> {
  return {
    projection: await loadProjection(deps.store, projectId),
    models: deps.catalog.models,
    jobs: await deps.store.jobs.list({ projectId }),
    fileExists: (pid, path) => deps.files.exists(pid, path),
  }
}

export function createQueue(deps: PipelineDeps): JobQueue {
  return new JobQueue({
    jobs: deps.store.jobs,
    clock: deps.clock,
    ids: deps.ids,
    events: deps.events,
  })
}

export async function preflightTargets(
  deps: PipelineDeps,
  projectId: string,
  items: readonly AdmissionTarget[],
  options: { confirmUnverified?: boolean } = {},
): Promise<BatchAdmission> {
  return preflight(await admissionContext(deps, projectId), items, options)
}

export async function requestGeneration(
  deps: PipelineDeps,
  projectId: string,
  items: readonly AdmissionTarget[],
  options: { batchId?: string; confirmUnverified?: boolean } = {},
): Promise<BatchSubmitResult> {
  const ctx = await admissionContext(deps, projectId)
  const result = await submitBatch(ctx, createQueue(deps), items, {
    batchId: options.batchId ?? (items.length > 1 ? deps.ids.next('batch') : undefined),
    confirmUnverified: options.confirmUnverified,
  })
  // 新入队的镜头任务：阶段标成 queued，界面立刻能看到。
  for (const ok of result.succeeded) {
    if (ok.deduped) continue
    const item = items.find((i) => targetId(i.target) === ok.targetId)
    if (!item || !('shotId' in item.target)) continue
    const shot = await deps.store.shots.get(item.target.shotId)
    if (!shot) continue
    const stage =
      item.target.kind === 'shot_image'
        ? 'image'
        : item.target.kind === 'shot_video'
          ? 'video'
          : 'audio'
    await deps.store.shots.put({
      ...shot,
      stages: { ...shot.stages, [stage]: 'queued' },
      updatedAt: deps.clock.now(),
    })
  }
  return result
}

// === 整集预检 ===

import { evaluateArtifacts } from '../artifacts/staleness.ts'
import { estimateCost, totalCosts } from '../providers/catalog.ts'
import type { CostEstimate, CostTotals } from '../providers/catalog.ts'
import { episodeSourceText } from './episodes.ts'
import { episodeShots } from './entities.ts'
import { hasNarration } from '../domain/voice.ts'
import type { ProviderConfig } from '../providers/types.ts'

export interface EpisodePlan {
  assetSheets?: ProviderConfig
  shotImages?: ProviderConfig
  shotVideos?: ProviderConfig
  narration?: ProviderConfig
  /** 视频分辨率档位。 */
  resolution?: string
  /** 只包含还没有 current 产物的目标（默认 true）；false = 全部重做。 */
  onlyMissing?: boolean
  /** 角色设定图版式。 */
  sheetLayout?: 'multi_view' | 'per_angle' | 'single'
  /** 文本步骤用的大模型服务商；传了就把文本步骤的预估一并计入。 */
  textModel?: ProviderConfig
}

/** 一集要生成的全部目标（设定图 → 分镜图 → 视频 → 旁白），按依赖顺序。 */
export async function episodeTargets(
  deps: PipelineDeps,
  episodeId: string,
  plan: EpisodePlan,
): Promise<AdmissionTarget[]> {
  const episode = await deps.store.episodes.get(episodeId)
  if (!episode) throw new Error(`episode not found: ${episodeId}`)
  const projection = await loadProjection(deps.store, episode.projectId)
  const reports = evaluateArtifacts(projection)
  const shots = await episodeShots(deps.store, episodeId)
  const onlyMissing = plan.onlyMissing !== false
  const needs = (key: string) => !onlyMissing || reports.get(key)?.status !== 'current'
  const out: AdmissionTarget[] = []

  if (plan.assetSheets) {
    const used = new Set<string>()
    for (const s of shots) for (const r of projection.refs.get(s.id) ?? []) used.add(r.assetId)
    for (const id of used) {
      const asset = projection.assets.get(id)
      if (!asset) continue
      const layout = asset.kind === 'character' ? plan.sheetLayout : 'single'
      if (needs(`asset_sheet:${id}`)) {
        out.push({
          target: { kind: 'asset_sheet', assetId: id },
          provider: plan.assetSheets,
          sheetLayout: layout,
        })
      }
      for (const v of asset.variants) {
        if (v.origin === 'edit' && needs(`variant_sheet:${id}/${v.name}`)) {
          out.push({
            target: { kind: 'asset_sheet', assetId: id, variantName: v.name },
            provider: plan.assetSheets,
          })
        }
      }
    }
  }
  for (const s of shots) {
    if (plan.shotImages && needs(`shot_image:${s.id}`))
      out.push({ target: { kind: 'shot_image', shotId: s.id }, provider: plan.shotImages })
  }
  for (const s of shots) {
    if (plan.shotVideos && needs(`shot_video:${s.id}`)) {
      out.push({
        target: { kind: 'shot_video', shotId: s.id },
        provider: plan.shotVideos,
        resolution: plan.resolution,
      })
    }
  }
  for (const s of shots) {
    if (plan.narration && hasNarration(s) && needs(`shot_audio:${s.id}`))
      out.push({ target: { kind: 'shot_audio', shotId: s.id }, provider: plan.narration })
  }
  return out
}

export interface TextStepEstimate {
  step: 'episode_breakdown' | 'entities_extract' | 'shot_frames'
  /** 预计的 LLM 调用次数。 */
  calls: number
  /** 预计处理的字符数（输入为主，粗估）。 */
  chars: number
  estimate: CostEstimate
}

export interface EpisodePreflight {
  targets: AdmissionTarget[]
  admission: BatchAdmission
  /** 文本步骤（分镜拆解 / 实体抽取 / 镜头提示词）的预估——便宜但仍然计入合计。传了 `plan.textModel` 才有。 */
  textSteps: TextStepEstimate[]
  /** 预估费用，按服务商原始币种分开合计（不折算）。 */
  totals: CostTotals
}

/**
 * 整集的只读预检：逐项“能否生成、原因码、预估费用”。**不创建任务、不写任何东西。**
 * 注意：分镜图要求设定图已经存在，所以一个“从零开始”的整集预检里，分镜图会被报告为缺设定图——
 * 这正是该报告的价值；按依赖顺序分阶段预检 / 提交即可。
 */
export async function preflightEpisode(
  deps: PipelineDeps,
  episodeId: string,
  plan: EpisodePlan,
  options: { confirmUnverified?: boolean } = {},
): Promise<EpisodePreflight> {
  const episode = (await deps.store.episodes.get(episodeId))!
  const targets = await episodeTargets(deps, episodeId, plan)
  const admission = await preflightTargets(deps, episode.projectId, targets, options)
  const textSteps = plan.textModel ? await estimateTextSteps(deps, episodeId, plan.textModel) : []
  const estimates = [
    ...admission.results.flatMap((r) => (r.estimate ? [r.estimate] : [])),
    ...textSteps.map((t) => t.estimate),
  ]
  return { targets, admission, textSteps, totals: totalCosts(estimates) }
}

/** 文本步骤的粗估：按原文字数和镜头数估算调用次数与处理字数；大模型没有价目就如实标“未定价”。 */
export async function estimateTextSteps(
  deps: PipelineDeps,
  episodeId: string,
  llm: ProviderConfig,
): Promise<TextStepEstimate[]> {
  const episode = (await deps.store.episodes.get(episodeId))!
  const source = await episodeSourceText(deps, episode)
  const shots = await episodeShots(deps.store, episodeId)
  const profile = deps.catalog.models.lookup(llm).profile
  const chars = [...source].filter((c) => !/\s/u.test(c)).length
  const mk = (
    step: TextStepEstimate['step'],
    calls: number,
    charsTotal: number,
  ): TextStepEstimate => ({
    step,
    calls,
    chars: charsTotal,
    estimate: estimateCost(profile, { chars: charsTotal }),
  })
  return [
    mk('episode_breakdown', Math.max(1, Math.ceil(chars / 5000)), chars + shots.length * 400),
    mk('entities_extract', Math.max(1, Math.ceil(shots.length / 8)) + 2, shots.length * 500),
    mk('shot_frames', Math.max(1, Math.ceil(shots.length / 5)), shots.length * 1200),
  ]
}
