import {
  charCount,
  clamp,
  clip,
  COSTUME_WORDS,
  findEntities,
  findQuotes,
  splitSentences,
} from './zh.ts'

export interface ChatMessage {
  role: string
  content: string
}

export type LlmTask =
  | 'episodes.plan'
  | 'shots.breakdown'
  | 'entities.extract'
  | 'entities.merge'
  | 'entities.variants'
  | 'shots.frames'

/**
 * 同一个“作品”下各步骤之间要保持一致（分镜里认出的人名，后面抽实体时也要认得）。
 * 真实 LLM 靠语义做到这一点；这里靠一个很小的记忆：按作品名记下分镜阶段认出的名字。
 */
export class LlmMemory {
  private readonly names = new Map<string, Set<string>>()
  remember(project: string, names: Iterable<string>): void {
    const set = this.names.get(project) ?? new Set<string>()
    for (const n of names) set.add(n)
    this.names.set(project, set)
  }
  known(project: string): string[] {
    return [...(this.names.get(project) ?? [])]
  }
}

/**
 * 从系统提示词认出是哪个流水线步骤。靠的是提示词开头那句角色说明——
 * 提示词是数据文件，改了就要同步这里（测试会拿真实提示词逐个核对）。
 */
export function detectTask(messages: ChatMessage[]): LlmTask | undefined {
  const system = messages.find((m) => m.role === 'system')?.content ?? ''
  if (system.includes('连载短剧的编剧统筹')) return 'episodes.plan'
  if (system.includes('短剧分镜师')) return 'shots.breakdown'
  if (system.includes('服装与造型统筹')) return 'entities.variants'
  if (system.includes('提示词设计师')) return 'shots.frames'
  if (system.includes('剧本资料员')) {
    return system.includes('初步分组') ? 'entities.merge' : 'entities.extract'
  }
  return undefined
}

const lastUser = (m: ChatMessage[]): string =>
  String([...m].reverse().find((x) => x.role === 'user')?.content ?? '')
const systemOf = (m: ChatMessage[]): string =>
  String(m.find((x) => x.role === 'system')?.content ?? '')
const projectOf = (user: string): string => /作品：([^\n（\s]+)/.exec(user)?.[1] ?? ''

export function answer(task: LlmTask, messages: ChatMessage[], memory: LlmMemory): unknown {
  switch (task) {
    case 'episodes.plan':
      return planEpisodes(messages)
    case 'shots.breakdown':
      return breakdown(messages, memory)
    case 'entities.extract':
      return extract(messages, memory)
    case 'entities.merge':
      return merge(messages)
    case 'entities.variants':
      return variants(messages)
    case 'shots.frames':
      return frames(messages)
  }
}

// === 分集规划 ===

function planEpisodes(messages: ChatMessage[]) {
  const user = lastUser(messages)
  const target = Number(/大约是\s*(\d+)\s*字/.exec(systemOf(messages))?.[1] ?? 2500)
  const hasMore = /后面还有内容：是/.test(user)
  const chapters = [...user.matchAll(/^\[(\d+)\] 《(.*?)》 (.*?) · (\d+)字 · (.*)$/gm)].map(
    (m) => ({
      id: Number(m[1]),
      title: m[3]!.trim(),
      chars: Number(m[4]),
      head: m[5]!.trim(),
    }),
  )
  const groups: (typeof chapters)[] = []
  let cur: typeof chapters = []
  let chars = 0
  for (const c of chapters) {
    if (cur.length > 0 && chars + c.chars > target * 1.4) {
      groups.push(cur)
      cur = []
      chars = 0
    }
    cur.push(c)
    chars += c.chars
  }
  if (cur.length > 0) groups.push(cur)
  // 还有后续批次时，没凑够体量的最后一组留给下一批（不吃掉半截）
  let nextChapter: number | undefined
  if (hasMore && groups.length > 1) {
    const tail = groups[groups.length - 1]!
    if (tail.reduce((n, c) => n + c.chars, 0) < target * 0.6) {
      groups.pop()
      nextChapter = tail[0]!.id
    }
  }
  const generic = /^(全文|正文|第\s*\d+\s*[节段部分]|未命名)/
  return {
    episodes: groups.map((g, i) => {
      const first = g[0]!
      const title =
        !generic.test(first.title) && first.title
          ? first.title
          : clip(first.head.replace(/[“”「」]/g, ''), 10)
      return {
        title: clip(title || `第 ${i + 1} 集`, 12),
        summary: clip(g.map((c) => c.head).join(' '), 60),
        fromChapter: first.id,
        toChapter: g[g.length - 1]!.id,
      }
    }),
    ...(nextChapter === undefined ? {} : { nextChapter }),
  }
}

