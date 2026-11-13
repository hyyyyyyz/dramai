import type { FileRef } from '../domain/common.ts'
import { resolveInputs, targetId } from '../generation/inputs.ts'
import type { Gap, GenerationTarget, ResolvedInputs } from '../generation/inputs.ts'
import type { ProjectProjection } from '../generation/projection.ts'
import type { Job } from '../jobs/types.ts'
import { InFlightConflictError } from '../jobs/queue.ts'
import type { JobQueue, NewJob } from '../jobs/queue.ts'
import {
  checkCapability,
  estimateCost,
  frameWithRefsMode,
  maxRefImagesOf,
  videoRefSlots,
  videoRefsUnsupported,
} from '../providers/catalog.ts'
import type { CostEstimate, ModelRegistry } from '../providers/catalog.ts'
import { deriveVoiceOwner } from '../domain/voice.ts'
import { isDurationAllowed, snapDuration } from '../providers/duration.ts'
import { providerRegionOf } from '../providers/presets.ts'
import type {
  GenerationMode,
  ProviderConfig,
  ProviderKind,
  Support,
  VideoInputMode,
} from '../providers/types.ts'
import { digestOf } from '../util/canonical.ts'

/**
 * 生成入口准入（A2）：花钱前的闸。
 *
 * 能力的三态（支持 / 不支持 / 未验证）这样处理：
 * - **不支持** → 阻断，带原因码。不会换模型，不会降级成别的做法。
 * - **未验证** → 不阻断也不放行，而是 `needs_confirmation`：本次需要用户明确确认
 *   （`confirmUnverified`），或该服务商配置已记下“这一项我接受未验证”（`acceptedUnverified`）。
 *   确认后照常生成，结果里保留 `CAPABILITY_UNVERIFIED` 警告。
 *   理由：未验证 ≠ 不能用。Nano Banana 的多参考图就是“官方说行、我们没验过”，一刀切阻断会让默认链路瘫痪；
 *   但静默放行会让用户为“参考图被忽略、角色对不上”的结果付费。要花钱的入口必须让人知道自己在赌什么。
 *   只检查这一次生成**实际需要**的能力项（没有参考图就不管参考图是否验证过）。
 * - 只读预检（`preflight`）同样返回 `needs_confirmation`，但绝不创建任务、绝不写入任何东西。
 *
 * 规则：
 * 1. 只有**花钱入口**（单条生成、批量生成）做强校验；编辑和保存不拦。
 * 2. 引用了未登记的资产 → 阻断。
 * 3. 角色/场景/道具没有资产图 → 阻断；用户原图不能顶替资产图。
 * 4. 作者声明的输入读不到 → 拒绝；系统推导的可选输入读不到 → 略去。
 * 5. 批量准入是整批的：任一目标不合格则整批零任务。
 * 6. 结果逐目标返回，带原因码；被整批拦下的目标指名拦它的是谁。
 * 7. 同一镜头同一时刻只能有一个在途视频任务；上次失败且带上游任务号时必须先“恢复原任务”。
 *
 * 输入统一来自 `resolveInputs`——和执行器、提示词预览、时效判定是同一份计算。
 */

export type ReasonCode =
  | Gap['code']
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_KIND_MISMATCH'
  | 'MODE_UNSUPPORTED'
  | 'REFERENCE_NOT_SUPPORTED'
  | 'ASPECT_UNSUPPORTED'
  | 'RESOLUTION_UNSUPPORTED'
  | 'LAST_FRAME_UNSUPPORTED'
  | 'FRAME_WITH_REFS_UNSUPPORTED'
  | 'FIRST_FRAME_REPLACED_BY_REFERENCE'
  | 'VIDEO_REFS_EMPTY'
  | 'AUDIO_NOT_DISABLEABLE'
  | 'FIRST_FRAME_UNSUPPORTED'
  | 'DURATION_UNSUPPORTED'
  | 'DURATION_SNAPPED'
  | 'CAPABILITY_UNVERIFIED'
  | 'VOICE_CONFLICT'
  | 'NARRATION_NOT_TTS'
  | 'DIALOGUE_NOT_VOICED'
  | 'NARRATION_VOICE_DEFAULTED'
  | 'UNVERIFIED_NEEDS_CONFIRMATION'
  | 'IN_FLIGHT_CONFLICT'
  | 'RECOVER_ORIGINAL_FIRST'
  | 'DUPLICATE_TARGET'
  | 'BLOCKED_BY_BATCH'
  | 'ENQUEUE_FAILED'
  | 'ENQUEUE_ABORTED'

