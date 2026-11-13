import type { UsedReferences } from '../domain/media.ts'
import type { ResolvedReference } from './inputs.ts'

/**
 * 视频开启参考图时“实际会带哪些参考图、舍弃了哪些”。**预检（准入）和视频任务用的是这同一个函数**：
 * 预检给界面看的清单，和生成之后版本上的 `usedReferences` 逐项相同（有测试断言）。
 *
 * 顺序就是发出去的顺序，也是提示词里的“图 N”：镜头图降为参考图时它是第 1 项（角色 `start_frame`），资产图从第 2 项起；
 * 首帧和参考图同发的模型里镜头图是真正的首帧，不在参考图清单里（`startFrame.use` 说明它的用法）。
 */
export interface DroppedVideoReference {
  role: ResolvedReference['role']
  assetId?: string
  assetName?: string
  variantName?: string
  /** 为什么没带上：超过这个模型的参考图上限（已按优先级舍弃，说话的人物优先，其次道具、场景…）。 */
  reason: 'over_limit'
}

export interface VideoReferenceUse {
  /** 带上的参考图，按发出的顺序（含 `order`），与版本上的 `usedReferences` 同一份。 */
  used: UsedReferences
  dropped: DroppedVideoReference[]
  /** 镜头图的用法：严格首帧（与参考图同发）或第 1 张参考图。 */
  startFrame: { use: 'first_frame' | 'reference'; versionId?: string; sha256?: string }
}

export function describeVideoReferences(input: {
  frameAsReference: boolean
  startFrame?: ResolvedReference
  references: readonly ResolvedReference[]
  trimmed: readonly ResolvedReference[]
}): VideoReferenceUse {
  const { startFrame } = input
  const frameItems =
    input.frameAsReference && startFrame
      ? [
          {
            role: 'start_frame' as const,
            versionId: startFrame.versionId,
            sha256: startFrame.file.sha256,
          },
        ]
      : []
  const items = [
    ...frameItems,
    ...input.references.map((r) => ({
      role: r.role,
      assetId: r.assetId,
      assetName: r.assetName,
      variantName: r.variantName,
      versionId: r.versionId,
      sha256: r.file.sha256,
    })),
  ].map((item, i) => ({ order: i + 1, ...item }))
  return {
    used: {
      frame: input.frameAsReference ? 'as_reference' : 'with_references',
      references: items,
      trimmed: input.trimmed.length,
    },
    dropped: input.trimmed.map((r) => ({
      role: r.role,
      assetId: r.assetId,
      assetName: r.assetName,
      variantName: r.variantName,
      reason: 'over_limit' as const,
    })),
    startFrame: {
      use: input.frameAsReference ? 'reference' : 'first_frame',
      versionId: startFrame?.versionId,
      sha256: startFrame?.file.sha256,
    },
  }
}
