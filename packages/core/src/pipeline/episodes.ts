import { z } from 'zod'
import { allocateNumber, createEpisode } from '../domain/factories.ts'
import type { Episode } from '../domain/project.ts'
import type { Chapter, Material } from '../domain/material.ts'
import { chaptersOrSections, windowChapters } from '../parsers/chapters.ts'
import type { PipelineDeps } from './deps.ts'
import { llmJson } from './deps.ts'
import { notFoundError } from '../errors.ts'

/**
 * 步骤 1：原文 → 分集规划。
 *
 * - 原文不截断：先按章节（没有标题就按段落合成“节”）建目录，再按字数预算分批喂给 LLM。
 * - LLM 只做“怎么分”：每集一段连续章节；批次末尾凑不成一集的章节顺延到下一批。
 * - LLM 给不出可用结果时，用确定性的按字数分组兜底，保证流水线不会卡住。
 * - 集的播出顺序记在项目的 `episodeOrder`（分集账本）里；Episode 自己只有标题和原文范围。
 */

export interface PlanEpisodesOptions {
  /** 每集原文的目标体量（字），默认 2500。 */
  targetChars?: number
  /** 一批目录最多带多少字的章节，默认 20000。 */
  maxCharsPerBatch?: number
  /** 一批目录最多带多少章，默认 60。 */
  maxChaptersPerBatch?: number
  /** 创作者对这一次分集规划的要求（如“每集结尾留悬念”）；只对这一次有效。 */
  instructions?: string
  signal?: AbortSignal
}

export interface PlanEpisodesResult {
  episodes: Episode[]
  /** 用了确定性兜底的批次数（LLM 没给出可用结果）。 */
  fallbackBatches: number
  /** 一共调用了几次 LLM。 */
  llmCalls: number
}

interface Unit {
  /** 全局序号（跨素材连续）。 */
  global: number
  charCount: number
  material: Material
  chapter: Chapter
}

const planSchema = z.object({
  episodes: z
    .array(
      z.object({
        title: z.string().min(1),
        summary: z.string().optional().default(''),
        fromChapter: z.coerce.number().int(),
        toChapter: z.coerce.number().int(),
      }),
    )
    .default([]),
  nextChapter: z.coerce.number().int().optional(),
})

