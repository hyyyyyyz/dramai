import type { GenerateItem, GenerateResult, PreflightResult, Verdict } from '@dramai/api'
import { preflightTargets, requestGeneration, targetId } from '@dramai/core'
import type {
  AdmissionTarget,
  BatchAdmission,
  GenerationTarget,
  ProviderConfig,
  ProviderKind,
  TargetVerdict,
} from '@dramai/core'
import type { ServerContext } from '../context.ts'
import type { RouteRegistry } from '../handle.ts'
import { summarizeCosts } from '../services/cost.ts'
import { requireProject } from './common.ts'

const KIND_FOR_TARGET: Record<GenerationTarget['kind'], ProviderKind> = {
  asset_sheet: 'image',
  shot_image: 'image',
  shot_video: 'video',
  shot_audio: 'tts',
}

const KIND_LABEL: Record<ProviderKind, string> = {
  llm: '大模型',
  image: '图片',
  video: '视频',
  tts: '配音',
}

interface Resolved {
  item: GenerateItem
  target: GenerationTarget
  id: string
  provider?: ProviderConfig
  /** 无法确定服务商时的原因（该项直接阻断，不是 500）。 */
  problem?: { code: string; message: string }
}

async function resolveItems(ctx: ServerContext, items: GenerateItem[]): Promise<Resolved[]> {
  const out: Resolved[] = []
  for (const item of items) {
    const target = item.target as GenerationTarget
    const kind = KIND_FOR_TARGET[target.kind]
    const base = { item, target, id: targetId(target) }
    if (item.providerId) {
      const provider = await ctx.store.providers.get(item.providerId)
      out.push(
        provider
          ? { ...base, provider }
          : {
              ...base,
              problem: {
                code: 'PROVIDER_NOT_FOUND',
                message: `服务商配置不存在：${item.providerId}。请重新选择。`,
              },
            },
      )
      continue
    }
    const provider = await ctx.activeProvider(kind)
    out.push(
      provider
        ? { ...base, provider }
        : {
            ...base,
            problem: {
              code: 'NO_PROVIDER',
              message: `还没有选中可用的${KIND_LABEL[kind]}服务商：请先到「设置 → 服务商」添加并选中一个，或在请求里指定 providerId。`,
            },
          },
    )
  }
  return out
}

const admissionItem = (r: Resolved): AdmissionTarget => ({
  target: r.target,
  provider: r.provider!,
  resolution: r.item.resolution,
  ...(r.item.videoRefs ? { videoRefs: true } : {}),
  sheetLayout: r.item.sheetLayout,
  confirmResubmit: r.item.confirmResubmit,
  confirmUnverified: r.item.confirmUnverified,
})

function toVerdict(v: TargetVerdict): Verdict {
  return {
    targetId: v.targetId,
    status: v.status,
    reasons: v.reasons,
    warnings: v.warnings,
    unverified: v.unverified,
    ...(v.blockedBy ? { blockedBy: v.blockedBy } : {}),
    ...(v.estimate ? { estimate: v.estimate } : {}),
    ...(v.video ? { video: v.video } : {}),
  }
}

/**
 * 把核心的批量准入结果与“无法确定服务商”的项合并成按请求顺序的结果。
 * 整批规则不变：只要有一项不合格，其余合格的都标 `blocked_by_batch` 并指名是谁拦的。
 */
async function toPreflight(
  ctx: ServerContext,
  resolved: Resolved[],
  admission: BatchAdmission | undefined,
): Promise<PreflightResult> {
  const coreResults = [...(admission?.results ?? [])]
  const results: Verdict[] = resolved.map((r) => {
    if (r.problem) {
      return {
        targetId: r.id,
        status: 'blocked' as const,
        reasons: [r.problem],
        warnings: [],
        unverified: [],
      }
    }
    return toVerdict(coreResults.shift()!)
  })
  const blockers = results
    .filter((v) => v.status === 'blocked' || v.status === 'needs_confirmation')
    .map((v) => v.targetId)
  if (blockers.length > 0) {
    for (const v of results) {
      if (v.status === 'accepted' || v.status === 'blocked_by_batch') {
        v.status = 'blocked_by_batch'
        v.blockedBy = blockers
        v.reasons = [
          { code: 'BLOCKED_BY_BATCH', message: `被整批拦下：${blockers.join('、')} 不合格` },
        ]
      }
    }
  }
  const settings = await ctx.settings.get()
  const estimates = results.flatMap((v) => (v.estimate ? [v.estimate] : []))
  return {
    ok: blockers.length === 0,
    results,
    totals: summarizeCosts(estimates, settings.cost),
  }
}

export function registerGenerateRoutes(r: RouteRegistry, ctx: ServerContext): void {
  /** 只读预检：和提交用同一份准入计算，不创建任务、不写任何东西。 */
  r.handle('generate.preflight', async ({ params, body }) => {
    await requireProject(ctx, params.projectId)
    const resolved = await resolveItems(ctx, body.items)
    const ok = resolved.filter((x) => !x.problem)
    const admission = ok.length
      ? await preflightTargets(ctx.deps, params.projectId, ok.map(admissionItem), {
          confirmUnverified: body.confirmUnverified,
        })
      : undefined
    return toPreflight(ctx, resolved, admission)
  })

  r.handle('generate.submit', async ({ params, body }): Promise<GenerateResult> => {
    await requireProject(ctx, params.projectId)
    const resolved = await resolveItems(ctx, body.items)
    const requested = resolved.map((x) => x.id)
    const unresolved = resolved.some((x) => x.problem)

    if (unresolved) {
      // 有项连服务商都确定不了：整批不入队（和准入一致），逐项说明原因。
      const ok = resolved.filter((x) => !x.problem)
      const admission = ok.length
        ? await preflightTargets(ctx.deps, params.projectId, ok.map(admissionItem), {
            confirmUnverified: body.confirmUnverified,
          })
        : undefined
      const pre = await toPreflight(ctx, resolved, admission)
      return {
        requested,
        succeeded: [],
        failed: [],
        blocked: pre.results
          .filter((v) => v.status !== 'accepted')
          .map((v) => ({
            targetId: v.targetId,
            reasons: v.reasons,
            ...(v.blockedBy ? { blockedBy: v.blockedBy } : {}),
          })),
        admission: pre,
      }
    }

    const res = await requestGeneration(ctx.deps, params.projectId, resolved.map(admissionItem), {
      confirmUnverified: body.confirmUnverified,
    })
    const admission = await toPreflight(ctx, resolved, res.admission)

    // 新入队的镜头任务阶段已被标成 queued：通知前端刷新镜头与项目进度。
    const shotIds = res.succeeded.flatMap((s) => {
      if (s.deduped) return []
      const target = resolved.find((x) => x.id === s.targetId)?.target
      return target && 'shotId' in target ? [target.shotId] : []
    })
    if (shotIds.length > 0) {
      ctx.bus.changed('shot', { projectId: params.projectId, ids: shotIds, op: 'updated' })
    }
    return {
      requested: res.requested,
      succeeded: res.succeeded,
      failed: res.failed,
      blocked: res.blocked.map((b) => ({
        targetId: b.targetId,
        reasons: b.reasons,
        ...(b.blockedBy ? { blockedBy: b.blockedBy } : {}),
      })),
      admission,
    }
  })
}