export interface Reason {
  code: ReasonCode
  message: string
  assetId?: string
}

export interface AdmissionTarget {
  target: GenerationTarget
  provider: ProviderConfig
  /** 请求的分辨率档位（如 "720P"）。 */
  resolution?: string
  /** 用户确认过“可能再次计费”，允许绕过 RECOVER_ORIGINAL_FIRST。 */
  confirmResubmit?: boolean
  /** 用户本次确认“能力未验证也照常生成”。 */
  confirmUnverified?: boolean
  /**
   * 视频：开启参考图（把镜头的角色 / 场景 / 道具设定图作为参考素材一起发出）。缺省 false。
   * 开启后的效果因模型而异，见 `TargetVerdict.video`。
   */
  videoRefs?: boolean
  /** 角色设定图的版式（见 `chooseSheetLayout`）；逐角度版式要出 3 张图，预估费用按 3 张算。 */
  sheetLayout?: 'multi_view' | 'per_angle' | 'single'
}

export interface AdmissionContext {
  projection: ProjectProjection
  models: ModelRegistry
  /** 项目内全部任务（至少包含在途和最近失败的）。 */
  jobs: readonly Job[]
  /** 文件是否可读。 */
  fileExists: (projectId: string, path: string) => Promise<boolean>
}

export type VerdictStatus = 'accepted' | 'blocked' | 'needs_confirmation' | 'blocked_by_batch'

/**
 * 视频目标的"参考图计划"，给界面说明取舍用（只有 `shot_video` 有）。
 *
 * - `frame`：这次实际怎么处理镜头图——`strict_first_frame` 严格首帧（没开参考图）；
 *   `as_reference` 镜头图降为第 1 张参考图、**放弃严格首帧**；`with_references` 首帧和参考图同发；
 * - `ifRefsOn`：**没开**参考图时也给出"如果开启会怎样"，界面据此在开关旁边说明：
 *   `frame_as_reference`（会放弃严格首帧）/ `frame_with_references`（首帧保留）/ `not_available`（这个模型不接参考图）；
 * - `firstFrameWithRefs` / `refImages`：画像里这两项的三态（supported / unsupported / unverified）。
 */
export interface VideoPlan {
  mode: VideoInputMode
  refsRequested: boolean
  frame: 'strict_first_frame' | 'as_reference' | 'with_references'
  ifRefsOn: 'frame_as_reference' | 'frame_with_references' | 'not_available'
  /** 实际发出的参考图张数（含被降级为参考图的镜头图）。 */
  referenceCount: number
  /** 因超出模型上限被舍弃的参考图张数。 */
  droppedReferences: number
  firstFrameWithRefs: Support
  refImages: Support
}

export interface TargetVerdict {
  targetId: string
  status: VerdictStatus
  reasons: Reason[]
  warnings: Reason[]
  /** 这次生成需要、但没验证过的能力项（无论是否已确认）。 */
  unverified: Array<{ key: string; code: string; message: string; confirmed: boolean }>
  /** 被整批拦下时，是谁拦的（目标 id）。 */
  blockedBy?: string[]
  inputs?: ResolvedInputs
  estimate?: CostEstimate
  video?: VideoPlan
}

