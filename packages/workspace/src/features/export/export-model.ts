import type { ArtifactReport } from '@dramai/api'

/**
 * 导出页的产物清单：把服务端的产物状态整理成每行要显示的状态。
 * 状态一共四种：最新（current）、已过期（stale，仍可下载）、缺失（missing）、被拦下（blocked，写明原因）。
 */
export type ExportStatus = ArtifactReport['status']

export interface NarrationSummary {
  total: number
  current: number
  stale: number
  missing: number
  status: ExportStatus
}

/** 旁白配音是每个镜头一件：汇总成“n / m 个镜头已有配音”。有缺失就整体算缺失，其次过期。 */
export function summarizeNarration(reports: readonly ArtifactReport[]): NarrationSummary {
  const audio = reports.filter((r) => r.kind === 'shot_audio')
  const count = (s: ExportStatus) => audio.filter((r) => r.status === s).length
  const missing = count('missing') + count('blocked')
  const stale = count('stale')
  return {
    total: audio.length,
    current: count('current'),
    stale,
    missing,
    status: missing > 0 ? 'missing' : stale > 0 ? 'stale' : 'current',
  }
}

/** 成片 / 字幕等单件产物：没有记录就是缺失。 */
export function findReport(
  reports: readonly ArtifactReport[],
  kind: ArtifactReport['kind'],
): ArtifactReport | undefined {
  return reports.find((r) => r.kind === kind)
}

/** 能不能下载：有文件就能（过期的也可以，下载前写明过期）。 */
export const hasFile = (r: ArtifactReport | undefined): boolean =>
  r?.file !== undefined && r.status !== 'missing'

export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: i === 0 ? 0 : n < 10 ? 1 : 0 })
  return `${nf.format(n)} ${units[i]}`
}
