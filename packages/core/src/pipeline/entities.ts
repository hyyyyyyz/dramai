import { z } from 'zod'
import { SCHEMA_VERSIONS } from '../domain/common.ts'
import { allocateNumber, createAsset } from '../domain/factories.ts'
import { emptySlot } from '../domain/media.ts'
import { decideCandidate, normalizeEntityName, suggestMatch } from '../domain/asset.ts'
import type {
  Asset,
  AssetKind,
  AssetVariant,
  CandidateDecision,
  EntityCandidate,
  MatchBasis,
  MatchSuggestion,
} from '../domain/asset.ts'
import type { Shot, ShotAssetRef } from '../domain/shot.ts'
import { orderedShotIds } from '../domain/factories.ts'
import type { Store } from '../ports/index.ts'
import type { PipelineDeps } from './deps.ts'
import { llmJson } from './deps.ts'

/**
 * 步骤 3：实体。逐镜抽取候选 → 跨镜合并（对照已登记资产库）→ 变体分析 → 人工确认。
 *
 * - 第二集遇到已有角色时**不会重复新建**：合并阶段把已登记资产库交给 LLM 对照，规则式匹配再兜一层；
 *   名字 / 别名完全一致的默认自动关联（`autoLink: 'exact'`），其余只给出“疑似同一个”的建议，等人确认。
 * - 候选确认之前，镜头不是 `ready`（不能进入生成）。
 * - 名字只出现在 LLM 边界：候选确认时才把名字解析成资产 id，写进引用表、说话人和场的地点。
 */

export interface ExtractOptions {
  /** 每次 LLM 调用最多带几个镜头，默认 8。 */
  batchSize?: number
  /** exact：名字 / 别名完全一致的自动关联到已有资产（默认）；none：全部留作待确认。 */
  autoLink?: 'exact' | 'none'
  signal?: AbortSignal
}

export interface ExtractResult {
  candidates: EntityCandidate[]
  /** 自动关联到已有资产的候选数。 */
  autoLinked: number
  llmCalls: number
  /** 合并阶段 LLM 没给出可用结果、改用规则分组的次数。 */
  mergeFallbacks: number
}

