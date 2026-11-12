import type { TimelineBgmClip } from '../domain/timeline.ts'
import type { RevisionContent } from './document.ts'

/**
 * 摆放（A8）：**纯函数**。输入时间线修订内容 + 各镜头的素材层事实，输出绝对时间的片段 / 旁白 / 字幕 / 配乐。
 * 成片渲染、字幕导出、素材包导出都用这一份结果，所以彼此不会不一致。
 *
 * 规则：
 * - 片段在主轨上首尾相接；定格延长 = 出点帧静帧接在片段后；截取只对记录时的那个视频版本有效；
 * - 旁白从承载片段的起点开始，**按配音实测时长播放，可以延伸到后续片段上**；
 * - 字幕：镜头有（被承载的）旁白时跟随旁白；否则按对白逐句分布在片段上；
 * - 旁白与字幕如实保留彼此的重叠，只截掉超出时间线末尾的部分；
 * - 配乐按绝对起点摆放，超出末尾的截断，**截断处固定淡出 1 秒**；淡入淡出之和超过时长时按比例缩短；
 * - 转场（2B 只做硬切）：不改变总时长；渲染时忽略，并作为提示报告。
 */

export interface ClipFacts {
  /** 该镜头当前视频版本。没有视频 = 缺素材。 */
  video?: { versionId: string; durationUs: number }
  /** 旁白配音（当前版本）。 */
  narrationAudio?: { versionId: string; durationUs: number }
  /** 旁白文字。 */
  narrationText?: string
  /** 对白台词（用于字幕分布）。 */
  dialogue: ReadonlyArray<{ text: string }>
}

export interface PlacedClip {
  clipId: string
  shotId: string
  startUs: number
  endUs: number
  /** 源视频里实际使用的区间。 */
  srcInUs: number
  srcOutUs: number
  holdUs: number
  sourceVolume: number
  videoVersionId?: string
  /** 截取因为视频版本变了而作废（整段使用）。 */
  trimIgnored: boolean
  /** 因为没有视频，占位长度取 0。 */
  missingVideo: boolean
}

export interface PlacedNarration {
  clipId: string
  shotId: string
  startUs: number
  endUs: number
  /** 配音完整时长（截断前）。 */
  fullDurationUs: number
  truncated: boolean
  versionId: string
}

export interface PlacedSubtitle {
  shotId: string
  startUs: number
  endUs: number
  text: string
  source: 'narration' | 'dialogue' | 'narration_text'
}

export interface PlacedBgm {
  clipId: string
  bgmId: string
  startUs: number
  endUs: number
  inUs: number
  outUs: number
  volume: number
  fadeInUs: number
  fadeOutUs: number
  truncated: boolean
}

export interface Placement {
  totalUs: number
  clips: PlacedClip[]
  narrations: PlacedNarration[]
  subtitles: PlacedSubtitle[]
  bgm: PlacedBgm[]
  /** 配置了转场但本版只做硬切的片段。 */
  ignoredTransitions: string[]
}

export function placeTimeline(
  content: RevisionContent,
  facts: ReadonlyMap<string, ClipFacts>,
): Placement {
  const clips: PlacedClip[] = []
  const ignoredTransitions: string[] = []
  let cursor = 0
  for (const c of content.clips) {
    const f = facts.get(c.shotId)
    const full = f?.video?.durationUs ?? 0
    let inUs = 0
    let outUs = full
    let trimIgnored = false
    if (c.trim) {
      if (f?.video && c.trim.basisVersionId === f.video.versionId) {
        inUs = Math.max(0, Math.min(full, c.trim.inUs))
        outUs = Math.max(inUs, Math.min(full, c.trim.outUs))
      } else {
        trimIgnored = true
      }
    }
    const length = outUs - inUs + (f?.video ? c.holdUs : 0)
    clips.push({
      clipId: c.id,
      shotId: c.shotId,
      startUs: cursor,
      endUs: cursor + length,
      srcInUs: inUs,
      srcOutUs: outUs,
      holdUs: f?.video ? c.holdUs : 0,
      sourceVolume: c.sourceVolume,
      videoVersionId: f?.video?.versionId,
      trimIgnored,
      missingVideo: !f?.video,
    })
    if (c.transitionToNext) ignoredTransitions.push(c.id)
    cursor += length
  }
  const totalUs = cursor

  const narrations: PlacedNarration[] = []
  const subtitles: PlacedSubtitle[] = []
  content.clips.forEach((c, i) => {
    const placed = clips[i]
    const f = facts.get(c.shotId)
    if (!f) return
    const carried = c.carriesNarration && f.narrationAudio
    if (carried) {
      const startUs = placed.startUs
      const fullDurationUs = f.narrationAudio!.durationUs
      const endUs = Math.min(totalUs, startUs + fullDurationUs)
      narrations.push({
        clipId: c.id,
        shotId: c.shotId,
        startUs,
        endUs,
        fullDurationUs,
        truncated: startUs + fullDurationUs > totalUs,
        versionId: f.narrationAudio!.versionId,
      })
      if (f.narrationText?.trim() && endUs > startUs) {
        subtitles.push({
          shotId: c.shotId,
          startUs,
          endUs,
          text: f.narrationText.trim(),
          source: 'narration',
        })
      }
    } else if (
      f.narrationText?.trim() &&
      c.carriesNarration === false &&
      placed.endUs > placed.startUs &&
      f.dialogue.length === 0
    ) {
      // 有旁白文字但没有配音（后期配音项目）：字幕铺满这个片段。
      subtitles.push({
        shotId: c.shotId,
        startUs: placed.startUs,
        endUs: placed.endUs,
        text: f.narrationText.trim(),
        source: 'narration_text',
      })
    }
    const lines = f.dialogue.filter((d) => d.text.trim())
    if (lines.length > 0 && placed.endUs > placed.startUs) {
      const weights = lines.map((l) => Math.max(1, [...l.text.replace(/\s/g, '')].length))
      const sum = weights.reduce((a, b) => a + b, 0)
      let t = placed.startUs
      lines.forEach((l, k) => {
        const len = Math.round(((placed.endUs - placed.startUs) * weights[k]) / sum)
        const end = k === lines.length - 1 ? placed.endUs : Math.min(placed.endUs, t + len)
        subtitles.push({
          shotId: c.shotId,
          startUs: t,
          endUs: end,
          text: l.text.trim(),
          source: 'dialogue',
        })
        t = end
      })
    }
  })
  subtitles.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)

  const bgm = content.bgm.map((b) => placeBgm(b, totalUs))
  return { totalUs, clips, narrations, subtitles, bgm, ignoredTransitions }
}

function placeBgm(b: TimelineBgmClip, totalUs: number): PlacedBgm {
  const natural = Math.max(0, b.outUs - b.inUs)
  const available = Math.max(0, totalUs - b.startUs)
  const truncated = natural > available
  const length = Math.min(natural, available)
  let fadeIn = b.fadeInUs
  let fadeOut = truncated ? Math.max(b.fadeOutUs, 1_000_000) : b.fadeOutUs
  if (fadeIn + fadeOut > length && length > 0) {
    const scale = length / (fadeIn + fadeOut)
    fadeIn = Math.floor(fadeIn * scale)
    fadeOut = Math.floor(fadeOut * scale)
  }
  return {
    clipId: b.id,
    bgmId: b.bgmId,
    startUs: b.startUs,
    endUs: b.startUs + length,
    inUs: b.inUs,
    outUs: b.inUs + length,
    volume: b.volume,
    fadeInUs: fadeIn,
    fadeOutUs: fadeOut,
    truncated,
  }
}
