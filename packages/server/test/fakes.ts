import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateFfmpeg, probeCapabilities, runFfmpeg } from '@dramai/core'
import type {
  FetchLike,
  FfmpegBinaries,
  FfmpegCapabilities,
  LlmClient,
  LlmRequest,
  ProviderConfig,
} from '@dramai/core'

// === 多章节原文 ===

export const HERO = '林夏'
export const LEAD = '陆沉'
export const PLACE = '老茶馆'
export const PROP = '青瓷杯'

const PARAS = [
  `${HERO}推开${PLACE}的门，雨水顺着伞沿滴落，柜台后的灯忽明忽暗。`,
  `${LEAD}坐在窗边，指尖转着一只${PROP}，抬眼看她。`,
  `${LEAD}说：“你终于来了。”`,
  `${HERO}说：“那封信是你寄的？”`,
  `旁白：这一夜，所有人的命运都被一只杯子改变。`,
  `${HERO}走到桌前，把伞靠在椅背上，目光落在${PROP}上。`,
  `${LEAD}把${PROP}推到她面前，杯底刻着一行细小的字。`,
  `${HERO}说：“这不是我父亲的字迹。”`,
  `窗外一道闪电划过，${PLACE}里的人影在墙上拉得很长。`,
  `旁白：雨越下越大，没有人注意到门口多了一个撑黑伞的影子。`,
]

/** 生成 n 个章节的原文，每章 paragraphsPerChapter 段。体量远超 4000 字。 */
export function makeNovel(chapters: number, paragraphsPerChapter = 10, fill = 1): string {
  const out: string[] = []
  for (let c = 1; c <= chapters; c++) {
    out.push(`第${c}章 夜雨`)
    for (let p = 0; p < paragraphsPerChapter; p++) {
      out.push(
        `${PARAS[(p + c) % PARAS.length]}（第${c}章第${p + 1}段，${'雨声敲着屋檐，街灯在水洼里碎成一片。'.repeat(fill)}）`,
      )
    }
    out.push('')
  }
  return out.join('\n')
}

// === 假 LLM：按任务名回放，输出由输入派生 ===

const ENTITY: Record<string, { kind: string; appearance: string }> = {
  [HERO]: { kind: 'character', appearance: '二十出头的女子，黑色长发，米色风衣' },
  [LEAD]: { kind: 'character', appearance: '三十岁上下的男子，眉眼冷峻，深灰长衫' },
  [PLACE]: { kind: 'location', appearance: '临街的两层木结构茶馆，红灯笼，湿漉漉的青石板' },
  [PROP]: { kind: 'prop', appearance: '一只釉色青绿的瓷杯，杯底刻字' },
}

export interface LlmLog {
  task: string
  messages: LlmRequest['messages']
}

export function fakeLlm(
  options: {
    failTasks?: Set<string>
    overrides?: Record<string, (req: LlmRequest) => unknown>
  } = {},
) {
  const log: LlmLog[] = []
  const client: LlmClient = {
    async complete(req) {
      log.push({ task: req.task, messages: req.messages })
      if (options.failTasks?.has(req.task)) return { text: '抱歉，我做不到' }
      const custom = options.overrides?.[req.task]
      const out = custom ? custom(req) : script(req)
      return { text: typeof out === 'string' ? out : JSON.stringify(out) }
    },
  }
  return { client, log, calls: (task: string) => log.filter((l) => l.task === task).length }
}

const userOf = (req: LlmRequest) => String(req.messages[req.messages.length - 1].content)
const systemOf = (req: LlmRequest) => String(req.messages[0].content)