const KIND_FOR_TARGET: Record<GenerationTarget['kind'], ProviderKind> = {
  asset_sheet: 'image',
  shot_image: 'image',
  shot_video: 'video',
  shot_audio: 'tts',
}

function modeFor(target: GenerationTarget, inputs: ResolvedInputs): GenerationMode {
  switch (target.kind) {
    case 'asset_sheet':
    case 'shot_image':
      return inputs.references.length > 0 ? 'i2i' : 't2i'
    case 'shot_video':
      return inputs.references.length > 0 ? 'omni_ref' : 'i2v'
    case 'shot_audio':
      return 'tts'
  }
}

/** 评估单个目标（不考虑批次）。 */
export async function evaluateTarget(
  ctx: AdmissionContext,
  item: AdmissionTarget,
): Promise<TargetVerdict> {
  const id = targetId(item.target)
  const reasons: Reason[] = []
  const warnings: Reason[] = []
  const { provider } = item

  if (!provider.enabled) {
    reasons.push({ code: 'PROVIDER_DISABLED', message: `服务商 ${provider.label} 已停用` })
  }
  if (provider.kind !== KIND_FOR_TARGET[item.target.kind]) {
    reasons.push({
      code: 'PROVIDER_KIND_MISMATCH',
      message: `${provider.label} 是 ${provider.kind} 服务商，不能用于 ${item.target.kind}`,
    })
  }

  const lookup = ctx.models.lookup(provider)
  // 视频开启参考图：参考素材一起解析。官方把首帧与参考图定为互斥的模型，镜头图要占一个参考图名额。
  const cap = lookup.capability
  const wantVideoRefs = item.target.kind === 'shot_video' && item.videoRefs === true
  // 用户明确开了参考图而这个服务商根本不可能（协议只吃首帧 / 画像里不支持）：不管镜头有没有设定图，一律阻断。
  // 和视频任务入口是同一个判据（videoRefsUnsupported），所以不会出现"准入放行、任务必然失败"。
  const refsImpossible = wantVideoRefs && videoRefsUnsupported(provider.protocol, cap)
  if (refsImpossible) {
    reasons.push({
      code: 'REFERENCE_NOT_SUPPORTED',
      message: `${provider.model} 不接参考图，不能开启参考图生成；关闭参考图改用首帧，或换一个支持参考图的视频模型`,
    })
  }
  const frameMode = frameWithRefsMode(cap)
  const refLimit = maxRefImagesOf(cap)
  const inputs = resolveInputs(
    ctx.projection,
    item.target,
    wantVideoRefs && !refsImpossible
      ? { withReferences: true, maxRefImages: videoRefSlots(cap) }
      : { maxRefImages: refLimit || undefined },
  )
  const usesVideoRefs = wantVideoRefs && !refsImpossible && inputs.references.length > 0

  for (const gap of inputs.gaps) {
    if (gap.severity === 'block') {
      reasons.push({ code: gap.code, message: gap.message, assetId: gap.assetId })
    } else if (gap.severity === 'warn') {
      warnings.push({ code: gap.code, message: gap.message, assetId: gap.assetId })
    }
  }

  // 声明过的输入读不到 → 拒绝（原图声明了但读不到、资产图文件丢了、起始帧丢了）。
  const files: Array<{ file: FileRef; what: string; assetId?: string }> = []
  for (const r of inputs.references) {
    files.push({
      file: r.file,
      what: r.assetName
        ? `“${r.assetName}${r.variantName ? `/${r.variantName}` : ''}”的参考图`
        : '风格参考图',
      assetId: r.assetId,
    })
  }
  if (inputs.startFrame) files.push({ file: inputs.startFrame.file, what: '起始帧' })
  for (const f of files) {
    if (!(await ctx.fileExists(ctx.projection.project.id, f.file.path))) {
      reasons.push({
        code: 'FILE_UNREADABLE',
        message: `${f.what}的文件读不到：${f.file.path}`,
        assetId: f.assetId,
      })
    }
  }

  // 能力检查：缺失 = 带原因的失败，不静默回退成别的做法。
  const needsRefs = inputs.references.filter((r) => r.role !== 'style').length
  const capIssues = checkCapability(lookup, provider.model, {
    mode: modeFor(item.target, inputs),
    referenceImages:
      item.target.kind === 'shot_video'
        ? usesVideoRefs
          ? inputs.references.length + (frameMode === 'as_reference' ? 1 : 0)
          : 0
        : needsRefs,
    // 镜头图降为参考图时不再是"首帧"，也就不需要首帧能力
    firstFrame:
      item.target.kind === 'shot_video' && !(usesVideoRefs && frameMode === 'as_reference'),
    frameWithRefs:
      item.target.kind === 'shot_video' && usesVideoRefs && frameMode === 'with_references',
    aspectRatio: item.target.kind === 'shot_audio' ? undefined : inputs.aspectRatio,
    resolution: item.resolution,
    durationSec: item.target.kind === 'shot_video' ? inputs.durationSec : undefined,
  })
  const unverified: TargetVerdict['unverified'] = []
  for (const issue of capIssues) {
    if (issue.level === 'unsupported') {
      reasons.push({ code: issue.code, message: issue.message })
      continue
    }
    const confirmed =
      Boolean(item.confirmUnverified) || (provider.acceptedUnverified ?? []).includes(issue.key)
    unverified.push({ key: issue.key, code: issue.code, message: issue.message, confirmed })
    if (confirmed) warnings.push({ code: 'CAPABILITY_UNVERIFIED', message: issue.message })
  }

  // 视频时长：不在档位上不是错，会被归一到最近的档位，但要告知。
  if (item.target.kind === 'shot_video' && inputs.durationSec !== undefined) {
    const claimed = lookup.capability.durations
    const rule = claimed.support === 'unsupported' ? undefined : claimed.value
    if (rule && !isDurationAllowed(inputs.durationSec, rule)) {
      const snapped = snapDuration(inputs.durationSec, rule)
      warnings.push({
        code: 'DURATION_SNAPPED',
        message: `镜头时长 ${inputs.durationSec}s 不在 ${provider.model} 支持的档位上，将按 ${snapped}s 生成`,
      })
    }
  }

  // 发声归属（A9）：对白 + 旁白混在同一镜头会出现两层人声，规划阶段拦截；旁白只在项目选择 TTS 时才生成配音。
  if (item.target.kind === 'shot_video' || item.target.kind === 'shot_audio') {
    const shot = ctx.projection.shots.get(item.target.shotId)
    if (shot) {
      const project = ctx.projection.project
      const owner = deriveVoiceOwner(shot, project.narrationDelivery)
      if (owner === 'conflict') {
        reasons.push({
          code: 'VOICE_CONFLICT',
          message:
            '这个镜头同时有对白和旁白，会出现两层人声：请先拆成两个镜头（编辑不受限，生成才拦）',
        })
      } else if (item.target.kind === 'shot_audio' && owner !== 'tts') {
        reasons.push({
          code: 'NARRATION_NOT_TTS',
          message:
            owner === 'native'
              ? '这个镜头的声音由视频模型的原生人声承载（有对白），不需要旁白配音'
              : `旁白的交付方式是“${project.narrationDelivery}”，不生成 TTS 配音`,
        })
      } else if (
        item.target.kind === 'shot_video' &&
        owner === 'native' &&
        lookup.capability.nativeAudio === 'unsupported'
      ) {
        warnings.push({
          code: 'DIALOGUE_NOT_VOICED',
          message: `${provider.model} 不自带人声，这个镜头的对白在视频里不会有声音`,
        })
      } else if (item.target.kind === 'shot_audio' && !project.narrationVoice) {
        warnings.push({
          code: 'NARRATION_VOICE_DEFAULTED',
          message: '项目还没有设置旁白音色，将使用服务商默认音色',
        })
      }
      // 这个镜头不用视频模型的原生人声，但模型没办法关掉它（如可灵 4.0）：视频里会带一条原声，
      // 加入时间线时这段原声的默认音量是 0（用户可以在时间线上调高）。
      if (
        item.target.kind === 'shot_video' &&
        owner !== 'native' &&
        owner !== 'conflict' &&
        lookup.capability.audioToggle === 'unsupported'
      ) {
        warnings.push({
          code: 'AUDIO_NOT_DISABLEABLE',
          message: `${provider.model} 无法关闭自带的原生音频，生成的视频里会带一条原声；这个镜头不用它，加入时间线时默认静音，可以在时间线上调整`,
        })
      }
    }
  }

  // 同一镜头同一时刻只能有一个在途视频任务；失败且带上游任务号的要先“恢复原任务”。
  if (item.target.kind === 'shot_video') {
    const shotId = item.target.shotId
    const mine = ctx.jobs.filter((j) => j.shotId === shotId && j.operation === 'shot_video')
    if (mine.some((j) => j.status === 'queued' || j.status === 'running')) {
      reasons.push({ code: 'IN_FLIGHT_CONFLICT', message: '该镜头已有一个在途的视频任务' })
    } else if (!item.confirmResubmit) {
      const last = [...mine].sort((a, b) => b.createdAt - a.createdAt)[0]
      if (
        last &&
        last.status === 'failed' &&
        (last.providerJobId || last.resultUrl) &&
        last.error?.category !== 'generation_failed'
      ) {
        reasons.push({
          code: 'RECOVER_ORIGINAL_FIRST',
          message: '上一次任务已有上游任务号：请先“恢复原任务”；坚持重新生成可能再次计费，需要确认',
        })
      }
    }
  }

  // 视频的"参考图计划"：怎么处理镜头图、开启参考图会怎样——给界面说取舍用。
  let video: VideoPlan | undefined
  if (item.target.kind === 'shot_video') {
    const refsOk = !videoRefsUnsupported(provider.protocol, cap)
    const asReference = frameMode === 'as_reference'
    if (wantVideoRefs && refsOk && !refsImpossible && inputs.references.length === 0) {
      warnings.push({
        code: 'VIDEO_REFS_EMPTY',
        message: '这个镜头没有可用的角色 / 场景 / 道具设定图，参考图没有开启，按首帧生成',
      })
    }
    if (usesVideoRefs && asReference && refsOk) {
      warnings.push({
        code: 'FIRST_FRAME_REPLACED_BY_REFERENCE',
        message: `开启参考图后，${provider.model} 会放弃严格首帧：镜头图只作为第 1 张参考图，开场画面靠提示词描述`,
      })
    }
    video = {
      mode: usesVideoRefs ? 'omni_ref' : 'i2v',
      refsRequested: wantVideoRefs,
      frame: !usesVideoRefs
        ? 'strict_first_frame'
        : asReference
          ? 'as_reference'
          : 'with_references',
      ifRefsOn: !refsOk
        ? 'not_available'
        : asReference
          ? 'frame_as_reference'
          : 'frame_with_references',
      referenceCount: usesVideoRefs ? inputs.references.length + (asReference ? 1 : 0) : 0,
      droppedReferences: usesVideoRefs ? inputs.trimmed.length : 0,
      firstFrameWithRefs: cap.firstFrameWithRefs ?? 'unsupported',
      refImages: cap.refImages.support,
    }
  }

  const resolution = item.resolution
  const sheetCount =
    item.target.kind === 'asset_sheet' &&
    !item.target.variantName &&
    item.sheetLayout === 'per_angle'
      ? 3
      : 1
  const estimate = estimateCost(lookup.profile, {
    region: providerRegionOf(provider),
    count: sheetCount,
    seconds: inputs.durationSec,
    resolution,
    // 配音按字数计价：旁白的字数（不含空白），和文本步骤的估算同一口径。
    chars:
      item.target.kind === 'shot_audio'
        ? [...(inputs.narration ?? '')].filter((c) => !/\s/u.test(c)).length
        : undefined,
  })

  const pending = unverified.filter((u) => !u.confirmed)
  let status: VerdictStatus = 'accepted'
  if (reasons.length > 0) {
    status = 'blocked'
  } else if (pending.length > 0) {
    status = 'needs_confirmation'
    reasons.push({
      code: 'UNVERIFIED_NEEDS_CONFIRMATION',
      message: `这次生成依赖没验证过的能力，需要确认后才会开始：${pending.map((u) => u.message).join('；')}`,
    })
  }
  return {
    targetId: id,
    status,
    reasons,
    warnings,
    unverified,
    inputs,
    estimate,
    ...(video ? { video } : {}),
  }
}