const kindSchema = z.enum(['character', 'location', 'prop', 'costume'])
const extractSchema = z.object({
  shots: z
    .array(
      z.object({
        index: z.coerce.number().int(),
        entities: z
          .array(
            z.object({
              name: z.string().min(1),
              kind: z.string().optional().default('character'),
              aliases: z.array(z.string()).optional().default([]),
              appearance: z.string().optional().default(''),
              costume_note: z.string().optional().default(''),
              evidence: z.string().optional().default(''),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
})
const mergeSchema = z.object({
  entities: z
    .array(
      z.object({
        name: z.string().min(1),
        kind: z.string().optional(),
        aliases: z.array(z.string()).optional().default([]),
        confidence: z.coerce.number().optional(),
        appearance: z.string().optional().default(''),
        evidence: z.string().optional().default(''),
        groups: z.array(z.coerce.number().int()).default([]),
        match: z
          .object({
            existing_name: z.string(),
            reason: z.string().optional().default(''),
            confidence: z.coerce.number().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .default([]),
})
const variantSchema = z.object({
  characters: z
    .array(
      z.object({
        name: z.string(),
        variants: z
          .array(
            z.object({
              variant_key: z.string().min(1),
              description: z.string().optional().default(''),
              shots: z.array(z.coerce.number().int()).default([]),
              costume: z.string().optional(),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
})

interface RawMention {
  shotIndex: number
  name: string
  kind: AssetKind
  aliases: string[]
  appearance: string
  costumeNote: string
  evidence: string
}

interface Group {
  id: number
  kind: AssetKind
  names: string[]
  shotIndexes: number[]
  appearance: string[]
  costumeNotes: Map<number, string>
  evidence: string[]
}

const asKind = (k: string | undefined): AssetKind => {
  const parsed = kindSchema.safeParse(k?.trim().toLowerCase())
  return parsed.success ? parsed.data : 'character'
}

const clamp01 = (n: number | undefined, fallback: number) =>
  n === undefined || Number.isNaN(n) ? fallback : Math.min(1, Math.max(0, n))

export async function episodeShots(store: Store, episodeId: string): Promise<Shot[]> {
  const episode = await store.episodes.get(episodeId)
  if (!episode) throw new Error(`episode not found: ${episodeId}`)
  const project = (await store.projects.get(episode.projectId))!
  const scenes = new Map((await store.scenes.listByProject(project.id)).map((s) => [s.id, s]))
  const shots = new Map((await store.shots.listByProject(project.id)).map((s) => [s.id, s]))
  const ids = orderedShotIds(
    { episodeOrder: [episode.id] },
    new Map([[episode.id, episode]]),
    scenes,
  )
  return ids.map((id) => shots.get(id)).filter((s): s is Shot => s !== undefined)
}

export async function extractEntities(
  deps: PipelineDeps,
  episodeId: string,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const episode = await deps.store.episodes.get(episodeId)
  if (!episode) throw new Error(`episode not found: ${episodeId}`)
  const projectId = episode.projectId
  const project = (await deps.store.projects.get(projectId))!
  const shots = await episodeShots(deps.store, episodeId)
  if (shots.length === 0) throw new Error(`episode ${episodeId} has no shots yet`)
  const library = await deps.store.assets.listByProject(projectId)
  let llmCalls = 0

  // --- 1. 逐镜抽取 ---
  const raw: RawMention[] = []
  const size = options.batchSize ?? 8
  for (let start = 0; start < shots.length; start += size) {
    options.signal?.throwIfAborted()
    const batch = shots.slice(start, start + size)
    llmCalls++
    const out = await llmJson(deps, {
      task: 'entities.extract',
      schema: extractSchema,
      signal: options.signal,
      messages: [
        { role: 'system', content: deps.catalog.prompts.render('entities.extract.system', {}) },
        {
          role: 'user',
          content: deps.catalog.prompts.render('entities.extract.user', {
            projectName: project.name,
            styleLabel: project.style.source === 'none' ? '未指定' : project.style.label,
            shotsBlock: batch.map((s, i) => shotBlock(s, i + 1)).join('\n\n'),
          }),
        },
      ],
    })
    for (const sh of out.shots) {
      const localIndex = sh.index
      if (localIndex < 1 || localIndex > batch.length) continue
      for (const e of sh.entities) {
        raw.push({
          shotIndex: start + localIndex,
          name: e.name.trim(),
          kind: asKind(e.kind),
          aliases: e.aliases.map((a) => a.trim()).filter(Boolean),
          appearance: e.appearance.trim(),
          costumeNote: e.costume_note.trim(),
          evidence: e.evidence.trim(),
        })
      }
    }
    // LLM 漏掉但拆分阶段写下了名字的，补上（低置信度的种子）。
    batch.forEach((s, i) => {
      const idx = start + i + 1
      const have = new Set(
        raw.filter((r) => r.shotIndex === idx).map((r) => normalizeEntityName(r.name)),
      )
      const add = (name: string | undefined, kind: AssetKind) => {
        const n = name?.trim()
        if (n && !have.has(normalizeEntityName(n))) {
          have.add(normalizeEntityName(n))
          raw.push({
            shotIndex: idx,
            name: n,
            kind,
            aliases: [],
            appearance: '',
            costumeNote: '',
            evidence: '',
          })
        }
      }
      for (const c of s.entityHints?.characters ?? []) add(c, 'character')
      add(s.entityHints?.location, 'location')
      for (const p of s.entityHints?.props ?? []) add(p, 'prop')
      for (const c of s.entityHints?.costumes ?? []) add(c, 'costume')
    })
  }

  // --- 2. 规则分组（同类 + 规范化后同名 / 别名相交）---
  const groups = groupMentions(raw)

  // --- 3. 跨镜合并，并对照资产库 ---
  let mergeFallbacks = 0
  type Entity = {
    name: string
    kind: AssetKind
    aliases: string[]
    confidence: number
    appearance: string
    evidence: string
    groups: Group[]
    match?: { name: string; reason: string; confidence?: number }
  }
  let entities: Entity[]
  if (groups.length === 0) {
    entities = []
  } else {
    try {
      llmCalls++
      const merged = await llmJson(deps, {
        task: 'entities.merge',
        schema: mergeSchema,
        signal: options.signal,
        messages: [
          { role: 'system', content: deps.catalog.prompts.render('entities.merge.system', {}) },
          {
            role: 'user',
            content: deps.catalog.prompts.render('entities.merge.user', {
              libraryBlock:
                library.length === 0
                  ? '（空）'
                  : library
                      .map(
                        (a) =>
                          `- ${a.name}（${a.kind}${a.aliases.length ? `；别名：${a.aliases.join('、')}` : ''}）${a.appearance ? `：${a.appearance}` : ''}`,
                      )
                      .join('\n'),
              groupsBlock: groups.map(groupLine).join('\n'),
            }),
          },
        ],
      })
      const claimed = new Set<number>()
      entities = []
      for (const e of merged.entities) {
        const gs = e.groups
          .filter((g) => !claimed.has(g))
          .map((g) => groups.find((x) => x.id === g))
          .filter((g): g is Group => g !== undefined)
        if (gs.length === 0) continue
        gs.forEach((g) => claimed.add(g.id))
        const kind = gs[0].kind
        entities.push({
          name: e.name.trim(),
          kind,
          aliases: [
            ...new Set(
              [...e.aliases, ...gs.flatMap((g) => g.names)]
                .map((x) => x.trim())
                .filter((x) => x && x !== e.name.trim()),
            ),
          ],
          confidence: clamp01(e.confidence, 0.6),
          appearance: e.appearance.trim() || gs.flatMap((g) => g.appearance).join('；'),
          evidence: e.evidence.trim() || gs.flatMap((g) => g.evidence)[0] || '',
          groups: gs,
          match: e.match
            ? {
                name: e.match.existing_name,
                reason: e.match.reason,
                confidence: e.match.confidence,
              }
            : undefined,
        })
      }
      // 漏掉的分组各自成为一个实体，置信度偏低。
      for (const g of groups) if (!claimed.has(g.id)) entities.push(fallbackEntity(g))
    } catch {
      mergeFallbacks++
      entities = groups.map(fallbackEntity)
    }
  }

  // --- 4. 变体分析（只对出现 ≥2 次的角色）---
  const characters = entities.filter((e) => e.kind === 'character' && shotIndexesOf(e).length >= 2)
  const variantsByName = new Map<string, EntityCandidate['variants']>()
  if (characters.length > 0) {
    try {
      llmCalls++
      const out = await llmJson(deps, {
        task: 'entities.variants',
        schema: variantSchema,
        signal: options.signal,
        messages: [
          { role: 'system', content: deps.catalog.prompts.render('entities.variants.system', {}) },
          {
            role: 'user',
            content: deps.catalog.prompts.render('entities.variants.user', {
              charactersBlock: characters
                .map((c) => {
                  const lines = shotIndexesOf(c).map((i) => {
                    const notes = c.groups
                      .map((g) => g.costumeNotes.get(i))
                      .filter(Boolean)
                      .join('；')
                    const shot = shots[i - 1]
                    return `  - 镜头 ${i}：${shot.scriptExcerpt.slice(0, 80)}${notes ? `（穿着：${notes}）` : ''}`
                  })
                  return `## ${c.name}\n外貌：${c.appearance || '（未写）'}\n${lines.join('\n')}`
                })
                .join('\n\n'),
            }),
          },
        ],
      })
      for (const ch of out.characters) {
        variantsByName.set(
          normalizeEntityName(ch.name),
          ch.variants
            .filter((v) => v.variant_key.trim() && !v.variant_key.includes('/'))
            .map((v) => ({
              variantKey: v.variant_key.trim(),
              description: v.costume
                ? `${v.description.trim()}（服装：${v.costume}）`
                : v.description.trim(),
              affectedShotIds: v.shots
                .filter((i) => i >= 1 && i <= shots.length)
                .map((i) => shots[i - 1].id),
            })),
        )
      }
    } catch {
      // 变体分析是增强项：失败不影响候选本身。
    }
  }

  // --- 5. 写候选（含关联建议），必要时自动关联 ---
  const now = deps.clock.now()
  const out: EntityCandidate[] = []
  let autoLinked = 0
  await deps.store.transaction(async (tx) => {
    const pendingNow = (await tx.candidates.listByProject(projectId)).filter(
      (c) => c.status === 'pending',
    )
    for (const e of entities) {
      const shotIds = shotIndexesOf(e).map((i) => shots[i - 1].id)
      const suggestion = combineSuggestions(e, library)
      // 已有同名的待处理候选：合并进去，不重复建。
      const dup = pendingNow.find(
        (c) => c.kind === e.kind && normalizeEntityName(c.name) === normalizeEntityName(e.name),
      )
      if (dup) {
        const merged: EntityCandidate = {
          ...dup,
          shotIds: [...new Set([...dup.shotIds, ...shotIds])],
          aliases: [...new Set([...dup.aliases, ...e.aliases])],
          suggestedMatch: dup.suggestedMatch ?? suggestion,
        }
        await tx.candidates.put(merged)
        out.push(merged)
        continue
      }
      let cand: EntityCandidate = {
        schemaVersion: SCHEMA_VERSIONS.candidate,
        id: deps.ids.next('cand'),
        projectId,
        kind: e.kind,
        name: e.name,
        aliases: e.aliases,
        confidence: e.confidence,
        appearance: e.appearance || undefined,
        evidence: e.evidence || undefined,
        shotIds,
        variants: variantsByName.get(normalizeEntityName(e.name)) ?? [],
        status: 'pending',
        suggestedMatch: suggestion,
        extractedAt: now,
        createdAt: now,
      }
      const exact =
        suggestion?.basis.some((b) => b.type === 'exact_name' || b.type === 'alias') &&
        suggestion.score >= 0.9
      if (options.autoLink !== 'none' && exact && suggestion) {
        cand = decideCandidate(cand, { action: 'link', assetId: suggestion.assetId }, now, {
          linkSource: 'auto',
        })
        autoLinked++
      }
      await tx.candidates.put(cand)
      out.push(cand)
    }
  })
  // 自动关联的要立刻落引用；然后刷新镜头的 ready。
  for (const c of out.filter((x) => x.status === 'linked')) {
    await applyCandidateToShots(deps, c, { assetId: c.linkedAssetId! })
  }
  await refreshShotReadiness(
    deps,
    projectId,
    shots.map((s) => s.id),
  )
  return { candidates: out, autoLinked, llmCalls, mergeFallbacks }
}

function shotBlock(s: Shot, index: number): string {
  const dialogue = s.dialogue.map((d) => `${d.speakerName ?? '?'}：${d.text}`).join(' / ')
  return [
    `## 镜头 ${index}《${s.title}》`,
    `原文：${s.scriptExcerpt}`,
    s.actionBeats.length ? `动作：${s.actionBeats.join(' → ')}` : '',
    dialogue ? `对白：${dialogue}` : '',
    s.narration ? `旁白：${s.narration}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function groupMentions(raw: RawMention[]): Group[] {
  const groups: Group[] = []
  for (const m of raw) {
    const keys = [m.name, ...m.aliases].map(normalizeEntityName).filter(Boolean)
    let g = groups.find(
      (x) => x.kind === m.kind && x.names.some((n) => keys.includes(normalizeEntityName(n))),
    )
    if (!g) {
      g = {
        id: groups.length + 1,
        kind: m.kind,
        names: [],
        shotIndexes: [],
        appearance: [],
        costumeNotes: new Map(),
        evidence: [],
      }
      groups.push(g)
    }
    for (const n of [m.name, ...m.aliases])
      if (!g.names.some((x) => normalizeEntityName(x) === normalizeEntityName(n))) g.names.push(n)
    if (!g.shotIndexes.includes(m.shotIndex)) g.shotIndexes.push(m.shotIndex)
    if (m.appearance && !g.appearance.includes(m.appearance)) g.appearance.push(m.appearance)
    if (m.costumeNote) g.costumeNotes.set(m.shotIndex, m.costumeNote)
    if (m.evidence) g.evidence.push(m.evidence)
  }
  return groups
}

function groupLine(g: Group): string {
  return `${g.id} · ${g.kind} · ${g.names.join(' / ')} · 镜头 ${g.shotIndexes.join(',')} · ${g.appearance.join('；') || '（无描述）'}`
}

function fallbackEntity(g: Group) {
  return {
    name: g.names[0],
    kind: g.kind,
    aliases: g.names.slice(1),
    confidence: g.shotIndexes.length >= 2 ? 0.6 : 0.45,
    appearance: g.appearance.join('；'),
    evidence: g.evidence[0] ?? '',
    groups: [g],
    match: undefined as { name: string; reason: string; confidence?: number } | undefined,
  }
}

function shotIndexesOf(e: { groups: Group[] }): number[] {
  return [...new Set(e.groups.flatMap((g) => g.shotIndexes))].sort((a, b) => a - b)
}

/** LLM 对照结果 + 规则匹配，合成一条建议。 */
function combineSuggestions(
  e: {
    name: string
    kind: AssetKind
    aliases: string[]
    match?: { name: string; reason: string; confidence?: number }
  },
  library: readonly Asset[],
): MatchSuggestion | undefined {
  const rule = suggestMatch({ kind: e.kind, name: e.name, aliases: e.aliases }, library)
  let llm: MatchSuggestion | undefined
  if (e.match) {
    const target = library.find(
      (a) =>
        a.kind === e.kind &&
        [a.name, ...a.aliases].some(
          (n) => normalizeEntityName(n) === normalizeEntityName(e.match!.name),
        ),
    )
    if (target) {
      llm = {
        assetId: target.id,
        score: clamp01(e.match.confidence, 0.7),
        basis: [{ type: 'llm', note: e.match.reason || undefined }],
      }
    }
  }
  if (rule && llm && rule.assetId === llm.assetId) {
    return {
      assetId: rule.assetId,
      score: Math.max(rule.score, llm.score),
      basis: [...rule.basis, ...llm.basis],
    }
  }
  // 两者不一致：规则的完全匹配更可靠；否则取分高的。
  if (rule && llm) return rule.score >= llm.score ? rule : llm
  return rule ?? llm
}

// === 确认候选 ===

export interface ConfirmOptions {
  /** accept_new / link 时要同时创建的衍生形态（候选里 `variantKey` 的子集）。默认不创建。 */
  createVariants?: string[]
  /** accept_new 时覆盖资产名。 */
  name?: string
}

export async function confirmCandidate(
  deps: PipelineDeps,
  candidateId: string,
  decision: { action: 'accept_new' } | { action: 'link'; assetId: string } | { action: 'ignore' },
  options: ConfirmOptions = {},
): Promise<{ candidate: EntityCandidate; asset?: Asset }> {
  const cand = await deps.store.candidates.get(candidateId)
  if (!cand) throw new Error(`candidate not found: ${candidateId}`)
  const now = deps.clock.now()
  let resolved: CandidateDecision
  let asset: Asset | undefined

  if (decision.action === 'ignore') {
    resolved = { action: 'ignore' }
  } else if (decision.action === 'link') {
    const target = await deps.store.assets.get(decision.assetId)
    if (!target || target.deletedAt || target.projectId !== cand.projectId) {
      throw new Error(`asset not found: ${decision.assetId}`)
    }
    if (target.kind !== cand.kind)
      throw new Error(`cannot link a ${cand.kind} candidate to a ${target.kind} asset`)
    resolved = { action: 'link', assetId: target.id }
  } else {
    const name = (options.name ?? cand.name).trim()
    const dupe = (await deps.store.assets.listByProject(cand.projectId)).find(
      (a) => a.kind === cand.kind && normalizeEntityName(a.name) === normalizeEntityName(name),
    )
    if (dupe)
      throw new Error(
        `an asset named "${name}" already exists; link to it instead of creating a duplicate`,
      )
    resolved = { action: 'accept_new', createdAssetId: deps.ids.next('asset') }
  }
  let decided = decideCandidate(cand, resolved, now, { linkSource: 'manual' })

  await deps.store.transaction(async (tx) => {
    if (resolved.action === 'accept_new') {
      const project = (await tx.projects.get(cand.projectId))!
      const alloc = allocateNumber(project, 'asset')
      await tx.projects.put(alloc.project)
      asset = {
        ...createAsset({
          id: resolved.createdAssetId,
          projectId: cand.projectId,
          number: alloc.number,
          kind: cand.kind,
          name: (options.name ?? cand.name).trim(),
          now,
        }),
        aliases: cand.aliases.filter((a) => a !== (options.name ?? cand.name).trim()),
        appearance: cand.appearance,
        sheet: emptySlot(),
      }
    } else if (resolved.action === 'link') {
      const target = (await tx.assets.get(resolved.assetId))!
      const known = new Set([target.name, ...target.aliases].map(normalizeEntityName))
      const extra = [cand.name, ...cand.aliases].filter((n) => !known.has(normalizeEntityName(n)))
      asset = { ...target, aliases: [...target.aliases, ...extra], updatedAt: now }
      decided = { ...decided, aliasesAdded: extra }
    }
    if (asset) {
      // 衍生形态：只创建被选中的、且该角色上还没有的。
      const want = new Set(options.createVariants ?? [])
      const made: AssetVariant[] = []
      for (const v of cand.variants) {
        if (!want.has(v.variantKey) || asset.kind !== 'character') continue
        if (asset.variants.some((x) => x.name === v.variantKey)) continue
        made.push({
          name: v.variantKey,
          description: v.description,
          origin: 'edit',
          editInstruction: v.description,
          sheet: emptySlot(),
        })
      }
      if (made.length > 0) {
        asset = { ...asset, variants: [...asset.variants, ...made] }
        if (resolved.action === 'link')
          decided = { ...decided, variantsCreated: made.map((v) => v.name) }
      }
      await tx.assets.put(asset)
    }
    await tx.candidates.put(decided)
  })

  if (asset) {
    const variantShots = new Map<string, string>() // shotId → variantName
    for (const v of cand.variants) {
      if ((options.createVariants ?? []).includes(v.variantKey)) {
        for (const sid of v.affectedShotIds) variantShots.set(sid, v.variantKey)
      }
    }
    await applyCandidateToShots(deps, decided, { assetId: asset.id, variantShots })
  }
  await refreshShotReadiness(deps, cand.projectId, cand.shotIds)
  deps.events?.emit({ type: 'project.changed', projectId: cand.projectId })
  return { candidate: decided, asset }
}

/** 把候选对应的镜头接到资产上：引用表、说话人、场的地点。 */
async function applyCandidateToShots(
  deps: PipelineDeps,
  cand: EntityCandidate,
  target: { assetId: string; variantShots?: Map<string, string> },
): Promise<void> {
  const asset = await deps.store.assets.get(target.assetId)
  if (!asset) return
  const names = new Set(
    [asset.name, ...asset.aliases, cand.name, ...cand.aliases].map(normalizeEntityName),
  )
  await deps.store.transaction(async (tx) => {
    for (const shotId of cand.shotIds) {
      const shot = await tx.shots.get(shotId)
      if (!shot) continue
      const refs = await tx.shotRefs.listByShot(shotId)
      const variantName = target.variantShots?.get(shotId)
      const withoutBase = variantName
        ? refs.filter((r) => !(r.assetId === asset.id && !r.variantName))
        : refs
      const exists = withoutBase.some(
        (r) => r.assetId === asset.id && r.variantName === variantName,
      )
      const next: ShotAssetRef[] = exists
        ? withoutBase
        : [...withoutBase, { shotId, assetId: asset.id, variantName }]
      await tx.shotRefs.replaceForShot(shotId, next)

      if (asset.kind === 'character') {
        let changed = false
        const dialogue = shot.dialogue.map((l) => {
          if (!l.speakerAssetId && l.speakerName && names.has(normalizeEntityName(l.speakerName))) {
            changed = true
            return { ...l, speakerAssetId: asset.id }
          }
          return l
        })
        if (changed) await tx.shots.put({ ...shot, dialogue, updatedAt: deps.clock.now() })
      }
      if (asset.kind === 'location') {
        const scene = await tx.scenes.get(shot.sceneId)
        if (
          scene &&
          !scene.locationAssetId &&
          scene.locationHint &&
          names.has(normalizeEntityName(scene.locationHint))
        ) {
          await tx.scenes.put({ ...scene, locationAssetId: asset.id, updatedAt: deps.clock.now() })
        }
      }
    }
  })
}

/** 镜头的 `ready`：它涉及的候选都处理完了（没有待处理的）。 */
export async function refreshShotReadiness(
  deps: Pick<PipelineDeps, 'store' | 'clock'>,
  projectId: string,
  shotIds?: readonly string[],
): Promise<void> {
  const candidates = await deps.store.candidates.listByProject(projectId)
  const blocked = new Set<string>()
  const touched = new Set<string>()
  for (const c of candidates) {
    for (const id of c.shotIds) {
      touched.add(id)
      if (c.status === 'pending') blocked.add(id)
    }
  }
  const scope = shotIds ? new Set(shotIds) : undefined
  for (const shot of await deps.store.shots.listByProject(projectId)) {
    if (scope && !scope.has(shot.id)) continue
    // 抽取过的镜头（scope）没有待处理候选即 ready；否则只更新被候选触及的镜头。
    const ready = scope || touched.has(shot.id) ? !blocked.has(shot.id) : shot.ready
    if (ready !== shot.ready)
      await deps.store.shots.put({ ...shot, ready, updatedAt: deps.clock.now() })
  }
}

export type { MatchBasis }

export interface UndoLinkResult {
  candidate: EntityCandidate
  /** 撤销时移除的衍生形态（还没有设定图的）。 */
  removedVariants: string[]
  /** 有设定图而保留下来的衍生形态——需要用户自己处理。 */
  keptVariants: string[]
  /** 接着应用的新决定的结果（如果传了 `then`）。 */
  next?: { candidate: EntityCandidate; asset?: Asset }
}

/**
 * 撤销一次“关联到已有资产”（自动的或手动的）：
 * - 引用表里本候选涉及的镜头到该资产的引用去掉；说话人、场的地点里由它解析出来的也清掉；
 * - 关联时并入资产的别名还回去；关联时创建的衍生形态——还没有设定图的移除，有的保留并报告；
 * - 候选回到 pending，涉及的镜头不再 ready（要重新处理候选）。
 * 传 `then` 可以紧接着应用新的决定：新建资产（同名要用 `options.name` 改个名）、关联到别的资产、或忽略。
 */
export async function undoCandidateLink(
  deps: PipelineDeps,
  candidateId: string,
  then?: Parameters<typeof confirmCandidate>[2],
  options: ConfirmOptions = {},
): Promise<UndoLinkResult> {
  const cand = await deps.store.candidates.get(candidateId)
  if (!cand) throw new Error(`candidate not found: ${candidateId}`)
  if (cand.status !== 'linked' || !cand.linkedAssetId) {
    throw new Error(`candidate ${candidateId} is not linked (${cand.status})`)
  }
  const assetId = cand.linkedAssetId
  const removedVariants: string[] = []
  const keptVariants: string[] = []
  await deps.store.transaction(async (tx) => {
    const now = deps.clock.now()
    const asset = await tx.assets.get(assetId)
    const names = new Set(
      [cand.name, ...cand.aliases, ...(asset ? [asset.name, ...asset.aliases] : [])].map(
        normalizeEntityName,
      ),
    )
    for (const shotId of cand.shotIds) {
      const shot = await tx.shots.get(shotId)
      if (!shot) continue
      const refs = await tx.shotRefs.listByShot(shotId)
      const left = refs.filter((r) => r.assetId !== assetId)
      if (left.length !== refs.length) await tx.shotRefs.replaceForShot(shotId, left)
      let changed = false
      const dialogue = shot.dialogue.map((l) => {
        if (
          l.speakerAssetId === assetId &&
          l.speakerName &&
          names.has(normalizeEntityName(l.speakerName))
        ) {
          changed = true
          return { ...l, speakerAssetId: undefined }
        }
        return l
      })
      if (changed) await tx.shots.put({ ...shot, dialogue, updatedAt: now })
      const scene = await tx.scenes.get(shot.sceneId)
      if (
        scene?.locationAssetId === assetId &&
        scene.locationHint &&
        names.has(normalizeEntityName(scene.locationHint))
      ) {
        await tx.scenes.put({ ...scene, locationAssetId: undefined, updatedAt: now })
      }
    }
    if (asset) {
      const gone = new Set((cand.aliasesAdded ?? []).map(normalizeEntityName))
      const variants = asset.variants.filter((v) => {
        if (!(cand.variantsCreated ?? []).includes(v.name)) return true
        if (v.sheet.versions.length === 0) {
          removedVariants.push(v.name)
          return false
        }
        keptVariants.push(v.name)
        return true
      })
      await tx.assets.put({
        ...asset,
        aliases: asset.aliases.filter((a) => !gone.has(normalizeEntityName(a))),
        variants,
        updatedAt: now,
      })
    }
    await tx.candidates.put({
      ...cand,
      status: 'pending',
      linkedAssetId: undefined,
      linkSource: undefined,
      aliasesAdded: undefined,
      variantsCreated: undefined,
      handledAt: undefined,
    })
  })
  await refreshShotReadiness(deps, cand.projectId, cand.shotIds)
  deps.events?.emit({ type: 'project.changed', projectId: cand.projectId })
  const reopened = (await deps.store.candidates.get(candidateId))!
  const next = then ? await confirmCandidate(deps, candidateId, then, options) : undefined
  return { candidate: next?.candidate ?? reopened, removedVariants, keptVariants, next }
}
