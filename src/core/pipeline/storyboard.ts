import { streamChat, LLMRequestError } from '@/core/llm/client'
import { buildStoryboardMessages, type StoryboardDraft } from '@/core/prompts/storyboard'
import { db } from '@/core/storage/db'
import { appendStoryboardFromDraft, clearProjectStoryboards } from '@/core/storage/storyboards'
import { updateProject } from '@/core/storage/projects'
import type { Character, Material, Project, Provider } from '@/types/domain'

export type StoryboardEvent =
  | { phase: 'starting' }
  | { phase: 'streaming'; accumulated: string }
  | { phase: 'parsing'; accumulated: string }
  | { phase: 'persisting'; shotCount: number }
  | { phase: 'done'; shotCount: number }
  | { phase: 'error'; message: string; raw?: string }

interface RunInput {
  provider: Provider
  project: Project
  materials: Material[]
  characters: Character[]
  userPrompt: string
  /** 默认 6，最大 12，最小 3。 */
  targetShotCount?: number
  signal?: AbortSignal
}

/**
 * 文本/素材 → LLM 流式输出 → 解析 shots[] → 落库。
 *
 * 流式 JSON 增量渲染留给 v0.2；当前实现先把整个 JSON 收齐再 parse。
 * 用户能看到的是字符级流式累积（用于 UI 进度感）+ 落库后的真实 storyboard 列表。
 */
export async function* generateStoryboards(
  input: RunInput,
): AsyncGenerator<StoryboardEvent, void, void> {
  yield { phase: 'starting' }

  const messages = buildStoryboardMessages({
    project: input.project,
    materials: input.materials,
    characters: input.characters,
    userPrompt: input.userPrompt,
    targetShotCount: input.targetShotCount,
  })

  let accumulated = ''
  try {
    await updateProject(input.project.id, { status: 'storyboarding' })

    for await (const chunk of streamChat(input.provider, {
      model: input.provider.model,
      messages,
      jsonMode: true,
      temperature: 0.7,
      signal: input.signal,
    })) {
      accumulated = chunk.accumulated
      yield { phase: 'streaming', accumulated }
    }

    yield { phase: 'parsing', accumulated }

    const shots = parseShots(accumulated)
    if (shots.length === 0) {
      yield {
        phase: 'error',
        message: 'LLM 没有产出可用的分镜（解析后为空）',
        raw: accumulated,
      }
      await updateProject(input.project.id, { status: 'draft' })
      return
    }

    yield { phase: 'persisting', shotCount: shots.length }

    // 重新生成时清空旧分镜（含 image/video assets 级联删除）
    await clearProjectStoryboards(input.project.id)
    for (const draft of shots) {
      await appendStoryboardFromDraft(input.project.id, draft, input.characters)
    }

    await updateProject(input.project.id, { status: 'storyboarding' })
    yield { phase: 'done', shotCount: shots.length }
  } catch (err) {
    const msg =
      err instanceof LLMRequestError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err)
    await updateProject(input.project.id, { status: 'draft' })
    yield { phase: 'error', message: msg, raw: accumulated || undefined }
  }
}

/** 把 LLM 文本输出尝试解析成 StoryboardDraft 数组。容忍代码围栏与多余文本。 */
export function parseShots(raw: string): StoryboardDraft[] {
  const candidate = stripCodeFence(raw).trim()
  if (!candidate) return []

  // 直接 try parse 整段
  const direct = tryParseShots(candidate)
  if (direct) return direct

  // fallback: 抽取首个 `{ ... }` 大对象
  const objMatch = matchOutermostBraces(candidate)
  if (objMatch) {
    const parsed = tryParseShots(objMatch)
    if (parsed) return parsed
  }

  return []
}

function tryParseShots(text: string): StoryboardDraft[] | null {
  try {
    const json = JSON.parse(text) as unknown
    if (!json || typeof json !== 'object') return null
    const shots = (json as { shots?: unknown }).shots
    if (!Array.isArray(shots)) return null
    return shots
      .map((entry, idx) => normalizeShot(entry, idx))
      .filter((s): s is StoryboardDraft => s !== null)
  } catch {
    return null
  }
}

function normalizeShot(entry: unknown, idx: number): StoryboardDraft | null {
  if (!entry || typeof entry !== 'object') return null
  const obj = entry as Record<string, unknown>
  const sceneText =
    typeof obj.scene_text === 'string'
      ? obj.scene_text
      : typeof obj.sceneText === 'string'
        ? (obj.sceneText as string)
        : ''
  if (!sceneText.trim()) return null
  return {
    sequence:
      typeof obj.sequence === 'number' && Number.isFinite(obj.sequence)
        ? Math.floor(obj.sequence)
        : idx + 1,
    scene_text: sceneText,
    narration: typeof obj.narration === 'string' ? obj.narration : undefined,
    image_prompt:
      typeof obj.image_prompt === 'string'
        ? obj.image_prompt
        : typeof obj.imagePrompt === 'string'
          ? (obj.imagePrompt as string)
          : undefined,
    character_names: Array.isArray(obj.character_names)
      ? (obj.character_names as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined,
    duration_sec:
      typeof obj.duration_sec === 'number' && Number.isFinite(obj.duration_sec)
        ? obj.duration_sec
        : undefined,
  }
}

function stripCodeFence(text: string): string {
  // 处理 ```json ... ``` 或 ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced ? fenced[1] : text
}

function matchOutermostBraces(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** 给 UI 用 — 取该项目下当前所有分镜的快照。 */
export async function listProjectStoryboards(projectId: string) {
  return db.storyboards.where('projectId').equals(projectId).sortBy('sequence')
}
