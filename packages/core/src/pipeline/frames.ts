import { z } from 'zod'
import type { Asset } from '../domain/asset.ts'
import type { Shot, ShotPromptSpec } from '../domain/shot.ts'
import { compileImagePrompt, compileVideoPrompt } from '../prompts/compile.ts'
import type { ImagePromptSpec, VideoPromptSpec } from '../prompts/compile.ts'
import { renderMentionsForLlm, resolveMentionsFromLlm } from '../prompts/mentions.ts'
import type { MentionAsset } from '../prompts/mentions.ts'
import { CAMERA_PHRASE_ZH } from './camera.ts'
import type { PipelineDeps } from './deps.ts'
import { llmJson } from './deps.ts'
import { episodeShots } from './entities.ts'

/**
 * 步骤 4：镜头提示词。每个镜头得到“首帧语义槽 + 视频动作增量槽 + 变化幅度（+ 尾帧槽）”（A4.4 / A4.5 / A17）。
 *
 * - LLM 只填创作语义；画风、参考图绑定、负面处理、防字地板在生成时按目标模型的写法注入（见 `pipeline/image.ts`）。
 * - 槽里的资产名（`@名字`）在这里解析成稳定 id（`@{assetId}`），重命名因此只改资产那一行。
 * - 同时写一份“中性文本”到 `shot.prompts`（给界面预览 / 编辑、给时效判定用）。
 */

const imageSlots = z.object({
  subject: z.string().optional().default(''),
  action: z.string().optional().default(''),
  expression: z.string().optional().default(''),
  spatial: z.string().optional().default(''),
  shot_size: z.string().optional().default(''),
  angle: z.string().optional().default(''),
  lens: z.string().optional().default(''),
  lighting: z.string().optional().default(''),
  extra: z.string().optional().default(''),
  negative: z.array(z.string()).optional().default([]),
  full_en: z.string().optional().default(''),
})
const videoSlots = z.object({
  opening_state: z.string().optional().default(''),
  action: z.string().optional().default(''),
  secondary: z.string().optional().default(''),
  camera_move: z.string().optional().default(''),
  end_state: z.string().optional().default(''),
  lighting_change: z.string().optional().default(''),
  sound_intent: z.string().optional().default(''),
  extra: z.string().optional().default(''),
  full_en: z.string().optional().default(''),
})
const framesSchema = z.object({
  shots: z
    .array(
      z.object({
        index: z.coerce.number().int(),
        change_magnitude: z.string().optional(),
        image: imageSlots,
        last_frame: imageSlots.nullable().optional(),
        video: videoSlots,
      }),
    )
    .default([]),
})

export interface FramesOptions {
  batchSize?: number
  /** 只处理还没有提示词的镜头（默认处理全部）。 */
  onlyMissing?: boolean
  signal?: AbortSignal
}

export interface FramesResult {
  updated: Shot[]
  llmCalls: number
  /** LLM 漏掉的镜头 id。 */
  missing: string[]
}

const nz = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined)

function toImageSpec(s: z.output<typeof imageSlots>, assets: MentionAsset[]): ImagePromptSpec {
  const r = (t: string) => nz(resolveMentionsFromLlm(t, assets))
  return {
    subject: r(s.subject),
    action: r(s.action),
    expression: r(s.expression),
    spatial: r(s.spatial),
    shotSize: nz(s.shot_size),
    angle: nz(s.angle),
    lens: nz(s.lens),
    lighting: nz(s.lighting),
    extra: r(s.extra),
    fullEn: r(s.full_en),
    negative: s.negative.map((n) => n.trim()).filter(Boolean),
  }
}

function toVideoSpec(
  s: z.output<typeof videoSlots>,
  shot: Shot,
  assets: MentionAsset[],
): VideoPromptSpec {
  const r = (t: string) => nz(resolveMentionsFromLlm(t, assets))
  return {
    openingState: r(s.opening_state),
    action: r(s.action),
    secondary: r(s.secondary),
    // 一镜一个主运镜：LLM 没写就按镜头自己的运镜补。
    cameraMove: nz(s.camera_move) ?? CAMERA_PHRASE_ZH[shot.movement],
    endState: r(s.end_state),
    lightingChange: r(s.lighting_change),
    soundIntent: nz(s.sound_intent),
    extra: r(s.extra),
    fullEn: r(s.full_en),
  }
}

const NEUTRAL = { lang: 'zh', negative: 'none' } as const

