import type { Placement } from './timeline-model'
import { US } from './timeline-model'

/**
 * 浏览器里的“预览”：不经过渲染，按时间线顺序播放各片段的视频，旁白在它的起点响起。
 * 这里是纯的时间换算，播放器（PreviewPlayer）只管把结果交给 <video> 和 <audio>。
 * 预览不含字幕、配乐、定格和转场（后端目前也只做硬切）。
 */
export interface PreviewClip {
  clipId: string
  startUs: number
  endUs: number
  srcInUs: number
  srcOutUs: number
  volume: number
  videoVersionId?: string
  missingVideo: boolean
}

export function previewClips(placement: Placement): PreviewClip[] {
  return placement.clips.map((c) => ({
    clipId: c.clipId,
    startUs: c.startUs,
    endUs: c.endUs,
    srcInUs: c.srcInUs,
    srcOutUs: c.srcOutUs,
    volume: c.sourceVolume,
    videoVersionId: c.videoVersionId,
    missingVideo: c.missingVideo,
  }))
}

/** 时间线上的 tUs 落在哪个片段里，以及对应到源视频的第几微秒。越界落到首 / 尾。 */
export function resolveAt(
  clips: readonly PreviewClip[],
  tUs: number,
): { index: number; sourceUs: number } | undefined {
  if (clips.length === 0) return undefined
  const t = Math.max(0, tUs)
  let index = clips.findIndex((c) => t >= c.startUs && t < c.endUs)
  if (index < 0) index = t < clips[0]!.startUs ? 0 : clips.length - 1
  const c = clips[index]!
  const local = Math.min(Math.max(t - c.startUs, 0), c.srcOutUs - c.srcInUs)
  return { index, sourceUs: c.srcInUs + local }
}

/** 源视频播到 sourceUs 时，对应的时间线位置。 */
export function timelineAt(clip: PreviewClip, sourceUs: number): number {
  return clip.startUs + Math.min(Math.max(sourceUs - clip.srcInUs, 0), clip.srcOutUs - clip.srcInUs)
}

/** 到了源视频的出点就该换下一个片段了。 */
export const clipFinished = (clip: PreviewClip, sourceUs: number): boolean =>
  sourceUs >= clip.srcOutUs - 20_000

/** 从 fromUs（不含）走到 toUs（含）之间，起点落在这段里的旁白——该开始播了。 */
export function narrationsToStart(placement: Placement, fromUs: number, toUs: number) {
  return placement.narrations.filter((n) => n.startUs > fromUs && n.startUs <= toUs)
}

/** 从 tUs 开始、此刻应该已经在响的旁白（拖动进度条后接着播）。 */
export function narrationsPlayingAt(placement: Placement, tUs: number) {
  return placement.narrations.filter((n) => n.startUs <= tUs && tUs < n.endUs)
}

export const previewTotalSec = (placement: Placement) => placement.totalUs / US
