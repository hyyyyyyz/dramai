import type { VideoGenInput, VideoInputMode } from './types.ts'

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
