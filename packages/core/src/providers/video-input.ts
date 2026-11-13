import { IMAGE_ONLY_VIDEO_PROTOCOLS } from './catalog.ts'
import type { ProtocolId, VideoGenInput, VideoInputMode } from './types.ts'

/**
 * 视频输入属于哪种任务。管线（选请求形态）、准入（查能力）、协议（选端点 / 内容构造）共用这一个函数：
 * 有参考素材 = `omni_ref`；首帧 + 尾帧 = `first_last`；只有首帧 = `i2v`；什么都没有 = `t2v`。
 */
export function videoModeOf(input: VideoGenInput): VideoInputMode {
  if ((input.references?.length ?? 0) > 0) return 'omni_ref'
  if (input.image && input.lastImage) return 'first_last'
  return input.image ? 'i2v' : 't2v'
}

/** 第 n 个（从 1 起）某一种参考素材在提示词里的编号对应的数组位置。 */
export function referencesOfKind(
  input: VideoGenInput,
  kind: 'image' | 'video' | 'audio',
): NonNullable<VideoGenInput['references']> {
  return (input.references ?? []).filter((r) => r.kind === kind)
}

/**
 * 最后一道兜底：只吃首帧的旧协议（`IMAGE_ONLY_VIDEO_PROTOCOLS`）收到没有首帧的输入时，返回一句说明
 * （稳定的错误码是 `FIRST_FRAME_REQUIRED`），而不是让它在读 `input.image` 时抛 `TypeError`。
 * 正常情况下到不了这里：准入和任务入口都会先按"不接参考图"拦下。
 */
export function frameRequiredProblem(
  protocol: ProtocolId,
  input: VideoGenInput,
): string | undefined {
  if (!IMAGE_ONLY_VIDEO_PROTOCOLS.includes(protocol) || input.image) return undefined
  return `协议 ${protocol} 只接受首帧图片（图生视频），这次的输入没有首帧：不能发出请求`
}