export interface BatchAdmission {
  /** 全部通过才为 true。 */
  ok: boolean
  results: TargetVerdict[]
}

/**
 * 批量准入：先对整个目标集合评估一次，任一目标不合格则整批零任务。
 * 本身没问题但被整批拦住的目标标 `blocked_by_batch`，并指名拦它的是谁。
 */
export async function admitBatch(
  ctx: AdmissionContext,
  items: readonly AdmissionTarget[],
  options: { confirmUnverified?: boolean } = {},
): Promise<BatchAdmission> {
  const seen = new Set<string>()
  const results: TargetVerdict[] = []
  for (const item of items) {
    const id = targetId(item.target)
    if (seen.has(id)) {
      results.push({
        targetId: id,
        status: 'blocked',
        reasons: [{ code: 'DUPLICATE_TARGET', message: '同一批里重复了同一个目标' }],
        warnings: [],
        unverified: [],
      })
      continue
    }
    seen.add(id)
    results.push(
      await evaluateTarget(
        ctx,
        options.confirmUnverified ? { ...item, confirmUnverified: true } : item,
      ),
    )
  }
  const blockers = results
    .filter((r) => r.status === 'blocked' || r.status === 'needs_confirmation')
    .map((r) => r.targetId)
  if (blockers.length > 0) {
    for (const r of results) {
      if (r.status === 'accepted') {
        r.status = 'blocked_by_batch'
        r.blockedBy = blockers
        r.reasons = [
          { code: 'BLOCKED_BY_BATCH', message: `被整批拦下：${blockers.join('、')} 不合格` },
        ]
      }
    }
  }
  return { ok: blockers.length === 0, results }
}

