import { createProject, NO_STYLE, isInFlight } from '@dramai/core'
import type { Project, StyleSnapshot } from '@dramai/core'
import type { StyleChoice } from '@dramai/api'
import type { ServerContext } from '../context.ts'
import { badRequest, conflict, HttpError, notFound } from '../errors.ts'
import type { RouteRegistry } from '../handle.ts'
import { loadProjectView, toArtifactReports, toProjectListItem } from '../services/project-views.ts'
import { OK, requireProject } from './common.ts'
import { registerEpisodeRoutes } from './episodes.ts'
import { registerMaterialRoutes } from './materials.ts'
import { registerSceneRoutes } from './scenes.ts'
import { registerShotRoutes } from './shots.ts'

/** 路由组 A：项目 / 素材 / 集 / 场 / 镜头。 */
export function registerProjectRoutes(r: RouteRegistry, ctx: ServerContext): void {
  registerProjectCrud(r, ctx)
  registerMaterialRoutes(r, ctx)
  registerEpisodeRoutes(r, ctx)
  registerSceneRoutes(r, ctx)
  registerShotRoutes(r, ctx)
}

/** 把用户选的画风展开成快照写进项目（之后模板更新不回写旧项目）。 */
function resolveStyle(ctx: ServerContext, choice: StyleChoice): StyleSnapshot {
  const now = ctx.clock.now()
  switch (choice.source) {
    case 'none':
      return NO_STYLE(now)
    case 'template': {
      const preset = ctx.catalog.styles.get(choice.templateId)
      if (!preset) {
        throw new HttpError(
          400,
          'UNKNOWN_STYLE_TEMPLATE',
          `没有这个画风模板：${choice.templateId}`,
          {
            templateId: choice.templateId,
          },
        )
      }
      return {
        source: 'template',
        templateId: preset.id,
        label: preset.label,
        description: preset.description,
        imageKeywords: preset.imageKeywords,
        expandedAt: now,
      }
    }
    case 'custom':
      return {
        source: 'custom',
        label: '自定义',
        description: choice.description,
        imageKeywords: choice.imageKeywords?.trim() || choice.description,
        expandedAt: now,
      }
  }
}

async function checkNarrationVoice(
  ctx: ServerContext,
  voice: { providerConfigId: string } | null | undefined,
): Promise<void> {
  if (!voice) return
  const cfg = await ctx.store.providers.get(voice.providerConfigId)
  if (!cfg) throw badRequest(`旁白配音的服务商配置不存在：${voice.providerConfigId}`)
  if (cfg.kind !== 'tts') throw badRequest(`${cfg.label} 不是语音合成（tts）服务，不能用来配旁白`)
}

function registerProjectCrud(r: RouteRegistry, ctx: ServerContext): void {
  r.handle('projects.list', async ({ query }) => {
    const projects = await ctx.store.projects.list({ includeDeleted: query?.includeDeleted })
    return { items: await Promise.all(projects.map((p) => toProjectListItem(ctx, p))) }
  })

  r.handle('projects.create', async ({ body }) => {
    await checkNarrationVoice(ctx, body.narrationVoice)
    const now = ctx.clock.now()
    const project = createProject({
      id: ctx.ids.next('proj'),
      name: body.name.trim(),
      summary: body.summary,
      aspectRatio: body.aspectRatio,
      narrationDelivery: body.narrationDelivery,
      style: body.style ? resolveStyle(ctx, body.style) : undefined,
      now,
    })
    const created: Project = body.narrationVoice
      ? { ...project, narrationVoice: body.narrationVoice }
      : project
    await ctx.store.projects.put(created)
    ctx.bus.changed('project', { projectId: created.id, ids: [created.id], op: 'created' })
    return created
  })

  r.handle('projects.get', ({ params }) => requireProject(ctx, params.projectId))

  r.handle('projects.update', async ({ params, body }) => {
    const cur = await requireProject(ctx, params.projectId)
    await checkNarrationVoice(ctx, body.narrationVoice)
    const next: Project = { ...cur, updatedAt: ctx.clock.now() }
    if (body.name !== undefined) next.name = body.name.trim()
    if (body.summary !== undefined) next.summary = body.summary ?? undefined
    if (body.aspectRatio !== undefined) next.aspectRatio = body.aspectRatio
    if (body.style !== undefined) next.style = resolveStyle(ctx, body.style)
    if (body.narrationDelivery !== undefined) next.narrationDelivery = body.narrationDelivery
    if (body.narrationVoice !== undefined) {
      if (body.narrationVoice === null) delete next.narrationVoice
      else next.narrationVoice = body.narrationVoice
    }
    // 画幅、画风、旁白音色改了，不用在这里处理：已有产物会按依据变化自动判为过期。
    await ctx.store.projects.put(next)
    ctx.bus.changed('project', { projectId: next.id, ids: [next.id], op: 'updated' })
    return next
  })

  r.handle('projects.delete', async ({ params }) => {
    const cur = await requireProject(ctx, params.projectId)
    await assertNoRunningJobs(ctx, cur.id)
    const now = ctx.clock.now()
    await ctx.store.projects.put({ ...cur, deletedAt: now, updatedAt: now })
    ctx.bus.changed('project', { projectId: cur.id, ids: [cur.id], op: 'deleted' })
    return OK
  })

  r.handle('projects.restore', async ({ params }) => {
    const cur = await ctx.store.projects.get(params.projectId)
    if (!cur) throw notFound('项目', params.projectId)
    if (cur.deletedAt === undefined) return cur
    const next: Project = { ...cur, updatedAt: ctx.clock.now() }
    delete next.deletedAt
    await ctx.store.projects.put(next)
    ctx.bus.changed('project', { projectId: next.id, ids: [next.id], op: 'created' })
    return next
  })

  r.handle('projects.purge', async ({ params }) => {
    const cur = await ctx.store.projects.get(params.projectId)
    if (!cur) throw notFound('项目', params.projectId)
    // 彻底删除不可恢复：必须先进回收站（两步确认的服务端兜底）。
    if (cur.deletedAt === undefined) {
      throw conflict('NOT_IN_TRASH', '项目还没有删除：请先删除（进入回收站），再彻底删除')
    }
    await assertNoRunningJobs(ctx, cur.id)
    await ctx.store.purgeProject(cur.id)
    await ctx.files.removeProject(cur.id)
    ctx.bus.changed('project', { projectId: cur.id, ids: [cur.id], op: 'deleted' })
    return OK
  })

  r.handle('projects.artifacts', async ({ params }) => {
    await requireProject(ctx, params.projectId)
    return { items: toArtifactReports(await loadProjectView(ctx, params.projectId)) }
  })
}

async function assertNoRunningJobs(ctx: ServerContext, projectId: string): Promise<void> {
  const busy = (await ctx.store.jobs.list({ projectId })).filter((j) => isInFlight(j.status))
  if (busy.length > 0) {
    throw conflict('BUSY', `项目还有 ${busy.length} 个任务在排队或运行，请等它们结束或先取消`, {
      jobIds: busy.map((j) => j.id),
    })
  }
}