export async function generateShotPrompts(
  deps: PipelineDeps,
  episodeId: string,
  options: FramesOptions = {},
): Promise<FramesResult> {
  const episode = await deps.store.episodes.get(episodeId)
  if (!episode) throw new Error(`episode not found: ${episodeId}`)
  const project = (await deps.store.projects.get(episode.projectId))!
  const all = await episodeShots(deps.store, episodeId)
  const assets = await deps.store.assets.listByProject(project.id)
  const mentionAssets: MentionAsset[] = assets.map((a) => ({
    id: a.id,
    name: a.name,
    aliases: a.aliases,
  }))
  const targets = all.filter((s) => !options.onlyMissing || !s.prompts.keyFrame)
  const size = options.batchSize ?? 5
  const updated: Shot[] = []
  const missing: string[] = []
  let llmCalls = 0

  for (let start = 0; start < targets.length; start += size) {
    options.signal?.throwIfAborted()
    const batch = targets.slice(start, start + size)
    const blocks: string[] = []
    for (let i = 0; i < batch.length; i++) {
      blocks.push(await shotInfo(deps, batch[i], i + 1, all, assets, mentionAssets))
    }
    llmCalls++
    const out = await llmJson(deps, {
      task: 'shots.frames',
      schema: framesSchema,
      signal: options.signal,
      messages: [
        {
          role: 'system',
          content: deps.catalog.prompts.render('shots.frames.system', {
            aspectRatio: project.aspectRatio,
            styleLabel: project.style.source === 'none' ? '未指定' : project.style.label,
          }),
        },
        {
          role: 'user',
          content: deps.catalog.prompts.render('shots.frames.user', {
            styleKeywords: project.style.imageKeywords || '（无）',
            shotsBlock: blocks.join('\n\n'),
          }),
        },
      ],
    })
    for (let i = 0; i < batch.length; i++) {
      const shot = batch[i]
      const res = out.shots.find((x) => x.index === i + 1)
      if (!res) {
        missing.push(shot.id)
        continue
      }
      const image = toImageSpec(res.image, mentionAssets)
      const video = toVideoSpec(res.video, shot, mentionAssets)
      const mag = (['small', 'medium', 'large'] as const).find(
        (m) => m === res.change_magnitude?.toLowerCase(),
      )
      const spec: ShotPromptSpec = { image, video, changeMagnitude: mag }
      const first = compileImagePrompt(image, { dialect: NEUTRAL }).text
      const last = res.last_frame
        ? compileImagePrompt(toImageSpec(res.last_frame, mentionAssets), { dialect: NEUTRAL }).text
        : undefined
      const next: Shot = {
        ...shot,
        promptSpec: spec,
        prompts: {
          ...shot.prompts,
          keyFrame: first || undefined,
          firstFrame: first || undefined,
          lastFrame: last || undefined,
          video: compileVideoPrompt(video, { dialect: NEUTRAL }).text || undefined,
        },
        updatedAt: deps.clock.now(),
      }
      await deps.store.shots.put(next)
      updated.push(next)
    }
  }
  return { updated, llmCalls, missing }
}

async function shotInfo(
  deps: PipelineDeps,
  shot: Shot,
  index: number,
  all: Shot[],
  assets: Asset[],
  mentionAssets: MentionAsset[],
): Promise<string> {
  const refs = await deps.store.shotRefs.listByShot(shot.id)
  const scene = await deps.store.scenes.get(shot.sceneId)
  const pos = all.findIndex((s) => s.id === shot.id)
  const prev = pos > 0 ? all[pos - 1] : undefined
  const next = pos >= 0 && pos < all.length - 1 ? all[pos + 1] : undefined
  const present = refs
    .map((r) => {
      const a = assets.find((x) => x.id === r.assetId)
      if (!a) return undefined
      const label = r.variantName ? `${a.name}/${r.variantName}` : a.name
      const variants = a.variants.length
        ? `；可用形态：${a.variants.map((v) => v.name).join('、')}`
        : ''
      return `  - @${label}（${a.kind}）${a.appearance ? `：${a.appearance}` : ''}${variants}`
    })
    .filter(Boolean)
  const say = (t: string) => renderMentionsForLlm(t, mentionAssets)
  return [
    `## 镜头 ${index}《${shot.title}》 · ${shot.durationSec} 秒 · ${shot.cameraShot ?? ''} ${shot.angle ?? ''} · 运镜 ${shot.movement}（${CAMERA_PHRASE_ZH[shot.movement]}）`,
    scene
      ? `场：${scene.title ?? ''} · 地点 ${scene.locationHint ?? ''} · ${scene.timeOfDay ?? ''}${scene.blocking ? `\n站位：${scene.blocking}` : ''}`
      : '',
    `原文：${say(shot.scriptExcerpt)}`,
    shot.actionBeats.length ? `子镜头 / 动作：${shot.actionBeats.join(' → ')}` : '',
    shot.atmosphere ? `氛围：${shot.atmosphere}（${shot.moodTags.join('、')}）` : '',
    shot.dialogue.length
      ? `对白：${shot.dialogue.map((d) => `${d.speakerName ?? ''}：“${d.text}”`).join(' ')}`
      : '',
    shot.narration ? `旁白（不要写进视频提示词）：${shot.narration}` : '',
    present.length ? `出场资产：\n${present.join('\n')}` : '出场资产：（无）',
    prev
      ? `上一镜结尾：${prev.title}——${prev.actionBeats.at(-1) ?? prev.scriptExcerpt.slice(0, 60)}`
      : '',
    next
      ? `下一镜开头：${next.title}——${next.actionBeats[0] ?? next.scriptExcerpt.slice(0, 60)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}