export async function planEpisodes(
  deps: PipelineDeps,
  projectId: string,
  options: PlanEpisodesOptions = {},
): Promise<PlanEpisodesResult> {
  const project = await deps.store.projects.get(projectId)
  if (!project) throw notFoundError('project', projectId)
  const targetChars = options.targetChars ?? 2500
  const materials = (await deps.store.materials.listByProject(projectId)).filter(
    (m) => m.kind !== 'image' && m.text.trim().length > 0,
  )
  const existing = await deps.store.episodes.listByProject(projectId)

  // 已经被规划过的章节不再规划：续写连载时只处理新增的部分。
  const covered = (m: Material, c: Chapter) =>
    existing.some(
      (e) =>
        e.sourceRange?.materialId === m.id &&
        e.sourceRange.startLine !== undefined &&
        e.sourceRange.endLine !== undefined &&
        e.sourceRange.startLine <= c.startLine &&
        c.endLine <= e.sourceRange.endLine,
    )

  const planned: Array<{
    title: string
    summary: string
    material: Material
    first: Chapter
    last: Chapter
  }> = []
  let fallbackBatches = 0
  let llmCalls = 0
  let global = 0
  const recent = existing
    .slice()
    .sort((a, b) => a.number - b.number)
    .slice(-3)
    .map((e) => `《${e.title}》${e.summary ? `：${e.summary}` : ''}`)

  for (const material of materials) {
    const chapters = chaptersOrSections(material.text, Math.max(1500, targetChars))
    const units: Unit[] = chapters.map((chapter) => ({
      global: global++,
      charCount: chapter.charCount,
      material,
      chapter,
    }))
    let todo = units.filter((u) => !covered(u.material, u.chapter))
    while (todo.length > 0) {
      options.signal?.throwIfAborted()
      const window = windowChapters(todo, {
        maxChars: options.maxCharsPerBatch ?? 20000,
        maxItems: options.maxChaptersPerBatch ?? 60,
      })[0]
      const hasMore = window.length < todo.length
      const previous = [
        ...recent,
        ...planned.slice(-3).map((p) => `《${p.title}》${p.summary ? `：${p.summary}` : ''}`),
      ].slice(-3)
      llmCalls++
      let result: z.output<typeof planSchema> | undefined
      try {
        result = await llmJson(deps, {
          task: 'episodes.plan',
          schema: planSchema,
          signal: options.signal,
          messages: [
            {
              role: 'system',
              content: deps.catalog.prompts.render('episodes.plan.system', {
                targetChars: String(targetChars),
              }),
            },
            {
              role: 'user',
              content: deps.catalog.prompts.render('episodes.plan.user', {
                projectName: project.name,
                firstChapter: String(window[0].global),
                lastChapter: String(window[window.length - 1].global),
                hasMore: hasMore ? '是' : '否',
                previousBlock: previous.join('\n'),
                userInstructions: (options.instructions ?? '').trim(),
                tocBlock: window.map(tocLine).join('\n'),
              }),
            },
          ],
        })
      } catch {
        result = undefined
      }

      const accepted = result ? validateRanges(result.episodes, window) : []
      let consumed = accepted.length > 0 ? accepted[accepted.length - 1].to + 1 : window[0].global
      for (const ep of accepted) {
        const first = window.find((u) => u.global === ep.from)!
        const last = window.find((u) => u.global === ep.to)!
        planned.push({
          title: ep.title,
          summary: ep.summary,
          material,
          first: first.chapter,
          last: last.chapter,
        })
      }
      // 最后一批（或 LLM 没给结果）：没分完的章节用确定性方式分完。
      const lastBatch = !hasMore
      if (accepted.length === 0 || (lastBatch && consumed <= window[window.length - 1].global)) {
        fallbackBatches++
        const rest = window.filter((u) => u.global >= consumed)
        const groups = groupByBudget(rest, targetChars)
        // 非最后一批时，兜底只用掉第一组，保证向前推进又不吃掉太多。
        const use = lastBatch || accepted.length > 0 ? groups : groups.slice(0, 1)
        for (const g of use) {
          planned.push({
            title: `第 ${existing.length + planned.length + 1} 集`,
            summary: '',
            material,
            first: g[0].chapter,
            last: g[g.length - 1].chapter,
          })
          consumed = g[g.length - 1].global + 1
        }
      }
      todo = todo.filter((u) => u.global >= consumed)
    }
  }

  // 一次性写入：账本、计数、集。
  const created = await deps.store.transaction(async (tx) => {
    let p = (await tx.projects.get(projectId))!
    const now = deps.clock.now()
    const out: Episode[] = []
    for (const item of planned) {
      const alloc = allocateNumber(p, 'episode')
      p = alloc.project
      const ep: Episode = {
        ...createEpisode({
          id: deps.ids.next('ep'),
          projectId,
          number: alloc.number,
          title: item.title,
          now,
        }),
        summary: item.summary || undefined,
        sourceRange: {
          materialId: item.material.id,
          startLine: item.first.startLine,
          endLine: item.last.endLine,
        },
      }
      await tx.episodes.put(ep)
      p = { ...p, episodeOrder: [...p.episodeOrder, ep.id] }
      out.push(ep)
    }
    await tx.projects.put({ ...p, updatedAt: now })
    return out
  })
  deps.events?.emit({ type: 'project.changed', projectId })
  return { episodes: created, fallbackBatches, llmCalls }
}

function tocLine(u: Unit): string {
  const text = u.material.text.slice(u.chapter.startOffset, u.chapter.endOffset)
  const body = text.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim()
  const head = (body || text.replace(/\s+/g, ' ')).slice(0, 80)
  return `[${u.global}] 《${u.material.name}》 ${u.chapter.title} · ${u.chapter.charCount}字 · ${head}`
}

/** 校验 LLM 给的范围：必须落在窗口内、从小到大、不重叠；遇到第一个不合格的就截断（之前的保留）。 */
function validateRanges(
  episodes: Array<{ title: string; summary: string; fromChapter: number; toChapter: number }>,
  window: Unit[],
): Array<{ title: string; summary: string; from: number; to: number }> {
  const lo = window[0].global
  const hi = window[window.length - 1].global
  const out: Array<{ title: string; summary: string; from: number; to: number }> = []
  let next = lo
  for (const e of episodes) {
    if (e.fromChapter !== next || e.toChapter < e.fromChapter || e.toChapter > hi) break
    out.push({
      title: e.title.trim().slice(0, 40),
      summary: e.summary.trim(),
      from: e.fromChapter,
      to: e.toChapter,
    })
    next = e.toChapter + 1
  }
  return out
}

function groupByBudget(units: Unit[], target: number): Unit[][] {
  const groups: Unit[][] = []
  let cur: Unit[] = []
  let chars = 0
  for (const u of units) {
    if (cur.length > 0 && chars + u.chapter.charCount > target * 1.4) {
      groups.push(cur)
      cur = []
      chars = 0
    }
    cur.push(u)
    chars += u.chapter.charCount
  }
  if (cur.length > 0) groups.push(cur)
  return groups
}

/** 取一集对应的原文（按行号范围）。 */
export async function episodeSourceText(
  deps: Pick<PipelineDeps, 'store'>,
  episode: Episode,
): Promise<string> {
  const range = episode.sourceRange
  if (!range?.materialId) return ''
  const material = await deps.store.materials.get(range.materialId)
  if (!material) return ''
  const lines = material.text.split('\n')
  return lines.slice((range.startLine ?? 1) - 1, range.endLine ?? lines.length).join('\n')
}
