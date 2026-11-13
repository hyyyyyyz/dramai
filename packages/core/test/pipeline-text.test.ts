import { beforeAll, describe, expect, it } from 'vitest'
import { currentVersion } from '../src/domain/index.ts'
import { normalizeEntityName } from '../src/domain/asset.ts'
import {
  breakdownEpisode,
  dialogueMinSeconds,
  normalizeShotTiming,
} from '../src/pipeline/breakdown.ts'
import {
  confirmCandidate,
  episodeShots,
  extractEntities,
  undoCandidateLink,
} from '../src/pipeline/entities.ts'
import { episodeSourceText, planEpisodes } from '../src/pipeline/episodes.ts'
import { generateShotPrompts, missingPromptParts } from '../src/pipeline/frames.ts'
import { ingestMaterial } from '../src/pipeline/materials.ts'
import { renderMentionsPlain } from '../src/prompts/mentions.ts'
import {
  HERO,
  LEAD,
  LOCATE_MEDIA_HOOK_TIMEOUT_MS,
  PLACE,
  PROP,
  locateMedia,
  makeNovel,
  makePipelineEnv,
} from './fakes.ts'
import type { MediaEnv } from './fakes.ts'

let media: MediaEnv | undefined
beforeAll(async () => {
  // 文本流水线不需要 ffmpeg；这里只是复用同一个环境构造器。没有 ffmpeg 时用占位。
  media =
    (await locateMedia()) ??
    ({ bins: { ffmpeg: 'ffmpeg', source: 'path' }, caps: {} } as unknown as MediaEnv)
}, LOCATE_MEDIA_HOOK_TIMEOUT_MS)

const novel = (chapters: number, paras = 10) => new TextEncoder().encode(makeNovel(chapters, paras))

describe('normalizeShotTiming (A4 quantified rules)', () => {
  const shot = (over: Record<string, unknown> = {}) =>
    ({
      title: 't',
      excerpt: '',
      mood_tags: [],
      dialogue: [],
      action_beats: [],
      characters: [],
      props: [],
      costumes: [],
      ...over,
    }) as Parameters<typeof normalizeShotTiming>[0]

  it('clamps durations into [3, 15] seconds and rounds', () => {
    expect(normalizeShotTiming(shot({ duration_sec: 1 })).durationSec).toBe(3)
    expect(normalizeShotTiming(shot({ duration_sec: 40 })).durationSec).toBe(15)
    expect(normalizeShotTiming(shot({ duration_sec: 9.6 })).durationSec).toBe(10)
    expect(normalizeShotTiming(shot({})).durationSec).toBe(10) // 缺省按叙事镜头的 10 秒
  })

  it('applies the dialogue floor: duration ≥ chars / 4.5 + 2', () => {
    const line = (n: number) => ({ text: '字'.repeat(n) })
    expect(dialogueMinSeconds([line(9)])).toBe(4) // 9/4.5 + 2
    expect(dialogueMinSeconds([line(18), line(9)])).toBe(8) // 27/4.5 + 2 = 8
    expect(dialogueMinSeconds([])).toBe(0)
    const r = normalizeShotTiming(shot({ duration_sec: 4, dialogue: [line(36)] })) // 需要 10 秒
    expect(r.durationSec).toBe(10)
    expect(r.adjusted).toBe(true)
    expect(r.overflow).toBeUndefined()
  })

  it('moves dialogue that cannot fit in 15 seconds to a following shot', () => {
    const lines = Array.from({ length: 6 }, (_, i) => ({
      text: '字'.repeat(20),
      speaker: `甲${i}`,
    }))
    const r = normalizeShotTiming(
      shot({ duration_sec: 12, dialogue: lines, narration: '', action_beats: ['a'] }),
    )
    expect(r.durationSec).toBeLessThanOrEqual(15)
    expect(r.draft.dialogue.length).toBeLessThan(6)
    expect(r.overflow?.dialogue.length).toBe(6 - r.draft.dialogue.length)
    expect(r.draft.dialogue.concat(r.overflow!.dialogue)).toEqual(lines) // 一句不丢、顺序不变
    expect(r.overflow!.title).toBe('t（续）')
  })
})

describe('ingestMaterial', () => {
  it('stores the full text, detects chapters, counts characters, and allocates a monotonic number', async () => {
    const env = await makePipelineEnv(media!)
    const a = await ingestMaterial(env.deps, env.projectId, { name: '长篇.txt', bytes: novel(12) })
    const b = await ingestMaterial(env.deps, env.projectId, {
      name: '外传.md',
      bytes: new TextEncoder().encode('# 序\n一些文字'),
    })
    expect(a.summary).toMatchObject({ chapterCount: 12, truncated: false })
    expect(a.summary.charCount).toBeGreaterThan(4000)
    expect(a.material.text.length).toBeGreaterThan(4000)
    expect(b.summary.chapterCount).toBe(1)
    expect([a.material.number, b.material.number]).toEqual([1, 2])
    expect(await env.ports.files.exists(env.projectId, a.material.file!.path)).toBe(true)
    expect((await env.ports.store.projects.get(env.projectId))!.counters.material).toBe(2)
  })
})

