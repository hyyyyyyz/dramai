/**
 * 分镜 JSON 的容错解析。LLM 的输出常带代码围栏、前后多余文字，偶尔被截断。
 * 容忍：围栏 / 前后多余文本 / 顶层直接是数组 / snake_case 与 camelCase / 被截断时抢救已完整的镜头。
 */

export interface StoryboardDraft {
  /** 1 起的序号；LLM 自己安排，缺省按位置补。 */
  sequence: number
  /** 画面文字描述（中文）。 */
  scene_text: string
  narration?: string
  /** 给文生图的 prompt（英文优先）。 */
  image_prompt?: string
  /** 出场角色名（LLM 边界上的名字，入库前要解析成资产 id）。 */
  character_names?: string[]
  duration_sec?: number
}

export function parseShots(raw: string): StoryboardDraft[] {
  const text = stripCodeFence(raw).trim()
  if (!text) return []

  const whole = tryParse(text)
  if (whole !== undefined) {
    const shots = shotsFrom(whole)
    if (shots) return shots
  }

  // 抽取首个平衡的 {...} / [...]（识别字符串内的括号）
  for (const open of ['{', '['] as const) {
    const slice = balancedSlice(text, open)
    if (slice) {
      const parsed = tryParse(slice)
      const shots = parsed === undefined ? null : shotsFrom(parsed)
      if (shots) return shots
    }
  }

  // 被截断：从 "shots": [ 之后逐个抢救已完整的对象
  return salvage(text)
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function shotsFrom(json: unknown): StoryboardDraft[] | null {
  let list: unknown
  if (Array.isArray(json)) list = json
  else if (json && typeof json === 'object') list = (json as { shots?: unknown }).shots
  if (!Array.isArray(list)) return null
  return list.map((e, i) => normalizeShot(e, i)).filter((s): s is StoryboardDraft => s !== null)
}

function normalizeShot(entry: unknown, idx: number): StoryboardDraft | null {
  if (!entry || typeof entry !== 'object') return null
  const o = entry as Record<string, unknown>
  const sceneText = firstString(o.scene_text, o.sceneText)
  if (!sceneText || !sceneText.trim()) return null
  const names = o.character_names ?? o.characterNames
  const duration = o.duration_sec ?? o.durationSec
  const seq = o.sequence
  return {
    sequence: typeof seq === 'number' && Number.isFinite(seq) ? Math.floor(seq) : idx + 1,
    scene_text: sceneText,
    narration: typeof o.narration === 'string' ? o.narration : undefined,
    image_prompt: firstString(o.image_prompt, o.imagePrompt),
    character_names: Array.isArray(names)
      ? names.filter((x): x is string => typeof x === 'string')
      : undefined,
    duration_sec: typeof duration === 'number' && Number.isFinite(duration) ? duration : undefined,
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) if (typeof v === 'string') return v
  return undefined
}

function stripCodeFence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced) return fenced[1]
  // 只有开头围栏（被截断时没有收尾）
  const open = /```(?:json)?\s*([\s\S]*)$/i.exec(text)
  return open ? open[1] : text
}

/** 从第一个 open 字符起，取到与之平衡的结束位置；字符串里的括号不计。 */
function balancedSlice(text: string, open: '{' | '['): string | null {
  const close = open === '{' ? '}' : ']'
  const start = text.indexOf(open)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function salvage(text: string): StoryboardDraft[] {
  const marker = /"shots"\s*:\s*\[/.exec(text)
  let pos = marker ? marker.index + marker[0].length : text.indexOf('[') + 1
  if (pos <= 0) return []
  const out: StoryboardDraft[] = []
  while (pos < text.length) {
    const rest = text.slice(pos)
    const obj = balancedSlice(rest, '{')
    if (!obj) break
    const start = rest.indexOf(obj)
    const parsed = tryParse(obj)
    const shot = parsed === undefined ? null : normalizeShot(parsed, out.length)
    if (shot) out.push(shot)
    pos += start + obj.length
  }
  return out
}