/**
 * 只读预检：对一组目标返回逐项的“能否生成、原因码、预估费用”。
 * **没有任何副作用**——不创建任务、不写存储、不发事件、不改传入的投影；可以随时反复调用
 * （镜头卡显示“不能生成”的原因、批量确认弹窗）。与 `submitBatch` 用的是同一份计算。
 */
export function preflight(
  ctx: AdmissionContext,
  items: readonly AdmissionTarget[],
  options: { confirmUnverified?: boolean } = {},
): Promise<BatchAdmission> {
  return admitBatch(ctx, items, options)
}

// === 入队 ===

export interface BatchSubmitResult {
  /** 请求的目标 id（保序）。 */
  requested: string[]
  succeeded: Array<{ targetId: string; jobId: string; deduped: boolean }>
  failed: Array<{ targetId: string; reason: Reason }>
  blocked: Array<{ targetId: string; reasons: Reason[]; blockedBy?: string[] }>
  admission: BatchAdmission
}

const OPERATION: Record<GenerationTarget['kind'], { operation: string; type: NewJob['type'] }> = {
  asset_sheet: { operation: 'asset_sheet', type: 'image' },
  shot_image: { operation: 'shot_image', type: 'image' },
  shot_video: { operation: 'shot_video', type: 'video' },
  shot_audio: { operation: 'shot_audio', type: 'audio' },
}