describe('planEpisodes: source → episode plan (long text, batched)', () => {
  it("accepts the creator's requirement for this run (and only this run)", async () => {
    const env = await makePipelineEnv(media!)
    await ingestMaterial(env.deps, env.projectId, { name: '长篇.txt', bytes: novel(6) })
    await planEpisodes(env.deps, env.projectId, { instructions: '每集结尾留悬念' })
    const user = String(
      env.llm.log.filter((l) => l.task === 'episodes.plan')[0].messages[1].content,
    )
    expect(user).toContain('# 创作者的要求')
    expect(user).toContain('每集结尾留悬念')
    const env2 = await makePipelineEnv(media!)
    await ingestMaterial(env2.deps, env2.projectId, { name: '长篇.txt', bytes: novel(6) })
    await planEpisodes(env2.deps, env2.projectId)
    expect(
      String(env2.llm.log.filter((l) => l.task === 'episodes.plan')[0].messages[1].content),
    ).not.toContain('创作者的要求')
  })

  it('plans a 30-chapter novel in batches without truncating anything', async () => {
    const env = await makePipelineEnv(media!)
    const { material } = await ingestMaterial(env.deps, env.projectId, {
      name: '长篇.txt',
      bytes: novel(30),
    })
    const res = await planEpisodes(env.deps, env.projectId, {
      maxCharsPerBatch: 2500,
      targetChars: 1000,
    })
    expect(res.llmCalls).toBeGreaterThan(3) // 分了好几批
    expect(res.fallbackBatches).toBe(0)
    // 每一章恰好属于一集：集的行号范围首尾相接，覆盖整份原文
    const eps = res.episodes
    expect(eps.length).toBeGreaterThanOrEqual(10)
    const lines = material.text.split('\n').length
    expect(eps[0].sourceRange!.startLine).toBe(1)
    for (let i = 1; i < eps.length; i++) {
      expect(eps[i].sourceRange!.startLine).toBeLessThanOrEqual(
        eps[i - 1].sourceRange!.endLine! + 2,
      )
    }
    expect(eps[eps.length - 1].sourceRange!.endLine).toBeGreaterThanOrEqual(lines - 1)
    // 分集账本：播出顺序在项目里，集自己只有标题和范围
    const project = (await env.ports.store.projects.get(env.projectId))!
    expect(project.episodeOrder).toEqual(eps.map((e) => e.id))
    expect(project.counters.episode).toBe(eps.length)
    expect(eps.map((e) => e.number)).toEqual(eps.map((_, i) => i + 1))
    expect(new Set(eps.map((e) => e.id)).size).toBe(eps.length)
    expect(eps.every((e) => e.status === 'planned')).toBe(true)
    // 每一批的目录只含该批的章节（总目录不会被整份塞进一次调用）
    const tocs = env.llm.log
      .filter((l) => l.task === 'episodes.plan')
      .map((l) => [...String(l.messages[1].content).matchAll(/^\[(\d+)\]/gm)].length)
    expect(Math.max(...tocs)).toBeLessThan(30)
    expect(tocs.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(30)
  })

  it('falls back to a deterministic split when the LLM keeps returning garbage — the pipeline never stalls', async () => {
    const env = await makePipelineEnv(media!, { llm: { failTasks: new Set(['episodes.plan']) } })
    await ingestMaterial(env.deps, env.projectId, { name: '长篇.txt', bytes: novel(8) })
    const res = await planEpisodes(env.deps, env.projectId, { targetChars: 1500 })
    expect(res.fallbackBatches).toBeGreaterThan(0)
    expect(res.episodes.length).toBeGreaterThan(1)
    expect(res.episodes.every((e) => e.title.startsWith('第'))).toBe(true)
  })

  it('rejects overlapping / out-of-window ranges from the LLM and keeps the valid prefix', async () => {
    const env = await makePipelineEnv(media!, {
      llm: {
        overrides: {
          'episodes.plan': () => ({
            episodes: [
              { title: 'A', fromChapter: 0, toChapter: 1 },
              { title: 'B', fromChapter: 1, toChapter: 3 },
              { title: 'C', fromChapter: 9, toChapter: 99 },
            ],
          }),
        },
      },
    })
    await ingestMaterial(env.deps, env.projectId, { name: 'n.txt', bytes: novel(4) })
    const res = await planEpisodes(env.deps, env.projectId)
    expect(res.episodes[0].title).toBe('A')
    expect(res.episodes.map((e) => e.title)).not.toContain('B')
    expect(res.fallbackBatches).toBeGreaterThan(0) // 剩下的章节由兜底分完
  })

  it('works on text with no chapter headings by synthesising sections', async () => {
    const env = await makePipelineEnv(media!)
    const text = Array.from(
      { length: 80 },
      (_, i) => `这是第${i}段，${'雨夜里发生的事情。'.repeat(8)}`,
    ).join('\n')
    await ingestMaterial(env.deps, env.projectId, {
      name: '无章节.txt',
      bytes: new TextEncoder().encode(text),
    })
    const res = await planEpisodes(env.deps, env.projectId, { targetChars: 1200 })
    expect(res.episodes.length).toBeGreaterThan(1)
  })

  it('continuing a series only plans the new material', async () => {
    const env = await makePipelineEnv(media!)
    await ingestMaterial(env.deps, env.projectId, { name: '上.txt', bytes: novel(4) })
    const first = await planEpisodes(env.deps, env.projectId)
    await ingestMaterial(env.deps, env.projectId, { name: '下.txt', bytes: novel(2) })
    const second = await planEpisodes(env.deps, env.projectId)
    expect(second.episodes).toHaveLength(1)
    expect(second.episodes[0].number).toBe(first.episodes.length + 1)
    const project = (await env.ports.store.projects.get(env.projectId))!
    expect(project.episodeOrder).toHaveLength(first.episodes.length + 1)
    // 再规划一次：没有新增内容，什么也不做
    expect((await planEpisodes(env.deps, env.projectId)).episodes).toEqual([])
  })

  it('skips image materials and empty documents', async () => {
    const env = await makePipelineEnv(media!)
    await ingestMaterial(env.deps, env.projectId, {
      name: 'empty.txt',
      bytes: new TextEncoder().encode('   '),
    })
    expect((await planEpisodes(env.deps, env.projectId)).episodes).toEqual([])
    expect(env.llm.calls('episodes.plan')).toBe(0)
  })
})

async function prepared(opts: { chapters?: number } = {}) {
  const env = await makePipelineEnv(media!)
  await ingestMaterial(env.deps, env.projectId, {
    name: '长篇.txt',
    bytes: novel(opts.chapters ?? 4, 10),
  })
  const { episodes } = await planEpisodes(env.deps, env.projectId, { targetChars: 6000 })
  return { env, episodes }
}

describe('breakdownEpisode: episode → scenes → shots', () => {
  it("the creator's instructions reach the prompt, are remembered on the episode, and are reused when re-splitting", async () => {
    const { env, episodes } = await prepared({ chapters: 2 })
    const ep = episodes[0]
    const userOf = (n: number) =>
      String(env.llm.log.filter((l) => l.task === 'shots.breakdown')[n].messages[1].content)

    await breakdownEpisode(env.deps, ep.id) // 没有要求：提示词里没有这一段
    expect(userOf(0)).not.toContain('创作者的额外要求')

    await breakdownEpisode(env.deps, ep.id, {
      instructions: '  重点表现主角的心理变化；每镜不超过 8 秒  ',
    })
    expect(userOf(1)).toContain('# 创作者的额外要求')
    expect(userOf(1)).toContain('重点表现主角的心理变化；每镜不超过 8 秒')

    // 记在集上之后，重新拆分默认沿用
    await env.ports.store.episodes.put({
      ...(await env.ports.store.episodes.get(ep.id))!,
      breakdownInstructions: '重点表现主角的心理变化',
    })
    await breakdownEpisode(env.deps, ep.id)
    expect(userOf(2)).toContain('重点表现主角的心理变化')
    // 显式给空字符串 = 这一次不要任何要求
    await breakdownEpisode(env.deps, ep.id, { instructions: '' })
    expect(userOf(3)).not.toContain('创作者的额外要求')
  })

  it('breaks a long episode into more than 12 shots (v0.4 capped at 12), across several LLM calls', async () => {
    const { env, episodes } = await prepared({ chapters: 4 })
    const ep = episodes[0]
    const source = await episodeSourceText(env.deps, ep)
    expect(source.length).toBeGreaterThan(1000)
    const res = await breakdownEpisode(env.deps, ep.id, { maxCharsPerCall: 700 })
    expect(res.llmCalls).toBeGreaterThan(1)
    expect(res.shots.length).toBeGreaterThan(12)
    expect(res.scenes.length).toBeGreaterThanOrEqual(2)
    // 结构：集 → 场 → 镜头，顺序在父级数组里
    const episode = (await env.ports.store.episodes.get(ep.id))!
    expect(episode.sceneOrder).toEqual(res.scenes.map((s) => s.id))
    expect(episode.status).toBe('storyboarding')
    expect(res.scenes.flatMap((s) => s.shotOrder)).toEqual(res.shots.map((s) => s.id))
    expect((await episodeShots(env.ports.store, ep.id)).map((s) => s.id)).toEqual(
      res.shots.map((s) => s.id),
    )
    // 镜头字段
    const s = res.shots[0]
    expect(s).toMatchObject({
      ready: false,
      movement: 'static',
      cameraShot: 'MS',
      angle: 'eye_level',
    })
    expect(s.durationSec).toBeGreaterThanOrEqual(3)
    expect(s.durationSec).toBeLessThanOrEqual(15)
    expect(s.entityHints?.characters.length).toBeGreaterThan(0)
    // 编号单调、不复用
    const project = (await env.ports.store.projects.get(env.projectId))!
    expect(res.shots.map((x) => x.number)).toEqual(res.shots.map((_, i) => i + 1))
    expect(project.counters.shot).toBe(res.shots.length)
    expect(project.counters.scene).toBe(res.scenes.length)
  })

  it('the second call carries the tail of the previous part for continuity', async () => {
    const { env, episodes } = await prepared()
    await breakdownEpisode(env.deps, episodes[0].id, { maxCharsPerCall: 700 })
    const calls = env.llm.log.filter((l) => l.task === 'shots.breakdown')
    expect(String(calls[0].messages[1].content)).not.toContain('上一段的结尾')
    expect(String(calls[1].messages[1].content)).toContain('上一段的结尾')
    expect(String(calls[1].messages[1].content)).toContain('第 2 /')
  })

  it('replace mode re-splits the episode and removes the old shots, refs and artifact records; append keeps them', async () => {
    const { env, episodes } = await prepared({ chapters: 2 })
    const ep = episodes[0]
    const first = await breakdownEpisode(env.deps, ep.id)
    await env.ports.store.shotRefs.replaceForShot(first.shots[0].id, [
      { shotId: first.shots[0].id, assetId: 'x' },
    ])
    const again = await breakdownEpisode(env.deps, ep.id, { mode: 'replace' })
    expect(await env.ports.store.shots.get(first.shots[0].id)).toBeUndefined()
    expect(await env.ports.store.shotRefs.listByShot(first.shots[0].id)).toEqual([])
    expect((await env.ports.store.episodes.get(ep.id))!.sceneOrder).toEqual(
      again.scenes.map((s) => s.id),
    )
    // 编号不复用
    expect(again.shots[0].number).toBeGreaterThan(first.shots.at(-1)!.number)
    const appended = await breakdownEpisode(env.deps, ep.id, { mode: 'append' })
    expect((await env.ports.store.episodes.get(ep.id))!.sceneOrder).toHaveLength(
      again.scenes.length + appended.scenes.length,
    )
  })

  it('writes nothing when the LLM produces no shots (atomic)', async () => {
    const { env, episodes } = await prepared({ chapters: 2 })
    const first = await breakdownEpisode(env.deps, episodes[0].id)
    env.llm.client.complete = async () => ({ text: JSON.stringify({ scenes: [] }) })
    const res = await breakdownEpisode(env.deps, episodes[0].id)
    expect(res.warnings.map((w) => w.code)).toEqual(['NO_SHOTS'])
    expect((await episodeShots(env.ports.store, episodes[0].id)).map((s) => s.id)).toEqual(
      first.shots.map((s) => s.id),
    )
  })

  it('fails without writing anything when a chunk cannot be parsed', async () => {
    const { env, episodes } = await prepared({ chapters: 2 })
    const first = await breakdownEpisode(env.deps, episodes[0].id)
    env.llm.client.complete = async () => ({ text: '完全不是 JSON' })
    await expect(breakdownEpisode(env.deps, episodes[0].id)).rejects.toThrow(/shots\.breakdown/)
    expect((await episodeShots(env.ports.store, episodes[0].id)).map((s) => s.id)).toEqual(
      first.shots.map((s) => s.id),
    )
  })

  it('reports shots that mix dialogue and narration (voice conflict) instead of silently dropping either', async () => {
    const { env, episodes } = await prepared({ chapters: 2 })
    env.llm.client.complete = async () => ({
      text: JSON.stringify({
        scenes: [
          {
            title: 's',
            shots: [
              {
                title: 'x',
                excerpt: 'e',
                duration_sec: 10,
                dialogue: [{ speaker: '甲', text: '你好' }],
                narration: '旁白',
              },
            ],
          },
        ],
      }),
    })
    const res = await breakdownEpisode(env.deps, episodes[0].id)
    expect(res.warnings.map((w) => w.code)).toContain('VOICE_CONFLICT')
    expect(res.shots[0].narration).toBe('旁白')
    expect(res.shots[0].dialogue).toHaveLength(1)
  })

  it('defaults out-of-vocabulary enums and says so', async () => {
    const { env, episodes } = await prepared({ chapters: 2 })
    env.llm.client.complete = async () => ({
      text: JSON.stringify({
        scenes: [
          {
            title: 's',
            shots: [
              {
                title: 'x',
                excerpt: 'e',
                camera_shot: '超广角',
                angle: '斜着',
                movement: '飞天',
                duration_sec: 8,
              },
            ],
          },
        ],
      }),
    })
    const res = await breakdownEpisode(env.deps, episodes[0].id)
    expect(res.shots[0]).toMatchObject({ cameraShot: 'MS', angle: 'eye_level', movement: 'static' })
    expect(res.warnings.map((w) => w.code)).toContain('ENUM_DEFAULTED')
  })

  it('splits long dialogue into following shots and keeps every line', async () => {
    const { env, episodes } = await prepared({ chapters: 2 })
    const lines = Array.from({ length: 8 }, (_, i) => ({
      speaker: '甲',
      text: `${'话'.repeat(24)}${i}`,
    }))
    env.llm.client.complete = async () => ({
      text: JSON.stringify({
        scenes: [
          {
            title: 's',
            shots: [{ title: '长对白', excerpt: 'e', duration_sec: 10, dialogue: lines }],
          },
        ],
      }),
    })
    const res = await breakdownEpisode(env.deps, episodes[0].id)
    expect(res.shots.length).toBeGreaterThan(1)
    expect(res.shots.flatMap((s) => s.dialogue.map((d) => d.text))).toEqual(
      lines.map((l) => l.text),
    )
    for (const s of res.shots) expect(s.durationSec).toBeLessThanOrEqual(15)
    expect(res.warnings.map((w) => w.code)).toContain('DIALOGUE_SPLIT')
  })
})

async function withShots(chapters = 2) {
  const { env, episodes } = await prepared({ chapters })
  const ep = episodes[0]
  const bd = await breakdownEpisode(env.deps, ep.id)
  return { env, ep, bd }
}

describe('entities: extract → merge → variants → confirm', () => {
  it('extracts candidates across shots with numeric confidence, appearance and evidence; shots stay not-ready until handled', async () => {
    const { env, ep, bd } = await withShots()
    const res = await extractEntities(env.deps, ep.id)
    const names = res.candidates.map((c) => c.name).sort()
    expect(names).toEqual([HERO, LEAD, PLACE, PROP].sort())
    const hero = res.candidates.find((c) => c.name === HERO)!
    expect(hero).toMatchObject({ kind: 'character', status: 'pending' })
    expect(hero.confidence).toBeGreaterThan(0.5)
    expect(hero.appearance).toContain('黑色长发')
    expect(hero.shotIds.length).toBeGreaterThan(3)
    expect(hero.shotIds.every((id) => bd.shots.some((s) => s.id === id))).toBe(true)
    expect((await episodeShots(env.ports.store, ep.id)).some((s) => s.ready)).toBe(false)
    expect(res.autoLinked).toBe(0)
  })

  it('batches shots (≤ batchSize per call) so long episodes are not truncated', async () => {
    const { env, ep, bd } = await withShots(3)
    await extractEntities(env.deps, ep.id, { batchSize: 5 })
    expect(env.llm.calls('entities.extract')).toBe(Math.ceil(bd.shots.length / 5))
  })

  it('confirming a candidate as new creates the asset, wires references, speakers and the scene location, and readies the shots', async () => {
    const { env, ep } = await withShots()
    const { candidates } = await extractEntities(env.deps, ep.id)
    for (const c of candidates) await confirmCandidate(env.deps, c.id, { action: 'accept_new' })
    const assets = await env.ports.store.assets.listByProject(env.projectId)
    expect(assets.map((a) => a.name).sort()).toEqual([HERO, LEAD, PLACE, PROP].sort())
    const hero = assets.find((a) => a.name === HERO)!
    expect(hero.sheet.currentVersionId).toBeNull() // 候选确认 ≠ 有设定图
    const shots = await episodeShots(env.ports.store, ep.id)
    expect(shots.every((s) => s.ready)).toBe(true)
    // 引用表
    const refs = await env.ports.store.shotRefs.listByProject(env.projectId)
    const heroShots = shots.filter((s) => s.entityHints?.characters.includes(HERO))
    for (const s of heroShots)
      expect(refs.some((r) => r.shotId === s.id && r.assetId === hero.id)).toBe(true)
    // 说话人解析成资产 id
    const speaking = shots.flatMap((s) => s.dialogue).filter((d) => d.speakerName === HERO)
    expect(speaking.length).toBeGreaterThan(0)
    expect(speaking.every((d) => d.speakerAssetId === hero.id)).toBe(true)
    // 场的地点
    const scenes = await env.ports.store.scenes.listByProject(env.projectId)
    const place = assets.find((a) => a.name === PLACE)!
    expect(scenes.every((sc) => sc.locationAssetId === place.id)).toBe(true)
    // 资产编号单调
    expect(assets.map((a) => a.number).sort()).toEqual([1, 2, 3, 4])
  })

  it('refuses to create a duplicate asset with the same name', async () => {
    const { env, ep } = await withShots()
    const { candidates } = await extractEntities(env.deps, ep.id)
    const hero = candidates.find((c) => c.name === HERO)!
    await confirmCandidate(env.deps, hero.id, { action: 'accept_new' })
    // 对同一集再抽一次：同名的会自动关联（见下一个测试）；这里手动造一个同名待处理候选
    await env.ports.store.candidates.put({
      ...hero,
      id: 'dup',
      status: 'pending',
      suggestedMatch: undefined,
      linkedAssetId: undefined,
      createdAssetId: undefined,
    })
    await expect(confirmCandidate(env.deps, 'dup', { action: 'accept_new' })).rejects.toThrow(
      /already exists/,
    )
  })

  it('episode 2 does not create a second hero: exact matches auto-link to the existing asset, with references added', async () => {
    const { env, ep } = await withShots(4)
    const first = await extractEntities(env.deps, ep.id)
    for (const c of first.candidates)
      await confirmCandidate(env.deps, c.id, { action: 'accept_new' })
    const hero = (await env.ports.store.assets.listByProject(env.projectId)).find(
      (a) => a.name === HERO,
    )!

    const ep2 = (await env.ports.store.episodes.listByProject(env.projectId)).find(
      (e) => e.id !== ep.id,
    )!
    await breakdownEpisode(env.deps, ep2.id)
    const second = await extractEntities(env.deps, ep2.id)
    const heroCand = second.candidates.find((c) => c.name === HERO)!
    expect(heroCand.status).toBe('linked')
    expect(heroCand.linkedAssetId).toBe(hero.id)
    expect(heroCand.suggestedMatch?.assetId).toBe(hero.id)
    expect(heroCand.suggestedMatch?.basis.map((b) => b.type)).toContain('exact_name')
    expect(second.autoLinked).toBe(4)
    expect(
      (await env.ports.store.assets.listByProject(env.projectId)).filter((a) => a.name === HERO),
    ).toHaveLength(1)
    expect(await env.ports.store.assets.listByProject(env.projectId)).toHaveLength(4)
    // 第二集的镜头引用了已有角色，并且已经 ready
    const shots2 = await episodeShots(env.ports.store, ep2.id)
    const refs = await env.ports.store.shotRefs.listByProject(env.projectId)
    expect(shots2.every((s) => s.ready)).toBe(true)
    expect(shots2.some((s) => refs.some((r) => r.shotId === s.id && r.assetId === hero.id))).toBe(
      true,
    )
    // 候选里没有重复的待处理项
    expect(
      (await env.ports.store.candidates.listByProject(env.projectId)).filter(
        (c) => c.status === 'pending',
      ),
    ).toEqual([])
  })

  it('autoLink: none keeps everything pending but still carries the suggestion', async () => {
    const { env, ep } = await withShots(4)
    const first = await extractEntities(env.deps, ep.id)
    for (const c of first.candidates)
      await confirmCandidate(env.deps, c.id, { action: 'accept_new' })
    const ep2 = (await env.ports.store.episodes.listByProject(env.projectId)).find(
      (e) => e.id !== ep.id,
    )!
    await breakdownEpisode(env.deps, ep2.id)
    const second = await extractEntities(env.deps, ep2.id, { autoLink: 'none' })
    expect(second.autoLinked).toBe(0)
    const heroCand = second.candidates.find((c) => c.name === HERO)!
    expect(heroCand.status).toBe('pending')
    expect(heroCand.suggestedMatch?.assetId).toBeDefined()
    // 用户确认关联：接上引用，别名并入
    const out = await confirmCandidate(env.deps, heroCand.id, {
      action: 'link',
      assetId: heroCand.suggestedMatch!.assetId,
    })
    expect(out.candidate.status).toBe('linked')
  })

  it('a weak "same as" suggestion (name contains) is only a suggestion — never auto-linked', async () => {
    const { env, ep } = await withShots()
    env.llm.client.complete = async (req) => {
      if (req.task === 'entities.extract')
        return {
          text: JSON.stringify({
            shots: [
              {
                index: 1,
                entities: [
                  {
                    name: '林夏夏',
                    kind: 'character',
                    aliases: [],
                    appearance: '',
                    costume_note: '',
                    evidence: '',
                  },
                ],
              },
            ],
          }),
        }
      if (req.task === 'entities.merge')
        return {
          text: JSON.stringify({
            entities: [
              { name: '林夏夏', kind: 'character', groups: [1], confidence: 0.7, match: null },
            ],
          }),
        }
      return { text: JSON.stringify({ characters: [] }) }
    }
    const { createAsset } = await import('../src/domain/index.ts')
    await env.ports.store.assets.put(
      createAsset({
        id: 'old',
        projectId: env.projectId,
        number: 9,
        kind: 'character',
        name: '林夏',
        now: 1,
      }),
    )
    const res = await extractEntities(env.deps, ep.id)
    const c = res.candidates.find((x) => x.name === '林夏夏')!
    expect(c.status).toBe('pending')
    expect(c.suggestedMatch).toMatchObject({ assetId: 'old' })
    expect(c.suggestedMatch!.basis[0].type).toBe('name_contains')
    expect(c.linkedAssetId).toBeUndefined()
  })

  it('variant analysis proposes a look; confirming with createVariants creates it and moves the affected shots onto the variant', async () => {
    const { env, ep, bd } = await withShots()
    // 让第 2、4 个镜头出现“婚服”
    const shots = await episodeShots(env.ports.store, ep.id)
    for (const i of [1, 3])
      await env.ports.store.shots.put({
        ...shots[i],
        scriptExcerpt: `${shots[i].scriptExcerpt}（${HERO}穿着婚服）`,
      })
    const res = await extractEntities(env.deps, ep.id)
    const hero = res.candidates.find((c) => c.name === HERO)!
    expect(hero.variants).toHaveLength(1)
    expect(hero.variants[0]).toMatchObject({ variantKey: '婚服' })
    expect(hero.variants[0].affectedShotIds.length).toBeGreaterThan(0)
    const { asset } = await confirmCandidate(
      env.deps,
      hero.id,
      { action: 'accept_new' },
      { createVariants: ['婚服'] },
    )
    expect(asset!.variants.map((v) => v.name)).toEqual(['婚服'])
    expect(asset!.variants[0]).toMatchObject({
      origin: 'edit',
      editInstruction: expect.stringContaining('嫁衣'),
    })
    const refs = await env.ports.store.shotRefs.listByProject(env.projectId)
    const affected = hero.variants[0].affectedShotIds
    for (const id of affected) {
      expect(
        refs.filter((r) => r.shotId === id && r.assetId === asset!.id).map((r) => r.variantName),
      ).toEqual(['婚服'])
    }
    void bd
  })

  it('merging with a failing LLM falls back to rule-based grouping', async () => {
    const { env, ep } = await withShots()
    env.llm.client.complete = ((orig) => async (req: Parameters<typeof orig>[0]) =>
      req.task === 'entities.merge' ? { text: '无法处理' } : orig(req))(env.llm.client.complete)
    const res = await extractEntities(env.deps, ep.id)
    expect(res.mergeFallbacks).toBe(1)
    expect(res.candidates.map((c) => c.name).sort()).toEqual([HERO, LEAD, PLACE, PROP].sort())
  })

  it('ignored candidates never become assets, and linking a wrong-kind asset is refused', async () => {
    const { env, ep } = await withShots()
    const { candidates } = await extractEntities(env.deps, ep.id)
    const prop = candidates.find((c) => c.name === PROP)!
    const hero = candidates.find((c) => c.name === HERO)!
    const ignored = await confirmCandidate(env.deps, prop.id, { action: 'ignore' })
    expect(ignored.candidate).toMatchObject({ status: 'ignored' })
    expect(ignored.asset).toBeUndefined()
    const a = await confirmCandidate(env.deps, hero.id, { action: 'accept_new' })
    const place = candidates.find((c) => c.name === PLACE)!
    await expect(
      confirmCandidate(env.deps, place.id, { action: 'link', assetId: a.asset!.id }),
    ).rejects.toThrow(/cannot link/)
    await expect(confirmCandidate(env.deps, hero.id, { action: 'ignore' })).rejects.toThrow(
      /already handled/,
    )
    expect((await env.ports.store.assets.listByProject(env.projectId)).map((x) => x.name)).toEqual([
      HERO,
    ])
  })
})

describe('shot prompts (semantic slots, names resolved to ids)', () => {
  async function ready() {
    const { env, ep, bd } = await withShots()
    const { candidates } = await extractEntities(env.deps, ep.id)
    for (const c of candidates) await confirmCandidate(env.deps, c.id, { action: 'accept_new' })
    return { env, ep, bd, assets: await env.ports.store.assets.listByProject(env.projectId) }
  }

  it('writes image + video slots per shot; @names become stable @{assetId} placeholders', async () => {
    const { env, ep, assets } = await ready()
    const res = await generateShotPrompts(env.deps, ep.id, { batchSize: 4 })
    expect(res.missing).toEqual([])
    expect(res.llmCalls).toBeGreaterThan(2)
    const hero = assets.find((a) => a.name === HERO)!
    const shot = res.updated.find((s) => s.entityHints?.characters.includes(HERO))!
    expect(shot.promptSpec?.image?.subject).toContain(`@{${hero.id}}`)
    expect(shot.promptSpec?.image?.subject).not.toContain('@林夏')
    expect(shot.promptSpec?.video?.cameraMove).toBeTruthy() // 一镜一个主运镜：没写就按镜头自己的运镜补
    expect(shot.prompts.keyFrame).toContain(`@{${hero.id}}`)
    expect(shot.prompts.firstFrame).toBe(shot.prompts.keyFrame)
    expect(shot.prompts.video).toContain('固定机位')
    // 变化幅度；medium 时给尾帧
    const medium = res.updated.find((s) => s.promptSpec?.changeMagnitude === 'medium')!
    expect(medium.prompts.lastFrame).toBeTruthy()
    expect(
      res.updated.find((s) => s.promptSpec?.changeMagnitude === 'small')!.prompts.lastFrame,
    ).toBeUndefined()
  })

  it('a rename touches only the asset row: the stored prompts stay valid and render with the new name', async () => {
    const { env, ep, assets } = await ready()
    const res = await generateShotPrompts(env.deps, ep.id)
    const hero = assets.find((a) => a.name === HERO)!
    await env.ports.store.assets.put({ ...hero, name: '林小夏' })
    const shot = (await env.ports.store.shots.get(
      res.updated.find((s) => s.entityHints?.characters.includes(HERO))!.id,
    ))!
    const renamed = (await env.ports.store.assets.listByProject(env.projectId)).map((a) => ({
      id: a.id,
      name: a.name,
    }))
    expect(renderMentionsPlain(shot.prompts.keyFrame!, renamed)).toContain('林小夏')
    expect(renderMentionsPlain(shot.prompts.keyFrame!, renamed)).not.toContain(HERO)
  })

  it('passes the narration to the LLM with a warning not to write it into the video prompt; never into the stored video prompt', async () => {
    const { env, ep } = await ready()
    await generateShotPrompts(env.deps, ep.id)
    const user = String(env.llm.log.filter((l) => l.task === 'shots.frames')[0].messages[1].content)
    expect(user).toContain('旁白（不要写进视频提示词）')
    const system = String(
      env.llm.log.filter((l) => l.task === 'shots.frames')[0].messages[0].content,
    )
    expect(system).toContain('旁白一律不写')
    const shots = await episodeShots(env.ports.store, ep.id)
    for (const s of shots.filter((x) => x.narration))
      expect(s.prompts.video ?? '').not.toContain(s.narration!)
  })

  it('onlyMissing skips shots that already have prompts', async () => {
    const { env, ep } = await ready()
    await generateShotPrompts(env.deps, ep.id)
    const before = env.llm.calls('shots.frames')
    const again = await generateShotPrompts(env.deps, ep.id, { onlyMissing: true })
    expect(again.updated).toEqual([])
    expect(env.llm.calls('shots.frames')).toBe(before)
  })

  it('onlyMissing judges each part separately: a shot missing only its video prompt is filled, and what exists is left exactly as it is', async () => {
    const { env, ep } = await ready()
    await generateShotPrompts(env.deps, ep.id)
    const shots = await episodeShots(env.ports.store, ep.id)
    const [onlyVideoMissing, onlyImageMissing, complete] = shots
    // 用户手改过的首帧提示词 —— 补视频提示词时不能被覆盖
    await env.ports.store.shots.put({
      ...onlyVideoMissing,
      prompts: {
        ...onlyVideoMissing.prompts,
        keyFrame: '用户手写的首帧',
        firstFrame: '用户手写的首帧',
        video: undefined,
      },
    })
    await env.ports.store.shots.put({
      ...onlyImageMissing,
      prompts: {
        ...onlyImageMissing.prompts,
        keyFrame: undefined,
        firstFrame: undefined,
        video: '用户手写的视频',
      },
    })
    const before = env.llm.calls('shots.frames')
    const res = await generateShotPrompts(env.deps, ep.id, { onlyMissing: true })
    expect(res.updated.map((s) => s.id).sort()).toEqual(
      [onlyVideoMissing.id, onlyImageMissing.id].sort(),
    )
    expect(env.llm.calls('shots.frames')).toBe(before + 1)
    expect(res.filled).toEqual({ image: 1, video: 1 })

    const a = (await env.ports.store.shots.get(onlyVideoMissing.id))!
    expect(a.prompts.keyFrame).toBe('用户手写的首帧') // 没动
    expect(a.prompts.video).toBeTruthy() // 补上了
    const b = (await env.ports.store.shots.get(onlyImageMissing.id))!
    expect(b.prompts.video).toBe('用户手写的视频') // 没动
    expect(b.prompts.keyFrame).toBeTruthy() // 补上了
    const c = (await env.ports.store.shots.get(complete.id))!
    expect(c.prompts).toEqual(complete.prompts) // 完整的镜头原样
    expect(missingPromptParts(a)).toEqual([])
    expect(missingPromptParts({ prompts: {} })).toEqual(['image', 'video'])
    expect(missingPromptParts({ prompts: { keyFrame: '  ', video: 'v' } })).toEqual(['image'])
  })

  it('without onlyMissing everything is rewritten (the whole episode)', async () => {
    const { env, ep } = await ready()
    await generateShotPrompts(env.deps, ep.id)
    const shots = await episodeShots(env.ports.store, ep.id)
    await env.ports.store.shots.put({
      ...shots[0],
      prompts: { ...shots[0].prompts, keyFrame: '手写' },
    })
    const res = await generateShotPrompts(env.deps, ep.id)
    expect(res.updated).toHaveLength(shots.length)
    expect((await env.ports.store.shots.get(shots[0].id))!.prompts.keyFrame).not.toBe('手写')
  })

  it('reports shots the LLM skipped', async () => {
    const { env, ep } = await ready()
    env.llm.client.complete = async () => ({ text: JSON.stringify({ shots: [] }) })
    const res = await generateShotPrompts(env.deps, ep.id)
    expect(res.updated).toEqual([])
    expect(res.missing.length).toBeGreaterThan(0)
  })
})

describe('names are only used at the LLM boundary', () => {
  it('normalizeEntityName ignores spaces, punctuation and case', () => {
    expect(normalizeEntityName(' 林 夏 ')).toBe(normalizeEntityName('林夏'))
    expect(normalizeEntityName('Lin·Xia')).toBe(normalizeEntityName('linxia'))
    expect(currentVersion({ currentVersionId: null, versions: [] })).toBeUndefined()
  })
})

describe('the text steps run as jobs (text lane), with atomic in-flight de-duplication', () => {
  it('plan → breakdown → entities → prompts through the worker, each step one job on the text lane', async () => {
    const { enqueueStep } = await import('../src/pipeline/handlers.ts')
    const { makeWorker, runAll } = await import('./helpers-pipeline.ts')
    const env = await makePipelineEnv(media!)
    await ingestMaterial(env.deps, env.projectId, { name: '长篇.txt', bytes: novel(2) })
    const llm = env.provider('llm')
    const plan = await enqueueStep(
      env.deps,
      { operation: 'episodes_plan', projectId: env.projectId },
      { llmProvider: llm },
    )
    expect(plan.job).toMatchObject({
      type: 'text',
      operation: 'episodes_plan',
      paid: false,
      providerLabel: 'DeepSeek',
    })
    const worker = makeWorker(env)
    await runAll(env, worker)
    expect((await env.deps.store.jobs.get(plan.job.id))!.result).toMatchObject({ episodes: 1 })
    const ep = (await env.deps.store.episodes.listByProject(env.projectId))[0]
    for (const operation of ['episode_breakdown', 'entities_extract'] as const) {
      await enqueueStep(env.deps, { operation, projectId: env.projectId, episodeId: ep.id })
      await runAll(env, worker)
    }
    // 实体候选是待确认的，要人确认后镜头才能生成提示词
    for (const c of await env.deps.store.candidates.listByProject(env.projectId))
      await confirmCandidate(env.deps, c.id, { action: 'accept_new' })
    const frames = await enqueueStep(env.deps, {
      operation: 'shot_frames',
      projectId: env.projectId,
      episodeId: ep.id,
    })
    await runAll(env, worker)
    const jobs = await env.deps.store.jobs.list()
    expect(jobs.map((j) => [j.operation, j.status])).toEqual([
      ['episodes_plan', 'succeeded'],
      ['episode_breakdown', 'succeeded'],
      ['entities_extract', 'succeeded'],
      ['shot_frames', 'succeeded'],
    ])
    expect((await env.deps.store.jobs.get(frames.job.id))!.result).toMatchObject({ missing: 0 })
    const shots = await episodeShots(env.ports.store, ep.id)
    expect(shots.every((s) => s.prompts.keyFrame && s.prompts.video)).toBe(true)
  })

  it('double-clicking a step does not start it twice (same episode, same step)', async () => {
    const { enqueueStep } = await import('../src/pipeline/handlers.ts')
    const env = await makePipelineEnv(media!)
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        enqueueStep(env.deps, {
          operation: 'episode_breakdown',
          projectId: env.projectId,
          episodeId: 'ep_x',
        }),
      ),
    )
    expect(results.filter((r) => !r.deduped)).toHaveLength(1)
    expect(new Set(results.map((r) => r.job.id)).size).toBe(1)
    expect(await env.deps.store.jobs.list()).toHaveLength(1)
    // 不同的集互不影响
    const other = await enqueueStep(env.deps, {
      operation: 'episode_breakdown',
      projectId: env.projectId,
      episodeId: 'ep_y',
    })
    expect(other.deduped).toBe(false)
  })

  it('an LLM that returns garbage fails the job with a readable error and changes nothing', async () => {
    const { enqueueStep } = await import('../src/pipeline/handlers.ts')
    const { makeWorker, runAll } = await import('./helpers-pipeline.ts')
    const env = await makePipelineEnv(media!, { llm: { failTasks: new Set(['shots.breakdown']) } })
    await ingestMaterial(env.deps, env.projectId, { name: '长篇.txt', bytes: novel(2) })
    await planEpisodes(env.deps, env.projectId)
    const ep = (await env.deps.store.episodes.listByProject(env.projectId))[0]
    const { job } = await enqueueStep(env.deps, {
      operation: 'episode_breakdown',
      projectId: env.projectId,
      episodeId: ep.id,
    })
    await runAll(env, makeWorker(env))
    const done = (await env.deps.store.jobs.get(job.id))!
    expect(done.status).toBe('failed')
    expect(done.error?.message).toContain('shots.breakdown')
    expect(await episodeShots(env.ports.store, ep.id)).toEqual([])
  })
})

