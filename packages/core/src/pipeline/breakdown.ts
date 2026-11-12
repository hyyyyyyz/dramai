import { z } from 'zod'
import { allocateNumber, createScene, createShot } from '../domain/factories.ts'
import {
  CAMERA_ANGLES,
  CAMERA_MOVEMENTS,
  CAMERA_SHOTS,
  type CameraAngle,
  type CameraMovement,
  type CameraShot,
  type DialogueLine,
  type Scene,
  type Shot,
} from '../domain/shot.ts'
import type { Project } from '../domain/project.ts'
import { hasDialogue, hasNarration } from '../domain/voice.ts'
import { countChars, splitTextByBudget } from '../parsers/chapters.ts'
import type { PipelineDeps } from './deps.ts'
import { llmJson } from './deps.ts'
import { episodeSourceText } from './episodes.ts'
import { DomainError, notFoundError } from '../errors.ts'

/**
 * 步骤 2：一集 → 场 → 分镜段落。
 *
 * - 一集的原文按字数预算切成多段（只在段落 / 句末边界断开），逐段拆分，段与段之间把上一段的结尾交给下一段衔接。
 *   所以长篇不会被截断，镜头数也没有上限（v0.4 是每份素材 4000 字、最多 12 镜）。
 * - 所有段都成功之后才一次性写库（整集重拆是原子的）。
 * - 机械规整：时长夹到 3–15 秒；台词时长不足时先拉长，超过 15 秒的台词拆到下一个镜头；枚举越界回落到默认值。
 */

export const MIN_SHOT_SECONDS = 3
export const MAX_SHOT_SECONDS = 15
/** 台词语速（字/秒）与表演余量（秒），A4 的下限：时长 ≥ 字数 / 4.5 + 2。 */
export const DIALOGUE_CHARS_PER_SEC = 4.5
export const DIALOGUE_PADDING_SEC = 2

export interface BreakdownOptions {
  /** replace：整集重拆（默认）；append：接在已有镜头后面。 */
  mode?: 'replace' | 'append'
  /** 每次 LLM 调用最多带多少字原文，默认 5000。 */
  maxCharsPerCall?: number
  /** 创作者的额外要求；缺省沿用集上记的 `breakdownInstructions`。 */
  instructions?: string
  signal?: AbortSignal
}

export type BreakdownWarningCode =
  | 'VOICE_CONFLICT'
  | 'DURATION_ADJUSTED'
  | 'DIALOGUE_SPLIT'
  | 'ENUM_DEFAULTED'
  | 'NO_SHOTS'

export interface BreakdownWarning {
  code: BreakdownWarningCode
  message: string
  shotId?: string
}

export interface BreakdownResult {
  scenes: Scene[]
  shots: Shot[]
  warnings: BreakdownWarning[]
  llmCalls: number
}