// === 分镜拆解 ===

const MOVEMENTS = [
  'static',
  'static',
  'dolly_in',
  'static',
  'pan_right',
  'static',
  'zoom_in',
  'static',
  'pan_left',
] as const

function timeOfDay(text: string): string {
  if (/夜|晚|黑|月光|灯火|深夜|凌晨/.test(text)) return '夜'
  if (/清晨|早晨|黎明|晨光|日出/.test(text)) return '晨'
  if (/傍晚|黄昏|夕阳/.test(text)) return '黄昏'
  return '日'
}

function mood(text: string): string[] {
  const tags: string[] = []
  if (/雨|阴|暗|黑/.test(text)) tags.push('压抑')
  if (/笑|喜|欢|暖/.test(text)) tags.push('温暖')
  if (/怒|吼|冷笑|拍案/.test(text)) tags.push('紧张')
  if (/泪|哭|叹|沉默/.test(text)) tags.push('低沉')
  return tags.length ? tags.slice(0, 2) : ['平静']
}

function breakdown(messages: ChatMessage[], memory: LlmMemory) {
  const user = lastUser(messages)
  const project = projectOf(user)
  const marker = user.indexOf('# 本段原文')
  const source = marker === -1 ? user : user.slice(user.indexOf('\n', marker) + 1)
  const registered = [...user.matchAll(/^- (?:@)?([^（\s\n]+)（/gm)].map((m) => m[1]!)
  const names = findEntities(source, [...registered, ...memory.known(project)])
  memory.remember(project, [...names.characters, ...names.locations, ...names.props])

  type Shot = Record<string, unknown>
  const scenes: Array<{
    title: string
    location: string
    time_of_day: string
    blocking: string
    continues_previous_scene: boolean
    shots: Shot[]
  }> = []
  let scene: (typeof scenes)[number] | undefined
  const newScene = (title: string, location: string, text: string) => {
    const created: (typeof scenes)[number] = {
      title,
      location,
      time_of_day: timeOfDay(text),
      blocking: location ? `${location}内，主要人物面对面站位，出入口在画面一侧` : '',
      continues_previous_scene: false,
      shots: [],
    }
    scenes.push(created)
    return created
  }

  let prevSpeaker: string | undefined
  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^(第.{1,8}[章节回集幕]|#+\s|[一二三四五六七八九十]+、)/.test(line) && line.length <= 24) {
      scene = newScene(line.replace(/^#+\s*/, ''), '', line)
      continue
    }
    // 长段落按句子拆成 ≤100 字的几块，每块一个镜头
    const sentences = splitSentences(line)
    const chunks: string[] = []
    let buf = ''
    for (const s of sentences) {
      if (buf && buf.length + s.length > 100) {
        chunks.push(buf)
        buf = ''
      }
      buf += s
    }
    if (buf) chunks.push(buf)
    for (const chunk of chunks.length ? chunks : [line]) {
      const here = findEntities(chunk, [...names.characters, ...names.locations, ...names.props])
      const location = here.locations[0] ?? ''
      if (!scene || (location && scene.location && location !== scene.location)) {
        scene = newScene(scene ? `${location}` : location || '开场', location, chunk)
      } else if (!scene.location && location) {
        scene.location = location
      }
      const current = scene
      const quotes = findQuotes(chunk, names.characters).map((q) => {
        const speaker =
          q.speaker ?? here.characters.find((c) => c !== prevSpeaker) ?? here.characters[0]
        if (speaker) prevSpeaker = speaker
        return {
          speaker: speaker ?? '',
          text: q.text,
          emotion: /[！!]/.test(q.text) ? '激动' : '平静',
        }
      })
      const spoken = quotes.reduce((n, q) => n + charCount(q.text), 0)
      const narrated = quotes.length === 0
      const sentencesIn = splitSentences(chunk)
      const first = current.shots.length === 0
      current.shots.push({
        title: clip(chunk.replace(/[“”「」]/g, ''), 8),
        excerpt: chunk,
        camera_shot: first ? 'LS' : quotes.length > 0 ? (quotes.length > 1 ? 'MS' : 'CU') : 'MLS',
        angle: 'eye_level',
        movement: MOVEMENTS[current.shots.length % MOVEMENTS.length],
        duration_sec: clamp(Math.round(2 + charCount(chunk) / 14 + spoken / 5), 4, 12),
        mood_tags: mood(chunk),
        atmosphere: mood(chunk).join('、') + '的氛围',
        dialogue: quotes,
        narration: narrated ? clip(sentencesIn[0] ?? chunk, 40) : '',
        action_beats: sentencesIn.slice(0, 3).map((s, i) => `子镜头${i + 1}：${clip(s, 24)}`),
        characters: here.characters,
        props: here.props,
        costumes: here.costumes,
      })
    }
  }
  return { scenes: scenes.filter((s) => s.shots.length > 0) }
}

// === 实体抽取 / 合并 / 变体 ===

function extract(messages: ChatMessage[], memory: LlmMemory) {
  const user = lastUser(messages)
  const known = memory.known(projectOf(user))
  const blocks = user.split(/^## 镜头 /m).slice(1)
  return {
    shots: blocks.map((b) => {
      const index = Number(/^(\d+)/.exec(b)?.[1])
      const text = b.replace(/^[^\n]*\n/, '')
      const ents = findEntities(text, known)
      const speakers = [...text.matchAll(/(?:^|\s\/\s)对白：?([^：\n/]+)：/gm)].map((m) =>
        m[1]!.trim(),
      )
      const characters = [
        ...new Set([...ents.characters, ...speakers.filter((s) => s && s !== '?')]),
      ]
      const costume = ents.costumes[0] ?? ''
      const evidence = (/原文：([^\n]*)/.exec(b)?.[1] ?? '').slice(0, 40)
      const describe = (name: string) => {
        const sentence = splitSentences(text).find(
          (s) => s.includes(name) && /穿|戴|身|眉|眼|发|岁|脸|衣|披/.test(s),
        )
        return sentence ? clip(sentence, 40) : ''
      }
      return {
        index,
        entities: [
          ...characters.map((name) => ({
            name,
            kind: 'character',
            aliases: [] as string[],
            appearance: describe(name),
            costume_note: costume,
            evidence,
          })),
          ...ents.locations.map((name) => ({
            name,
            kind: 'location',
            aliases: [] as string[],
            appearance: '',
            costume_note: '',
            evidence,
          })),
          ...ents.props.map((name) => ({
            name,
            kind: 'prop',
            aliases: [] as string[],
            appearance: '',
            costume_note: '',
            evidence,
          })),
        ],
      }
    }),
  }
}

function merge(messages: ChatMessage[]) {
  const user = lastUser(messages)
  const library = user.slice(user.indexOf('# 已登记的资产库'), user.indexOf('# 初步分组'))
  const groups = [...user.matchAll(/^(\d+) · (\w+) · ([^·]+) · 镜头 ([\d,]+) · (.*)$/gm)]
  return {
    entities: groups.map((g) => {
      const names = g[3]!.split(' / ').map((s) => s.trim())
      const shotCount = g[4]!.split(',').length
      const appearance = g[5] === '（无描述）' ? '' : g[5]!
      const inLibrary = names.find((n) => library.includes(`- ${n}（`))
      // 出现越多、描述越具体，把握越大——让界面上能看到高 / 中 / 低三档
      const confidence = clamp(0.35 + 0.15 * shotCount + (appearance ? 0.2 : 0), 0.3, 0.97)
      return {
        name: names[0]!,
        kind: g[2]!,
        aliases: names.slice(1),
        confidence: Math.round(confidence * 100) / 100,
        appearance,
        evidence: '',
        groups: [Number(g[1])],
        match: inLibrary
          ? { existing_name: inLibrary, reason: '名字相同', confidence: 0.95 }
          : null,
      }
    }),
  }
}

function variants(messages: ChatMessage[]) {
  const user = lastUser(messages)
  const characters = user
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const name = block.split('\n')[0]!.trim()
      const perShot = [...block.matchAll(/镜头 (\d+)：([^\n]*)/g)].map((m) => ({
        index: Number(m[1]),
        text: m[2]!,
        costume: COSTUME_WORDS.find((w) => m[2]!.includes(w)),
      }))
      const byCostume = new Map<string, number[]>()
      for (const s of perShot)
        if (s.costume) byCostume.set(s.costume, [...(byCostume.get(s.costume) ?? []), s.index])
      // 只有部分镜头穿的才算变体；全程不变的是默认形象
      return {
        name,
        timeline: [],
        variants: [...byCostume.entries()]
          .filter(([, shots]) => shots.length < perShot.length || byCostume.size > 1)
          .map(([key, shots]) => ({ variant_key: key, description: `换上${key}`, shots })),
      }
    })
  return { characters: characters.filter((c) => c.variants.length > 0) }
}