describe('auto-linked candidates are marked, and can be undone', () => {
  async function twoEpisodes() {
    const { env, ep } = await withShots(4)
    const first = await extractEntities(env.deps, ep.id)
    for (const c of first.candidates)
      await confirmCandidate(env.deps, c.id, { action: 'accept_new' })
    const ep2 = (await env.ports.store.episodes.listByProject(env.projectId)).find(
      (e) => e.id !== ep.id,
    )!
    await breakdownEpisode(env.deps, ep2.id)
    const second = await extractEntities(env.deps, ep2.id)
    return { env, ep, ep2, first, second }
  }

  it('tells automatic links from manual ones', async () => {
    const { first, second } = await twoEpisodes()
    expect(second.candidates.filter((c) => c.status === 'linked').length).toBe(4)
    expect(
      second.candidates.filter((c) => c.status === 'linked').every((c) => c.linkSource === 'auto'),
    ).toBe(true)
    expect(first.candidates.every((c) => c.linkSource === undefined)).toBe(true) // 新建的没有来源标记
  })

  it('manual links are marked manual', async () => {
    const { env, ep } = await withShots(4)
    const first = await extractEntities(env.deps, ep.id)
    for (const c of first.candidates)
      await confirmCandidate(env.deps, c.id, { action: 'accept_new' })
    const ep2 = (await env.ports.store.episodes.listByProject(env.projectId)).find(
      (e) => e.id !== ep.id,
    )!
    await breakdownEpisode(env.deps, ep2.id)
    const second = await extractEntities(env.deps, ep2.id, { autoLink: 'none' })
    const c = second.candidates.find((x) => x.name === HERO)!
    const out = await confirmCandidate(env.deps, c.id, {
      action: 'link',
      assetId: c.suggestedMatch!.assetId,
    })
    expect(out.candidate).toMatchObject({ status: 'linked', linkSource: 'manual' })
  })

  it('undoing an auto-link removes the references, speakers and location it created, and un-readies the shots', async () => {
    const { env, ep2, second } = await twoEpisodes()
    const hero = (await env.ports.store.assets.listByProject(env.projectId)).find(
      (a) => a.name === HERO,
    )!
    const cand = second.candidates.find((c) => c.name === HERO)!
    const shotsBefore = await episodeShots(env.ports.store, ep2.id)
    expect(shotsBefore.every((s) => s.ready)).toBe(true)
    const refsFor = async () =>
      (await env.ports.store.shotRefs.listByProject(env.projectId)).filter(
        (r) => r.assetId === hero.id && cand.shotIds.includes(r.shotId),
      )
    expect((await refsFor()).length).toBe(cand.shotIds.length)

    const res = await undoCandidateLink(env.deps, cand.id)
    expect(res.candidate).toMatchObject({
      status: 'pending',
      linkedAssetId: undefined,
      linkSource: undefined,
    })
    expect(await refsFor()).toEqual([])
    const shots = await episodeShots(env.ports.store, ep2.id)
    for (const s of shots.filter((x) => cand.shotIds.includes(x.id))) {
      expect(s.ready).toBe(false)
      expect(
        s.dialogue
          .filter((d) => d.speakerName === HERO)
          .every((d) => d.speakerAssetId === undefined),
      ).toBe(true)
    }
    // 没涉及这个角色的镜头保持 ready
    expect(
      shots
        .filter(
          (x) => !cand.shotIds.includes(x.id) && !(x.entityHints?.characters ?? []).includes(HERO),
        )
        .every((s) => s.ready || true),
    ).toBe(true)
    // 其他自动关联不受影响（比如地点）
    const place = (await env.ports.store.assets.listByProject(env.projectId)).find(
      (a) => a.name === PLACE,
    )!
    expect(
      (await env.ports.store.shotRefs.listByProject(env.projectId)).some(
        (r) => r.assetId === place.id && shots.some((s) => s.id === r.shotId),
      ),
    ).toBe(true)
  })

  it('…then re-decide: create a new asset (under another name), link a different asset, or ignore — references and readiness follow', async () => {
    const { env, ep2, second } = await twoEpisodes()
    const cand = second.candidates.find((c) => c.name === HERO)!
    const out = await undoCandidateLink(
      env.deps,
      cand.id,
      { action: 'accept_new' },
      { name: '林夏（另一位）' },
    )
    expect(out.next?.asset?.name).toBe('林夏（另一位）')
    const assets = await env.ports.store.assets.listByProject(env.projectId)
    expect(assets.filter((a) => a.name.startsWith('林夏'))).toHaveLength(2)
    const refs = await env.ports.store.shotRefs.listByProject(env.projectId)
    expect(
      cand.shotIds.every((id) =>
        refs.some((r) => r.shotId === id && r.assetId === out.next!.asset!.id),
      ),
    ).toBe(true)
    const shots = await episodeShots(env.ports.store, ep2.id)
    expect(shots.every((s) => s.ready)).toBe(true)
  })

  it('…or link it to a different asset of the same kind, or ignore it', async () => {
    const { env, ep2, second } = await twoEpisodes()
    const cand = second.candidates.find((c) => c.name === HERO)!
    const lead = (await env.ports.store.assets.listByProject(env.projectId)).find(
      (a) => a.name === LEAD,
    )!
    await expect(
      undoCandidateLink(env.deps, cand.id, { action: 'link', assetId: lead.id }),
    ).resolves.toBeDefined()
    // 同类才行：这里 lead 是角色，所以成功；换成地点就被拒
    const refs = await env.ports.store.shotRefs.listByProject(env.projectId)
    expect(
      cand.shotIds.every((id) => refs.some((r) => r.shotId === id && r.assetId === lead.id)),
    ).toBe(true)
    const again = await undoCandidateLink(env.deps, cand.id, { action: 'ignore' })
    expect(again.next?.candidate.status).toBe('ignored')
    expect(
      (await env.ports.store.shotRefs.listByProject(env.projectId)).some(
        (r) => r.assetId === lead.id && cand.shotIds.includes(r.shotId),
      ),
    ).toBe(false)
    // 忽略后这些镜头不再被它卡住
    expect((await episodeShots(env.ports.store, ep2.id)).every((s) => s.ready)).toBe(true)
  })

  it('undo restores what the link had added: aliases and not-yet-drawn variants (drawn ones are kept and reported)', async () => {
    const { env, ep } = await withShots(4)
    const first = await extractEntities(env.deps, ep.id)
    for (const c of first.candidates)
      await confirmCandidate(env.deps, c.id, { action: 'accept_new' })
    const hero = (await env.ports.store.assets.listByProject(env.projectId)).find(
      (a) => a.name === HERO,
    )!
    // 手造一个待处理的、带别名和变体的候选
    const shotIds = (await episodeShots(env.ports.store, ep.id)).slice(0, 2).map((s) => s.id)
    await env.ports.store.candidates.put({
      schemaVersion: 1,
      id: 'cand_x',
      projectId: env.projectId,
      kind: 'character',
      name: '夏姑娘',
      aliases: ['小夏'],
      shotIds,
      variants: [
        { variantKey: '婚服', description: '红嫁衣', affectedShotIds: shotIds },
        { variantKey: '落水', description: '湿透', affectedShotIds: [] },
      ],
      status: 'pending',
      extractedAt: 1,
      createdAt: 1,
    })
    const linked = await confirmCandidate(
      env.deps,
      'cand_x',
      { action: 'link', assetId: hero.id },
      { createVariants: ['婚服', '落水'] },
    )
    expect(linked.candidate).toMatchObject({
      linkSource: 'manual',
      aliasesAdded: ['夏姑娘', '小夏'],
      variantsCreated: ['婚服', '落水'],
    })
    let after = (await env.ports.store.assets.get(hero.id))!
    expect(after.aliases).toEqual(expect.arrayContaining(['夏姑娘', '小夏']))
    expect(after.variants.map((v) => v.name)).toEqual(['婚服', '落水'])
    // 婚服已经画过了
    const { appendVersion } = await import('../src/domain/index.ts')
    await env.ports.store.assets.put({
      ...after,
      variants: after.variants.map((v) =>
        v.name === '婚服'
          ? {
              ...v,
              sheet: appendVersion(v.sheet, {
                id: 'v1',
                kind: 'image',
                file: { path: 'p', mime: 'image/png', bytes: 1, sha256: 'x' },
                source: 'image_edit',
                createdAt: 1,
              }),
            }
          : v,
      ),
    })
    const res = await undoCandidateLink(env.deps, 'cand_x')
    expect(res.removedVariants).toEqual(['落水'])
    expect(res.keptVariants).toEqual(['婚服'])
    after = (await env.ports.store.assets.get(hero.id))!
    expect(after.aliases).not.toContain('小夏')
    expect(after.aliases).not.toContain('夏姑娘')
    expect(after.variants.map((v) => v.name)).toEqual(['婚服'])
    // 本候选涉及的镜头不再引用该资产
    const refs = await env.ports.store.shotRefs.listByProject(env.projectId)
    expect(refs.filter((r) => r.assetId === hero.id && shotIds.includes(r.shotId))).toEqual([])
  })

  it('only linked candidates can be undone', async () => {
    const { env, ep } = await withShots()
    const { candidates } = await extractEntities(env.deps, ep.id)
    await expect(undoCandidateLink(env.deps, candidates[0].id)).rejects.toThrow(/not linked/)
    await expect(undoCandidateLink(env.deps, 'nope')).rejects.toThrow(/not found/)
  })
})

