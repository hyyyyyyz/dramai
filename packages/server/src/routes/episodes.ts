import {
  enqueueStep,
  hasBlockingIssues,
  preflightEpisode,
  readEpisodeTimeline,
  targetId,
} from '@dramai/core'
import type { EpisodePlan, Episode, PipelineStep, ProviderConfig, ProviderKind } from '@dramai/core'
import { allocateNumber, createEpisode, currentVersion } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import { badRequest, conflict, HttpError, notFound } from '../errors.ts'
import type { RouteRegistry } from '../handle.ts'
import { toPreflight } from '../services/preflight-dto.ts'
import { loadProjectView, toArtifactReports } from '../services/project-views.ts'
import {
  assertNotBusy,
  deleteShotsTx,
  episodeStructure,
  permutationOf,
  removeFiles,
  requireEpisode,
} from '../services/structure.ts'
import { OK, requireProject } from './common.ts'

/** 把创作者的拆分要求记到集上（空 = 清掉）。 */
function withInstructions(episode: Episode, text: string, now: number): Episode {
  const t = text.trim()
  const next: Episode = { ...episode, updatedAt: now }
  if (t) next.breakdownInstructions = t
  else delete next.breakdownInstructions
  return next
}

export function registerEpisodeRoutes(r: RouteRegistry, ctx: ServerContext): void {
  r.handle('episodes.list', async ({ params }) => {
    await requireProject(ctx, params.projectId)
    const view = await loadProjectView(ctx, params.projectId)
    return {
      items: view.episodesInOrder().map((e) => ({ ...e, progress: view.progressOf(e.id) })),
    }
  })

  r.handle('episodes.create', async ({ params, body }) => {
    const project = await requireProject(ctx, params.projectId)
    if (body.beforeEpisodeId && !project.episodeOrder.includes(body.beforeEpisodeId)) {
      throw notFound('episode', body.beforeEpisodeId)
    }
    const episode = await ctx.store.transaction(async (tx) => {
      const fresh = (await tx.projects.get(project.id))!
      const { project: counted, number } = allocateNumber(fresh, 'episode')
      const now = ctx.clock.now()
      const created: Episode = {
        ...createEpisode({
          id: ctx.ids.next('ep'),
          projectId: project.id,
          number,
          // 编号是单调发号、不复用的；没起标题就用编号，用户随时可以改。
          title: body.title?.trim() || `第 ${number} 集`,
          now,
        }),
        ...(body.summary?.trim() ? { summary: body.summary.trim() } : {}),
      }
      const order = [...counted.episodeOrder]
      const at = body.beforeEpisodeId ? order.indexOf(body.beforeEpisodeId) : -1
      if (at >= 0) order.splice(at, 0, created.id)
      else order.push(created.id)
      await tx.episodes.put(created)
      await tx.projects.put({ ...counted, episodeOrder: order, updatedAt: now })
      return created
    })
    ctx.bus.changed('episode', { projectId: project.id, ids: [episode.id], op: 'created' })
    ctx.bus.changed('project', { projectId: project.id, ids: [project.id], op: 'updated' })
    const view = await loadProjectView(ctx, project.id)
    return { ...episode, progress: view.progressOf(episode.id) }
  })

  r.handle('episodes.get', async ({ params }) => {
    const episode = await requireEpisode(ctx, params.episodeId)
    const { scenes, shots } = await episodeStructure(ctx.store, episode)
    const view = await loadProjectView(ctx, episode.projectId)
    const shotIds = new Set(shots.map((s) => s.id))
    const refs = [...view.projection.refs.values()].flat().filter((x) => shotIds.has(x.shotId))
    return { episode, scenes, shots, refs, progress: view.progressOf(episode.id) }
  })

  r.handle('episodes.update', async ({ params, body }) => {
    const cur = await requireEpisode(ctx, params.episodeId)
    const next: Episode = { ...cur, updatedAt: ctx.clock.now() }
    if (body.title !== undefined) next.title = body.title.trim()
    if (body.summary !== undefined) next.summary = body.summary ?? undefined
    if (body.breakdownInstructions !== undefined) {
      const t = (body.breakdownInstructions ?? '').trim()
      if (t) next.breakdownInstructions = t
      else delete next.breakdownInstructions
    }
    await ctx.store.episodes.put(next)
    ctx.bus.changed('episode', { projectId: next.projectId, ids: [next.id], op: 'updated' })
    return next
  })

  r.handle('episodes.delete', async ({ params }) => {
    const episode = await requireEpisode(ctx, params.episodeId)
    const { scenes, shots } = await episodeStructure(ctx.store, episode)
    await assertNotBusy(ctx, episode.projectId, {
      episodeId: episode.id,
      shotIds: shots.map((s) => s.id),
      what: `「${episode.title}」`,
    })
    const files: string[] = []
    await ctx.store.transaction(async (tx) => {
      files.push(...(await deleteShotsTx(tx, episode.projectId, shots)))
      for (const sc of scenes) await tx.scenes.delete(sc.id)
      for (const t of await tx.timelines.listByProject(episode.projectId)) {
        if (t.episodeId === episode.id) await tx.timelines.delete(t.id)
      }
      for (const key of [`cut:${episode.id}`, `subtitles:${episode.id}`]) {
        const rec = await tx.artifacts.get(episode.projectId, key)
        if (rec) files.push(rec.file.path)
        await tx.artifacts.delete(episode.projectId, key)
      }
      await tx.episodes.delete(episode.id)
      const project = (await tx.projects.get(episode.projectId))!
      await tx.projects.put({
        ...project,
        episodeOrder: project.episodeOrder.filter((id) => id !== episode.id),
        updatedAt: ctx.clock.now(),
      })
    })
    await removeFiles(ctx, episode.projectId, files)
    ctx.bus.changed('episode', { projectId: episode.projectId, ids: [episode.id], op: 'deleted' })
    ctx.bus.changed('project', { projectId: episode.projectId, op: 'updated' })
    return OK
  })

  r.handle('episodes.reorder', async ({ params, body }) => {
    const project = await requireProject(ctx, params.projectId)
    if (!permutationOf(body.order, project.episodeOrder)) {
      throw badRequest('order 必须恰好包含项目现有的全部分集（不多不少、不重复）')
    }
    const next = { ...project, episodeOrder: body.order, updatedAt: ctx.clock.now() }
    await ctx.store.projects.put(next)
    ctx.bus.changed('project', { projectId: next.id, ids: [next.id], op: 'updated' })
    return next
  })

  // --- 流水线步骤：入队后立刻返回任务 ---

  r.handle('episodes.plan', async ({ params, body }) => {
    await requireProject(ctx, params.projectId)
    const materials = await ctx.store.materials.listByProject(params.projectId)
    if (!materials.some((m) => m.kind !== 'image' && m.charCount > 0)) {
      throw conflict(
        'NO_SOURCE_MATERIAL',
        '还没有可用的文字素材：请先上传小说 / 剧本（txt、md、docx）',
      )
    }
    return step(ctx, {
      operation: 'episodes_plan',
      projectId: params.projectId,
      params: {
        ...(body.targetChars ? { targetChars: body.targetChars } : {}),
        ...(body.instructions?.trim() ? { instructions: body.instructions.trim() } : {}),
      },
    })
  })

  r.handle('episodes.breakdown', async ({ params, body }) => {
    const episode = await requireEpisode(ctx, params.episodeId)
    const mode = body.mode ?? 'replace'
    if (mode === 'replace') {
      // 整集重拆会删掉现有镜头连同它们的图片 / 视频：有成品时不静默丢，让用户明确选择。
      const { shots } = await episodeStructure(ctx.store, episode)
      const withMedia = shots.filter((s) => currentVersion(s.image) || currentVersion(s.video))
      if (withMedia.length > 0) {
        throw conflict(
          'BREAKDOWN_WOULD_DISCARD_MEDIA',
          `整集重拆会删除已有的 ${withMedia.length} 个带图片 / 视频的镜头。想保留请用 append（接在后面），或先手动删除这些镜头`,
          { shotIds: withMedia.map((s) => s.id) },
        )
      }
    }
    // 创作者的要求记在集上：传了就更新（空字符串 = 清掉），没传就沿用上次的。
    let instructions = episode.breakdownInstructions ?? ''
    if (body.instructions !== undefined) {
      instructions = body.instructions.trim()
      await ctx.store.episodes.put(withInstructions(episode, instructions, ctx.clock.now()))
      ctx.bus.changed('episode', { projectId: episode.projectId, ids: [episode.id], op: 'updated' })
    }
    return step(ctx, {
      operation: 'episode_breakdown',
      projectId: episode.projectId,
      episodeId: episode.id,
      params: { mode, ...(instructions ? { instructions } : {}) },
    })
  })

  r.handle('episodes.extractEntities', async ({ params, body }) => {
    const episode = await requireEpisode(ctx, params.episodeId)
    await requireShots(ctx, episode)
    return step(ctx, {
      operation: 'entities_extract',
      projectId: episode.projectId,
      episodeId: episode.id,
      params: body.autoLink ? { autoLink: body.autoLink } : {},
    })
  })

  r.handle('episodes.generatePrompts', async ({ params, body }) => {
    const episode = await requireEpisode(ctx, params.episodeId)
    await requireShots(ctx, episode)
    return step(ctx, {
      operation: 'shot_frames',
      projectId: episode.projectId,
      episodeId: episode.id,
      params: body.onlyMissing === undefined ? {} : { onlyMissing: body.onlyMissing },
    })
  })

  r.handle('episodes.compose', async ({ params, body }) => {
    const episode = await requireEpisode(ctx, params.episodeId)
    const settings = await ctx.settings.get()
    const subtitles = body.subtitles ?? settings.defaultSubtitles
    assertFfmpegReady(ctx, subtitles === 'burn')
    const reading = await readEpisodeTimeline(ctx.deps, episode.id)
    if (hasBlockingIssues(reading.issues)) {
      const blocking = reading.issues.filter((i) => i.severity === 'blocking')
      throw new HttpError(
        409,
        'TIMELINE_BLOCKED',
        `时间线有 ${blocking.length} 个阻断问题，先处理再合成：${blocking.map((i) => i.message).join('；')}`,
        { issues: reading.issues },
      )
    }
    const out = await enqueueStep(ctx.deps, {
      operation: 'compose',
      projectId: episode.projectId,
      episodeId: episode.id,
      params: {
        ...(subtitles ? { subtitles } : {}),
        ...(body.shortSide ? { shortSide: body.shortSide } : {}),
      },
    })
    return out
  })

  r.handle('episodes.preflight', async ({ params, body }) => {
    const episode = await requireEpisode(ctx, params.episodeId)
    const pick = async (id: string | undefined, kind: ProviderKind, field: string) => {
      if (!id) return undefined
      const cfg = await ctx.store.providers.get(id)
      if (!cfg) throw badRequest(`${field}：服务商配置不存在（${id}）`)
      if (cfg.kind !== kind)
        throw badRequest(`${field}：${cfg.label} 是 ${cfg.kind} 服务，需要 ${kind}`)
      return cfg
    }
    const plan: EpisodePlan = {
      assetSheets: await pick(body.assetSheets, 'image', 'assetSheets'),
      shotImages: await pick(body.shotImages, 'image', 'shotImages'),
      shotVideos: await pick(body.shotVideos, 'video', 'shotVideos'),
      narration: await pick(body.narration, 'tts', 'narration'),
      textModel: await pick(body.textModel, 'llm', 'textModel'),
      resolution: body.resolution,
      onlyMissing: body.onlyMissing,
      sheetLayout: body.sheetLayout,
    }
    const result = await preflightEpisode(ctx.deps, episode.id, plan, {
      confirmUnverified: body.confirmUnverified,
    })
    const settings = await ctx.settings.get()
    return {
      ...toPreflight(result.admission, result.totals, settings.cost),
      targets: result.targets.map((t) => ({
        targetId: targetId(t.target),
        target: t.target,
        providerId: t.provider.id,
      })),
      textSteps: result.textSteps.map((t) => ({
        step: t.step,
        calls: t.calls,
        chars: t.chars,
        estimate: t.estimate,
      })),
    }
  })

  r.handle('episodes.artifacts', async ({ params }) => {
    const episode = await requireEpisode(ctx, params.episodeId)
    const view = await loadProjectView(ctx, episode.projectId)
    const { shots } = await episodeStructure(ctx.store, episode)
    const keys = new Set<string>([`cut:${episode.id}`, `subtitles:${episode.id}`])
    for (const shot of shots) {
      for (const k of ['shot_image', 'shot_video', 'shot_audio']) keys.add(`${k}:${shot.id}`)
      for (const ref of view.projection.refs.get(shot.id) ?? []) {
        keys.add(`asset_sheet:${ref.assetId}`)
        if (ref.variantName) keys.add(`variant_sheet:${ref.assetId}/${ref.variantName}`)
      }
    }
    return { items: toArtifactReports(view, (k) => keys.has(k)) }
  })
}