export function buildJobForTarget(
  ctx: AdmissionContext,
  item: AdmissionTarget,
  verdict: TargetVerdict,
  batchId?: string,
): NewJob {
  const { target, provider } = item
  const spec = OPERATION[target.kind]
  const inputs = verdict.inputs!
  return {
    type: spec.type,
    operation: spec.operation,
    projectId: ctx.projection.project.id,
    shotId: 'shotId' in target ? target.shotId : undefined,
    assetId: target.kind === 'asset_sheet' ? target.assetId : undefined,
    batchId,
    // 目标 + 输入指纹：同一输入的在途任务去重。
    dedupeKey: `${verdict.targetId}#${digestOf({
      prompt: inputs.prompt,
      refs: inputs.references.map((r) => r.file.sha256),
      start: inputs.startFrame?.file.sha256,
      provider: provider.id,
      model: provider.model,
      resolution: item.resolution,
    }).slice(0, 16)}`,
    // 同一镜头同一时刻只能有一个在途视频任务：在原子入队路径上成立，而不只是靠投影里的检查。
    exclusiveKey:
      target.kind === 'shot_video'
        ? `shot_video:${target.shotId}`
        : // 同一张设定图同一时刻只做一次修改：两次修改都基于同一张当前图，同时跑会互相盖掉。
          target.kind === 'asset_sheet' && target.editInstruction !== undefined
          ? `asset_sheet_edit:${target.assetId}${target.variantName ? `/${target.variantName}` : ''}`
          : undefined,
    providerLabel: provider.label,
    providerSnapshot: {
      providerConfigId: provider.id,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      model: provider.model,
    },
    params: {
      target,
      resolution: item.resolution,
      layout: item.sheetLayout,
      // 只有开启时才写，关闭时任务参数和以前逐字相同
      ...(item.videoRefs && target.kind === 'shot_video' ? { videoRefs: true } : {}),
    },
    paid: true,
  }
}