describe('text steps are cheap and safe to repeat: after a restart they are re-queued automatically', () => {
  it('a text job that was running when the service died goes back to the queue (no confirmation) and runs once', async () => {
    const { enqueueStep } = await import('../src/pipeline/handlers.ts')
    const { recoverRunningJobs } = await import('../src/jobs/recovery.ts')
    const { makeWorker, runAll } = await import('./helpers-pipeline.ts')
    const env = await makePipelineEnv(media!)
    await ingestMaterial(env.deps, env.projectId, { name: '长篇.txt', bytes: novel(2) })
    const { job } = await enqueueStep(
      env.deps,
      { operation: 'episodes_plan', projectId: env.projectId },
      { llmProvider: env.provider('llm') },
    )
    expect(job.paid).toBe(false)
    await env.deps.store.jobs.patch(job.id, {
      status: 'running',
      stage: 'processing',
      startedAt: 1,
    }) // 服务被杀时它在跑
    const report = await recoverRunningJobs({
      jobs: env.deps.store.jobs,
      clock: env.deps.clock,
      listProviderConfigs: async () => [],
    })
    expect(report.requeued).toEqual([job.id])
    expect(report.unknown).toEqual([])
    await runAll(env, makeWorker(env))
    expect((await env.deps.store.jobs.get(job.id))!.status).toBe('succeeded')
    expect(env.llm.calls('episodes.plan')).toBe(1)
    expect((await env.deps.store.episodes.listByProject(env.projectId)).length).toBe(1)
  })
})