// --- 辅助 ---

async function requireShots(ctx: ServerContext, episode: Episode): Promise<void> {
  const { shots } = await episodeStructure(ctx.store, episode)
  if (shots.length === 0) {
    throw conflict('NO_SHOTS', `「${episode.title}」还没有镜头：请先做分镜拆解`)
  }
}

/** 文本步骤要用当前选中的大模型；没有就给出可操作的提示。 */
async function llmFor(ctx: ServerContext): Promise<ProviderConfig> {
  const llm = await ctx.activeProvider('llm')
  if (!llm) {
    throw conflict(
      'NO_LLM_PROVIDER',
      '还没有选中可用的大模型服务商：请先到「设置 → 服务商」添加一个大模型（LLM）并设为当前使用',
    )
  }
  return llm
}

async function step(ctx: ServerContext, s: PipelineStep) {
  const llmProvider = await llmFor(ctx)
  return enqueueStep(ctx.deps, s, { llmProvider })
}

function assertFfmpegReady(ctx: ServerContext, needBurn: boolean): void {
  const { bins, caps, error } = ctx.ffmpeg
  if (!bins || !caps) {
    throw conflict(
      'FFMPEG_MISSING',
      error ?? '找不到 ffmpeg：合成成片需要它。请安装 ffmpeg 并放进 PATH，或设置 DRAMAI_FFMPEG',
    )
  }
  if (!caps.ok) {
    const needed = caps.missing.filter((m) => m.required)
    throw conflict(
      'FFMPEG_INCOMPATIBLE',
      `当前的 ffmpeg 缺少合成所需的能力：${needed.map((m) => `${m.reason}（${m.remedy}）`).join('；')}`,
      { missing: needed },
    )
  }
  if (needBurn && !caps.features.subtitleBurnIn) {
    const m = caps.missing.find((x) => x.feature === 'subtitleBurnIn')
    throw conflict(
      'SUBTITLE_BURN_UNAVAILABLE',
      `当前的 ffmpeg 不支持烧录字幕：${m ? `${m.reason}。${m.remedy}` : '缺少 libass'}。可改用软字幕（soft）`,
      m ? { missing: [m] } : undefined,
    )
  }
}