function script(req: LlmRequest): unknown {
  switch (req.task) {
    case 'episodes.plan': {
      const user = userOf(req)
      const ids = [...user.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]))
      const hasMore = /后面还有内容：是/.test(user)
      const episodes: Array<{
        title: string
        summary: string
        fromChapter: number
        toChapter: number
      }> = []
      let i = 0
      while (i < ids.length) {
        const to = Math.min(i + 1, ids.length - 1)
        if (hasMore && to === i && i === ids.length - 1) break // 落单的一章留给下一批
        episodes.push({
          title: `雨夜篇 ${ids[i]}`,
          summary: `章节 ${ids[i]} 到 ${ids[to]} 的剧情`,
          fromChapter: ids[i],
          toChapter: ids[to],
        })
        i = to + 1
      }
      return { episodes, nextChapter: i < ids.length ? ids[i] : undefined }
    }
    case 'shots.breakdown': {
      const user = userOf(req)
      const source = user.slice(user.indexOf('字）') + 2)
      const scenes: Array<Record<string, unknown>> = []
      let cur: { title: string; shots: Array<Record<string, unknown>> } | undefined
      for (const raw of source.split('\n')) {
        const line = raw.trim()
        if (!line) continue
        if (/^第\d+章/.test(line)) {
          cur = { title: line, shots: [] }
          scenes.push({
            title: line,
            location: PLACE,
            time_of_day: '夜',
            blocking: '柜台在画面右侧，窗在左侧',
            continues_previous_scene: false,
            shots: cur.shots,
          })
          continue
        }
        if (!cur) {
          cur = { title: '开场', shots: [] }
          scenes.push({
            title: '开场',
            location: PLACE,
            time_of_day: '夜',
            continues_previous_scene: false,
            shots: cur.shots,
          })
        }
        const isNarration = line.startsWith('旁白：')
        const quoted = [...line.matchAll(/(陆沉|林夏)说：“([^”]+)”/g)]
        const names = [HERO, LEAD].filter((n) => line.includes(n))
        cur.shots.push({
          title: line.slice(0, 8),
          excerpt: line,
          camera_shot: 'MS',
          angle: 'eye_level',
          movement: 'static',
          duration_sec: 10,
          mood_tags: ['紧张'],
          atmosphere: '雨夜的潮湿与压抑',
          dialogue: quoted.map((m) => ({ speaker: m[1], text: m[2], emotion: '低沉' })),
          narration: isNarration ? line.replace('旁白：', '').split('（')[0] : '',
          action_beats: [`子镜头1：${line.slice(0, 20)}`, '子镜头2：反应特写'],
          characters: names,
          props: line.includes(PROP) ? [PROP] : [],
          costumes: [],
        })
      }
      return { scenes }
    }
    case 'entities.extract': {
      const user = userOf(req)
      const blocks = user.split(/^## 镜头 /m).slice(1)
      return {
        shots: blocks.map((b) => {
          const index = Number(/^(\d+)/.exec(b)?.[1])
          const entities = Object.keys(ENTITY)
            .filter((n) => b.includes(n))
            .map((n) => ({
              name: n,
              kind: ENTITY[n].kind,
              aliases: [],
              appearance: ENTITY[n].appearance,
              costume_note: b.includes('婚服') && n === HERO ? '婚服' : '',
              evidence: b.split('\n')[1]?.slice(0, 40) ?? '',
            }))
          return { index, entities }
        }),
      }
    }
    case 'entities.merge': {
      const user = userOf(req)
      const library = user.slice(user.indexOf('# 已登记的资产库'), user.indexOf('# 初步分组'))
      const groups = [...user.matchAll(/^(\d+) · (\w+) · ([^·]+) · 镜头 ([\d,]+) · (.*)$/gm)]
      return {
        entities: groups.map((g) => {
          const names = g[3].split(' / ').map((s) => s.trim())
          const inLibrary = names.find((n) => library.includes(`- ${n}（`))
          return {
            name: names[0],
            kind: g[2],
            aliases: names.slice(1),
            confidence: 0.9,
            appearance: g[5] === '（无描述）' ? '' : g[5],
            evidence: '',
            groups: [Number(g[1])],
            match: inLibrary
              ? { existing_name: inLibrary, reason: '名字相同', confidence: 0.95 }
              : null,
          }
        }),
      }
    }
    case 'entities.variants': {
      const user = userOf(req)
      const hit = [...user.matchAll(/镜头 (\d+)：[^\n]*婚服/g)].map((m) => Number(m[1]))
      return hit.length > 0
        ? {
            characters: [
              {
                name: HERO,
                timeline: [],
                variants: [
                  { variant_key: '婚服', description: '换上红色织锦嫁衣，头戴金凤冠', shots: hit },
                ],
              },
            ],
          }
        : { characters: [] }
    }
    case 'shots.frames': {
      const user = userOf(req)
      const blocks = user.split(/^## 镜头 /m).slice(1)
      return {
        shots: blocks.map((b) => {
          const index = Number(/^(\d+)/.exec(b)?.[1])
          const mentions = [...b.matchAll(/^ {2}- (@[^（\n]+)（/gm)].map((m) => m[1])
          const who = mentions.join(' 与 ') || '空镜'
          return {
            index,
            change_magnitude: index % 3 === 0 ? 'medium' : 'small',
            image: {
              subject: `${who} 位于画面中央`,
              action: '刚要开口，身体微微前倾',
              expression: '目光看向对面',
              spatial: '机位在桌前，近处是桌面，远处是窗',
              shot_size: 'MS',
              angle: 'eye_level',
              lens: '',
              lighting: '冷色的窗光',
              extra: '雨痕',
              negative: ['画面中没有多余的路人'],
              full_en: `${who} stands in the center of the frame, leaning slightly forward`,
            },
            last_frame:
              index % 3 === 0
                ? {
                    subject: `${who} 转身`,
                    action: '转身看向门口',
                    expression: '',
                    spatial: '',
                    shot_size: 'MS',
                    angle: 'eye_level',
                    lens: '',
                    lighting: '',
                    extra: '',
                    negative: [],
                    full_en: `${who} turns toward the door`,
                  }
                : null,
            video: {
              opening_state: '',
              action: `先抬眼，接着${who}缓缓转头，最后视线落在门口`,
              secondary: '衣摆随风微动，窗外雨线斜落',
              camera_move: '',
              end_state: '视线落在门口',
              lighting_change: '',
              sound_intent: '雨声',
              extra: '',
              full_en: `${who} slowly turns head toward the door`,
            },
          }
        }),
      }
    }
    default:
      void systemOf
      throw new Error(`fake LLM has no script for task "${req.task}"`)
  }
}

