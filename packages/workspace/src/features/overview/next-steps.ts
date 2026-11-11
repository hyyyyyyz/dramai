import type { EpisodeProgress } from '@dramai/api'

export type StepKey = 'split' | 'candidates' | 'sheets' | 'images' | 'videos' | 'compose'
export type StepState = 'done' | 'now' | 'todo'

export interface Step {
  key: StepKey
  state: StepState
  /** 供文案用的数字。 */
  n: { done: number; total: number; stale: number; pending: number; scenes: number; shots: number }
  /** 这一步“现在能做什么”的变体（候选：还没抽取过，要先抽取）。 */
  variant?: 'notExtracted' | 'pending' | 'empty'
}

/**
 * 概览里“当前集的下一步”清单（DESIGN 4.1）：拆分镜头 → 确认候选 → 资产设定图 → 分镜图 → 视频 → 合成。
 * 第一个没做完的就是“现在”。数字全部来自集的进度汇总（episodes.list 的 progress），不用再取镜头。
 */
export function computeNextSteps(p: EpisodeProgress): Step[] {
  const base = {
    done: 0,
    total: 0,
    stale: 0,
    pending: 0,
    scenes: p.split.scenes,
    shots: p.split.shots,
  }
  const splitDone = p.split.shots > 0
  const candidatesDone = splitDone && p.candidates.total > 0 && p.candidates.pending === 0
  const counted = (c: { total: number; done: number; stale?: number }) =>
    c.total > 0 && c.done >= c.total
  const steps: Step[] = [
    { key: 'split', state: splitDone ? 'done' : 'todo', n: base },
    {
      key: 'candidates',
      state: candidatesDone ? 'done' : 'todo',
      n: {
        ...base,
        pending: p.candidates.pending,
        total: p.candidates.total,
        done: p.candidates.handled,
      },
      variant:
        p.candidates.pending > 0
          ? 'pending'
          : p.candidates.total === 0
            ? splitDone
              ? 'notExtracted'
              : 'empty'
            : undefined,
    },
    {
      key: 'sheets',
      state: counted(p.sheets) ? 'done' : 'todo',
      n: { ...base, done: p.sheets.done, total: p.sheets.total, stale: p.sheets.stale ?? 0 },
    },
    {
      key: 'images',
      state: counted(p.images) ? 'done' : 'todo',
      n: { ...base, done: p.images.done, total: p.images.total, stale: p.images.stale ?? 0 },
    },
    {
      key: 'videos',
      state: counted(p.videos) ? 'done' : 'todo',
      n: { ...base, done: p.videos.done, total: p.videos.total, stale: p.videos.stale ?? 0 },
    },
    {
      key: 'compose',
      state: p.composition.done ? 'done' : 'todo',
      n: { ...base, stale: p.composition.stale ? 1 : 0 },
    },
  ]
  const now = steps.findIndex((s) => s.state !== 'done')
  if (now >= 0) steps[now]!.state = 'now'
  return steps
}

/** 分段进度：每个镜头一段。进度汇总里只有数量，所以按“视频已生成 → 图已生成 → 未开始”排序，只表示走到了哪一步。 */
export function shotSegments(p: EpisodeProgress): ('success' | 'info' | 'none')[] {
  const total = p.split.shots
  const videos = Math.min(p.videos.done, total)
  const images = Math.min(Math.max(p.images.done - videos, 0), total - videos)
  return Array.from({ length: total }, (_, i) =>
    i < videos ? 'success' : i < videos + images ? 'info' : 'none',
  )
}
