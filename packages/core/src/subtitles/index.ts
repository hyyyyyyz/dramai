/**
 * 字幕：旁白 + 时长 → SRT / VTT。时间一律用整数毫秒，避免浮点进位出 "00:00:01,1000" 这类非法时间码
 * （v0.4 的实现按小数秒四舍五入，会在 x.9995 秒附近产生）。
 */

export interface Cue {
  startMs: number
  endMs: number
  text: string
}

/** 镜头时长缺省/非法时的兜底，沿用 v0.4 的 5 秒。 */
export const DEFAULT_SHOT_SECONDS = 5

export function effectiveDurationSec(durationSec: number | undefined): number {
  return durationSec !== undefined && Number.isFinite(durationSec) && durationSec > 0
    ? durationSec
    : DEFAULT_SHOT_SECONDS
}

export interface SubtitleShot {
  narration?: string
  durationSec?: number
}

/** 按顺序把镜头的旁白排成字幕；没有旁白的镜头只占时间，不产生字幕。 */
export function cuesFromShots(shots: readonly SubtitleShot[]): Cue[] {
  const cues: Cue[] = []
  let cursor = 0
  for (const shot of shots) {
    const dur = Math.round(effectiveDurationSec(shot.durationSec) * 1000)
    const text = shot.narration?.trim()
    if (text) cues.push({ startMs: cursor, endMs: cursor + dur, text })
    cursor += dur
  }
  return cues
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

function formatTime(totalMs: number, separator: ',' | '.'): string {
  const ms = Math.max(0, Math.round(totalMs))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${separator}${pad(ms % 1000, 3)}`
}

export const formatSrtTime = (ms: number): string => formatTime(ms, ',')
export const formatVttTime = (ms: number): string => formatTime(ms, '.')

export function buildSrt(cues: readonly Cue[]): string {
  return cues
    .map((c, i) =>
      [String(i + 1), `${formatSrtTime(c.startMs)} --> ${formatSrtTime(c.endMs)}`, c.text, ''].join(
        '\n',
      ),
    )
    .join('\n')
}

export function buildVtt(cues: readonly Cue[]): string {
  const body = cues.map(
    (c) => `${formatVttTime(c.startMs)} --> ${formatVttTime(c.endMs)}\n${c.text}\n`,
  )
  return ['WEBVTT', '', ...body].join('\n')
}