/**
 * 准入 + 入队。整批通过才创建任务；入队中途失败不回滚已创建的任务（它们已经是完整的单元），
 * 没轮到的目标逐个报 `ENQUEUE_ABORTED`。
 */
export async function submitBatch(
  ctx: AdmissionContext,
  queue: Pick<JobQueue, 'enqueue'>,
  items: readonly AdmissionTarget[],
  options: { batchId?: string; confirmUnverified?: boolean } = {},
): Promise<BatchSubmitResult> {
  const admission = await admitBatch(ctx, items, options)
  const requested = items.map((i) => targetId(i.target))
  const out: BatchSubmitResult = {
    requested,
    succeeded: [],
    failed: [],
    blocked: [],
    admission,
  }
  if (!admission.ok) {
    out.blocked = admission.results
      .filter((r) => r.status !== 'accepted')
      .map((r) => ({ targetId: r.targetId, reasons: r.reasons, blockedBy: r.blockedBy }))
    return out
  }
  let aborted = false
  for (let i = 0; i < items.length; i++) {
    const verdict = admission.results[i]
    if (aborted) {
      out.failed.push({
        targetId: verdict.targetId,
        reason: { code: 'ENQUEUE_ABORTED', message: '前面的目标入队失败，这个目标没有轮到' },
      })
      continue
    }
    try {
      const { job, deduped } = await queue.enqueue(
        buildJobForTarget(ctx, items[i], verdict, options.batchId),
      )
      out.succeeded.push({ targetId: verdict.targetId, jobId: job.id, deduped })
    } catch (err) {
      if (err instanceof InFlightConflictError) {
        // 竞争输了：别的请求刚刚占了这个镜头。这一项落空，其余各项是独立完整的单元，继续。
        out.failed.push({
          targetId: verdict.targetId,
          reason: { code: 'IN_FLIGHT_CONFLICT', message: '该镜头已有一个在途的视频任务' },
        })
        continue
      }
      aborted = true
      out.failed.push({
        targetId: verdict.targetId,
        reason: {
          code: 'ENQUEUE_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      })
    }
  }
  return out
}