// === 真实 ffmpeg + 假服务商 ===

export interface MediaEnv {
  bins: FfmpegBinaries
  caps: FfmpegCapabilities
}

export async function locateMedia(): Promise<MediaEnv | undefined> {
  try {
    const bins = await locateFfmpeg()
    return { bins, caps: await probeCapabilities(bins) }
  } catch {
    return undefined
  }
}

/** 用 lavfi 生成小素材（带缓存）。 */
export function mediaFactory(bins: FfmpegBinaries) {
  const cache = new Map<string, Uint8Array>()
  const make = async (key: string, args: string[], ext: string): Promise<Uint8Array> => {
    const hit = cache.get(key)
    if (hit) return new Uint8Array(hit)
    const dir = await mkdtemp(join(tmpdir(), 'dramai-fake-'))
    try {
      const out = join(dir, `o.${ext}`)
      await runFfmpeg(bins, [...args, out])
      const bytes = new Uint8Array(await readFile(out))
      cache.set(key, bytes)
      return new Uint8Array(bytes)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  return {
    /** 每个 seed 一张不同颜色的 PNG（宽高可选，默认竖图 180×320）。 */
    png: (seed: number, w = 180, h = 320) =>
      make(
        `png:${seed}:${w}x${h}`,
        [
          '-f',
          'lavfi',
          '-i',
          `color=c=0x${((seed * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(0, 6)}:s=${w}x${h}`,
          '-frames:v',
          '1',
        ],
        'png',
      ),
    /** 带 440Hz 音轨的 mp4（模拟视频模型的原生人声），duration 秒。 */
    videoWithAudio: (seed: number, duration = 2) =>
      make(
        `vid:a:${seed}:${duration}`,
        [
          '-f',
          'lavfi',
          '-i',
          `testsrc2=size=180x320:rate=24:duration=${duration}`,
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=${300 + (seed % 5) * 50}:duration=${duration}`,
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-shortest',
        ],
        'mp4',
      ),
    videoSilent: (seed: number, duration = 2) =>
      make(
        `vid:s:${seed}:${duration}`,
        [
          '-f',
          'lavfi',
          '-i',
          `testsrc2=size=180x320:rate=24:duration=${duration}`,
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-an',
        ],
        'mp4',
      ),
    wav: (seed: number, duration = 1.5) =>
      make(
        `wav:${seed}:${duration}`,
        [
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=${500 + (seed % 7) * 40}:duration=${duration}`,
          '-c:a',
          'pcm_s16le',
        ],
        'wav',
      ),
  }
}

export interface RequestLog {
  method: string
  url: string
  body?: unknown
}

/**
 * 假服务商：Gemini 图像 / 阿里 DashScope 视频 / OpenAI TTS 的端点。返回 lavfi 生成的小素材。
 * `videoHasAudio`：视频是否带音轨（模拟 generate_audio）。
 */
export function fakeProviders(
  media: ReturnType<typeof mediaFactory>,
  options: { videoHasAudio?: boolean } = {},
) {
  const requests: RequestLog[] = []
  /** 测试里可改的故障开关。 */
  const faults = {
    failImages: 0,
    failPolls: 0,
    failSubmits: 0,
    /** 轮询一直返回“进行中”（模拟上游还在生成，服务在此期间被杀）。 */
    holdPolls: false,
    /** 提交请求发出后一直不返回（模拟请求已送达但连接断了：结果不明）。 */
    holdSubmits: false,
    /** 图片请求等这个 promise 结束才返回（模拟生成很慢）。 */
    imageGate: undefined as Promise<void> | undefined,
  }
  let images = 0
  let tasks = 0
  const taskVideos = new Map<string, number>()
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET'
    let body: unknown
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    }
    requests.push({ method, url, body })
    if (url.includes(':generateContent')) {
      if (faults.imageGate) await faults.imageGate
      if (faults.failImages > 0) {
        faults.failImages--
        return new Response('upstream exploded', { status: 500 })
      }
      const bytes = await media.png(++images)
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inline_data: {
                      mime_type: 'image/png',
                      data: Buffer.from(bytes).toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      )
    }
    if (url.endsWith('/video-synthesis') || url.endsWith('/contents/generations/tasks')) {
      if (faults.holdSubmits) {
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException('aborted', 'AbortError'))
          if (init?.signal?.aborted) abort()
          init?.signal?.addEventListener('abort', abort, { once: true })
        })
      }
      if (faults.failSubmits > 0) {
        faults.failSubmits--
        return new Response('bad gateway', { status: 502 })
      }
      const id = `task-${++tasks}`
      taskVideos.set(id, tasks)
      return url.endsWith('/video-synthesis')
        ? new Response(JSON.stringify({ output: { task_id: id, task_status: 'PENDING' } }), {
            status: 200,
          })
        : new Response(JSON.stringify({ id }), { status: 200 })
    }
    const vpoll = /\/volcengine\/api\/v3\/contents\/generations\/tasks\/(task-\d+)/.exec(url)
    if (vpoll) {
      if (faults.holdPolls) {
        return new Response(JSON.stringify({ status: 'running' }), { status: 200 })
      }
      if (faults.failPolls > 0) {
        faults.failPolls--
        return new Response('bad gateway', { status: 502 })
      }
      return new Response(
        JSON.stringify({
          status: 'succeeded',
          content: { video_url: `https://cdn.fake/${vpoll[1]}.mp4` },
        }),
        { status: 200 },
      )
    }
    const poll = /\/aliyun\/api\/v1\/tasks\/(task-\d+)/.exec(url)
    if (poll) {
      if (faults.holdPolls) {
        return new Response(JSON.stringify({ output: { task_status: 'RUNNING' } }), { status: 200 })
      }
      if (faults.failPolls > 0) {
        faults.failPolls--
        return new Response('bad gateway', { status: 502 })
      }
      return new Response(
        JSON.stringify({
          output: { task_status: 'SUCCEEDED', video_url: `https://cdn.fake/${poll[1]}.mp4` },
        }),
        { status: 200 },
      )
    }
    const cdn = /https:\/\/cdn\.fake\/(task-\d+)\.mp4/.exec(url)
    if (cdn) {
      const n = taskVideos.get(cdn[1]) ?? 1
      const bytes = options.videoHasAudio
        ? await media.videoWithAudio(n)
        : await media.videoSilent(n)
      return new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4' } })
    }
    if (url.endsWith('/audio/speech')) {
      const bytes = await media.wav(requests.length)
      return new Response(bytes, { status: 200, headers: { 'content-type': 'audio/wav' } })
    }
    return new Response('not found', { status: 404 })
  }
  const posts = (needle: string) =>
    requests.filter((r) => r.method === 'POST' && r.url.includes(needle))
  return { fetch, requests, posts, faults }
}

