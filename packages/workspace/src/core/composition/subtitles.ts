import type { Storyboard } from '@/types/domain'

/**
 * 把分镜列表的 narration（旁白）+ durationSec 转成 SRT / VTT。
 * 时间轴按顺序拼出，没有 narration 的分镜会被跳过编号。
 */
export function buildSrt(shots: Storyboard[]): string {
  let cursor = 0
  let index = 1
  const lines: string[] = []
  for (const s of shots) {
    const dur = s.durationSec && s.durationSec > 0 ? s.durationSec : 5
    if (s.narration && s.narration.trim()) {
      const start = cursor
      const end = cursor + dur
      lines.push(String(index))
      lines.push(`${secondsToSrtTime(start)} --> ${secondsToSrtTime(end)}`)
      lines.push(s.narration.trim())
      lines.push('')
      index++
    }
    cursor += dur
  }
  return lines.join('\n')
}

export function buildVtt(shots: Storyboard[]): string {
  let cursor = 0
  const lines: string[] = ['WEBVTT', '']
  for (const s of shots) {
    const dur = s.durationSec && s.durationSec > 0 ? s.durationSec : 5
    if (s.narration && s.narration.trim()) {
      lines.push(`${secondsToVttTime(cursor)} --> ${secondsToVttTime(cursor + dur)}`)
      lines.push(s.narration.trim())
      lines.push('')
    }
    cursor += dur
  }
  return lines.join('\n')
}

function secondsToSrtTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)},${pad3(ms)}`
}

function secondsToVttTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}.${pad3(ms)}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function pad3(n: number): string {
  return String(n).padStart(3, '0')
}