const shotSchema = z.object({
  title: z.string().optional().default(''),
  excerpt: z.string().optional().default(''),
  camera_shot: z.string().optional(),
  angle: z.string().optional(),
  movement: z.string().optional(),
  duration_sec: z.coerce.number().optional(),
  mood_tags: z.array(z.string()).optional().default([]),
  atmosphere: z.string().optional(),
  dialogue: z
    .array(
      z.object({
        speaker: z.string().optional(),
        text: z.string(),
        emotion: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  narration: z.string().optional(),
  action_beats: z.array(z.string()).optional().default([]),
  characters: z.array(z.string()).optional().default([]),
  props: z.array(z.string()).optional().default([]),
  costumes: z.array(z.string()).optional().default([]),
})

const breakdownSchema = z.object({
  scenes: z
    .array(
      z.object({
        title: z.string().optional().default(''),
        location: z.string().optional(),
        time_of_day: z.string().optional(),
        blocking: z.string().optional(),
        continues_previous_scene: z.boolean().optional().default(false),
        shots: z.array(shotSchema).default([]),
      }),
    )
    .default([]),
})

type RawShot = z.output<typeof shotSchema>

const ASPECT_HINT = {
  '9:16': '竖屏，主体居中偏上，上下方向留有空间',
  '16:9': '横屏，可用左右纵深和宽幅构图',
  '1:1': '方形，主体居中，构图紧凑',
} as const

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): { value: T; defaulted: boolean } {
  const hit = allowed.find((a) => a.toLowerCase() === value?.trim().toLowerCase())
  return hit
    ? { value: hit, defaulted: false }
    : { value: fallback, defaulted: value !== undefined && value !== '' }
}

/** 台词所需的最短时长（秒，向上取整）。 */
export function dialogueMinSeconds(lines: ReadonlyArray<{ text: string }>): number {
  const chars = lines.reduce((n, l) => n + countChars(l.text), 0)
  return chars === 0 ? 0 : Math.ceil(chars / DIALOGUE_CHARS_PER_SEC + DIALOGUE_PADDING_SEC)
}

export interface NormalizedShot {
  draft: RawShot
  durationSec: number
  /** 台词太长，超出的部分拆出去的后续镜头草稿。 */
  overflow?: RawShot
  adjusted: boolean
}

/**
 * 时长规整：夹到 [3, 15]；台词不足时拉长；拉到 15 仍装不下的台词拆到后续镜头（overflow）。
 */
export function normalizeShotTiming(draft: RawShot): NormalizedShot {
  const requested =
    draft.duration_sec !== undefined && Number.isFinite(draft.duration_sec)
      ? draft.duration_sec
      : 10
  let duration = Math.min(MAX_SHOT_SECONDS, Math.max(MIN_SHOT_SECONDS, Math.round(requested)))
  let adjusted = duration !== requested
  let overflow: RawShot | undefined
  const need = dialogueMinSeconds(draft.dialogue)
  if (need > duration) {
    if (need <= MAX_SHOT_SECONDS) {
      duration = need
      adjusted = true
    } else {
      // 装不下：按行累加，直到再加一行就超过 15 秒。
      const keep: RawShot['dialogue'] = []
      let i = 0
      for (; i < draft.dialogue.length; i++) {
        const next = [...keep, draft.dialogue[i]]
        if (keep.length > 0 && dialogueMinSeconds(next) > MAX_SHOT_SECONDS) break
        keep.push(draft.dialogue[i])
      }
      const rest = draft.dialogue.slice(i)
      if (rest.length > 0) {
        overflow = {
          ...draft,
          title: draft.title ? `${draft.title}（续）` : '',
          dialogue: rest,
          narration: undefined,
          action_beats: [],
        }
        draft = { ...draft, dialogue: keep }
      }
      duration = Math.min(
        MAX_SHOT_SECONDS,
        Math.max(MIN_SHOT_SECONDS, dialogueMinSeconds(draft.dialogue)),
      )
      adjusted = true
    }
  }
  return { draft, durationSec: duration, overflow, adjusted }
}

export async function breakdownEpisode(
  deps: PipelineDeps,
  episodeId: string,
  options: BreakdownOptions = {},
): Promise<BreakdownResult> {
  const episode = await deps.store.episodes.get(episodeId)
  if (!episode) throw notFoundError('episode', episodeId)
  const project = (await deps.store.projects.get(episode.projectId))!
  const source = await episodeSourceText(deps, episode)
  if (!source.trim())
    throw new DomainError(
      'EPISODE_HAS_NO_SOURCE',
      `episode ${episodeId} has no source text to break down`,
    )

  const parts = splitTextByBudget(source, options.maxCharsPerCall ?? 5000)
  const assets = await deps.store.assets.listByProject(project.id)
  const assetsBlock = assets.map((a) => `- ${a.name}（${kindLabel(a.kind)}）`).join('\n')
  const style = project.style
  const userInstructions = (options.instructions ?? episode.breakdownInstructions ?? '').trim()

  type SceneDraft = {
    title: string
    location?: string
    time?: string
    blocking?: string
    shots: RawShot[]
  }
  const sceneDrafts: SceneDraft[] = []
  let llmCalls = 0
  let previousBlock = ''
  for (let i = 0; i < parts.length; i++) {
    options.signal?.throwIfAborted()
    const chars = countChars(parts[i])
    const targetShots = Math.max(1, Math.round(((chars / 500) * 60) / 12))
    llmCalls++
    const out = await llmJson(deps, {
      task: 'shots.breakdown',
      schema: breakdownSchema,
      signal: options.signal,
      messages: [
        {
          role: 'system',
          content: deps.catalog.prompts.render('shots.breakdown.system', {
            targetShotsMin: String(Math.max(1, Math.floor(targetShots * 0.8))),
            targetShotsMax: String(Math.max(1, Math.ceil(targetShots * 1.2))),
            styleLabel: style.source === 'none' ? '未指定' : style.label,
            aspectRatio: project.aspectRatio,
            aspectHint: ASPECT_HINT[project.aspectRatio],
          }),
        },
        {
          role: 'user',
          content: deps.catalog.prompts.render('shots.breakdown.user', {
            projectName: project.name,
            episodeNumber: String(episode.number),
            episodeTitle: episode.title,
            partLabel: `第 ${i + 1} / ${parts.length} 段`,
            assetsBlock,
            previousBlock,
            userInstructions,
            charCount: String(chars),
            sourceText: parts[i],
          }),
        },
      ],
    })
    for (const sc of out.scenes) {
      const draft: SceneDraft = {
        title: sc.title,
        location: sc.location,
        time: sc.time_of_day,
        blocking: sc.blocking,
        shots: sc.shots,
      }
      const prev = sceneDrafts[sceneDrafts.length - 1]
      if (sc.continues_previous_scene && prev) prev.shots.push(...sc.shots)
      else sceneDrafts.push(draft)
    }
    const last = sceneDrafts[sceneDrafts.length - 1]
    const tail = last?.shots.slice(-2) ?? []
    previousBlock = last
      ? `场《${last.title}》（${last.location ?? ''}）最后 ${tail.length} 个镜头：\n${tail.map((s) => `- ${s.title}：${s.excerpt.slice(0, 80)}`).join('\n')}`
      : ''
  }

  const warnings: BreakdownWarning[] = []
  const totalShots = sceneDrafts.reduce((n, s) => n + s.shots.length, 0)
  if (totalShots === 0) {
    warnings.push({ code: 'NO_SHOTS', message: 'LLM 没有产出任何镜头，已保留原有内容' })
    return { scenes: [], shots: [], warnings, llmCalls }
  }

  const result = await deps.store.transaction(async (tx) => {
    const now = deps.clock.now()
    let p: Project = (await tx.projects.get(project.id))!
    const mode = options.mode ?? 'replace'
    const sceneList: Scene[] = []
    const shotList: Shot[] = []

    // 取出这一集已有的场 / 镜头
    let existingSceneIds = episode.sceneOrder
    if (mode === 'replace') {
      for (const sid of existingSceneIds) {
        const sc = await tx.scenes.get(sid)
        for (const shotId of sc?.shotOrder ?? []) {
          await tx.shots.delete(shotId)
          await tx.shotRefs.replaceForShot(shotId, [])
          for (const kind of ['shot_image', 'shot_video', 'shot_audio']) {
            await tx.artifacts.delete(project.id, `${kind}:${shotId}`)
          }
          for (const c of await tx.candidates.listByProject(project.id)) {
            if (c.shotIds.includes(shotId)) {
              const left = c.shotIds.filter((x) => x !== shotId)
              if (left.length === 0 && c.status === 'pending') await tx.candidates.delete(c.id)
              else await tx.candidates.put({ ...c, shotIds: left })
            }
          }
        }
        await tx.scenes.delete(sid)
      }
      existingSceneIds = []
    }

    for (const sd of sceneDrafts) {
      if (sd.shots.length === 0) continue
      const sAlloc = allocateNumber(p, 'scene')
      p = sAlloc.project
      const scene: Scene = {
        ...createScene({
          id: deps.ids.next('scene'),
          projectId: project.id,
          episodeId,
          number: sAlloc.number,
          now,
          title: sd.title || undefined,
        }),
        locationHint: sd.location?.trim() || undefined,
        timeOfDay: sd.time?.trim() || undefined,
        blocking: sd.blocking?.trim() || undefined,
      }
      const queue = [...sd.shots]
      while (queue.length > 0) {
        const raw = queue.shift()!
        const timing = normalizeShotTiming(raw)
        if (timing.overflow) queue.unshift(timing.overflow)
        const d = timing.draft
        const cs = oneOf<CameraShot>(d.camera_shot?.toUpperCase(), CAMERA_SHOTS, 'MS')
        const an = oneOf<CameraAngle>(d.angle, CAMERA_ANGLES, 'eye_level')
        const mv = oneOf<CameraMovement>(d.movement, CAMERA_MOVEMENTS, 'static')
        const shotAlloc = allocateNumber(p, 'shot')
        p = shotAlloc.project
        const dialogue: DialogueLine[] = d.dialogue
          .filter((l) => l.text.trim())
          .map((l) => ({
            speakerName: l.speaker?.trim() || undefined,
            text: l.text.trim(),
            emotion: l.emotion?.trim() || undefined,
          }))
        const shot: Shot = {
          ...createShot({
            id: deps.ids.next('shot'),
            projectId: project.id,
            sceneId: scene.id,
            number: shotAlloc.number,
            now,
            title: d.title.trim(),
            scriptExcerpt: d.excerpt.trim(),
            durationSec: timing.durationSec,
          }),
          cameraShot: cs.value,
          angle: an.value,
          movement: mv.value,
          moodTags: d.mood_tags,
          atmosphere: d.atmosphere?.trim() || undefined,
          dialogue,
          narration: d.narration?.trim() || undefined,
          actionBeats: d.action_beats.map((b) => b.trim()).filter(Boolean),
          entityHints: {
            characters: unique([...d.characters, ...dialogue.map((l) => l.speakerName ?? '')]),
            location: sd.location?.trim() || undefined,
            props: unique(d.props),
            costumes: unique(d.costumes),
          },
        }
        if (cs.defaulted || an.defaulted || mv.defaulted) {
          warnings.push({
            code: 'ENUM_DEFAULTED',
            message: '镜头字段里有取值不在词表内，已回落到默认值',
            shotId: shot.id,
          })
        }
        if (timing.adjusted) {
          warnings.push({
            code: 'DURATION_ADJUSTED',
            message: `镜头时长按台词长度规整为 ${timing.durationSec} 秒`,
            shotId: shot.id,
          })
        }
        if (timing.overflow) {
          warnings.push({
            code: 'DIALOGUE_SPLIT',
            message: '台词太长，超出的部分拆到了后续镜头',
            shotId: shot.id,
          })
        }
        if (hasDialogue(shot) && hasNarration(shot)) {
          warnings.push({
            code: 'VOICE_CONFLICT',
            message: '同一镜头里既有对白又有旁白，请先改成两个镜头再生成',
            shotId: shot.id,
          })
        }
        scene.shotOrder.push(shot.id)
        shotList.push(shot)
        await tx.shots.put(shot)
      }
      await tx.scenes.put(scene)
      sceneList.push(scene)
    }

    const ep = (await tx.episodes.get(episodeId))!
    await tx.episodes.put({
      ...ep,
      sceneOrder: [...existingSceneIds, ...sceneList.map((s) => s.id)],
      status: ep.status === 'planned' ? 'storyboarding' : ep.status,
      updatedAt: now,
    })
    await tx.projects.put({ ...p, updatedAt: now })
    return { scenes: sceneList, shots: shotList }
  })
  deps.events?.emit({ type: 'project.changed', projectId: project.id })
  return { ...result, warnings, llmCalls }
}

function unique(list: string[]): string[] {
  return [...new Set(list.map((x) => x.trim()).filter(Boolean))]
}

function kindLabel(kind: string): string {
  return { character: '角色', location: '地点', prop: '道具', costume: '服装' }[kind] ?? kind
}