// === 镜头提示词 ===

function frames(messages: ChatMessage[]) {
  const user = lastUser(messages)
  const blocks = user.split(/^## 镜头 /m).slice(1)
  return {
    shots: blocks.map((b) => {
      const index = Number(/^(\d+)/.exec(b)?.[1])
      const mentions = [...b.matchAll(/^ {2}- (@[^（\n]+)（/gm)].map((m) => m[1]!)
      const who = mentions.join(' 与 ') || '空镜'
      const excerpt = /原文：([^\n]*)/.exec(b)?.[1] ?? ''
      const beats = /子镜头 \/ 动作：([^\n]*)/.exec(b)?.[1]?.split(' → ') ?? []
      const place = /地点 ([^\s·]*)/.exec(b)?.[1] ?? ''
      const spatial = place ? `在${place}，近处是人物，远处是环境` : '近处是人物，远处是环境'
      const big = index % 3 === 0
      const slot = (subject: string, action: string) => ({
        subject,
        action,
        expression: '神情专注',
        spatial,
        shot_size: 'MS',
        angle: 'eye_level',
        lens: '',
        lighting: /夜|晚/.test(b) ? '昏暗的暖色灯光' : '柔和的自然光',
        extra: '',
        negative: ['画面中没有多余的路人'],
        full_en: `${who} in the scene, ${clip(action, 30)}`,
      })
      return {
        index,
        change_magnitude: big ? 'medium' : 'small',
        image: slot(
          `${who} 位于画面中央`,
          clip(beats[0]?.replace(/^子镜头\d+：/, '') || excerpt, 30),
        ),
        last_frame: big ? slot(`${who} 转身`, '转身看向画面外') : null,
        video: {
          opening_state: '',
          action: `先稳住画面，接着${who}${clip(beats[1]?.replace(/^子镜头\d+：/, '') || '缓缓转头', 20)}，最后停在${place || '画面中心'}`,
          secondary: '衣摆与环境光影轻微变化',
          camera_move: '',
          end_state: '视线落在画面外',
          lighting_change: '',
          sound_intent: '环境声',
          extra: '',
          full_en: `${who} slowly turns, camera holds steady`,
        },
      }
    }),
  }
}