export const PROVIDERS: ProviderConfig[] = [
  {
    id: 'llm',
    label: 'DeepSeek',
    kind: 'llm',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    enabled: true,
  },
  {
    id: 'img',
    label: 'Nano Banana',
    kind: 'image',
    protocol: 'gemini-image',
    baseUrl: 'https://api.302.ai',
    model: 'gemini-2.5-flash-image',
    enabled: true,
    secretRef: 'k-img',
    acceptedUnverified: ['mode:i2i', 'refImages', 'aspectRatio'],
  },
  {
    id: 'vid',
    label: 'Wan Flash',
    kind: 'video',
    protocol: 'aliyun-video',
    baseUrl: 'https://api.302ai.cn',
    model: 'wan2.2-i2v-flash',
    enabled: true,
    secretRef: 'k-vid',
  },
  {
    id: 'seedance',
    label: 'Seedance',
    kind: 'video',
    protocol: 'volcengine-video',
    baseUrl: 'https://api.302.ai',
    model: 'doubao-seedance-2-0-fast-260128',
    enabled: true,
    secretRef: 'k-vid',
    acceptedUnverified: ['mode:i2v', 'firstFrame', 'duration', 'resolution'],
  },
  {
    id: 'tts',
    label: 'TTS',
    kind: 'tts',
    protocol: 'openai-tts',
    baseUrl: 'https://api.tts.example',
    model: 'tts-1',
    enabled: true,
    secretRef: 'k-tts',
    acceptedUnverified: ['mode:tts'],
  },
]
