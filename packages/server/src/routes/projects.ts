import { createHash } from 'node:crypto'
import {
  createProject,
  expandStyle,
  keepAsIs,
  loadProjection,
  localizeStyleSnapshot,
  NO_STYLE,
  isInFlight,
} from '@dramai/core'
import type { Locale, Project, StyleSnapshot } from '@dramai/core'
import type { StyleChoice } from '@dramai/api'
import type { ServerContext } from '../context.ts'
import { badRequest, conflict, HttpError, notFound } from '../errors.ts'
import { localeOf } from '../locale.ts'
import { formFile, formString } from '../handle.ts'
import { sniffImage } from '../services/sheets.ts'
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
    case 'reference_image':
      // 参考图要先上传（projects.setStyleReference）；创建项目时还没有图。
      throw missingStyleReference()
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

function missingStyleReference(): HttpError {
  return new HttpError(
    400,
    'STYLE_REFERENCE_MISSING',
    '参考图风格需要先上传一张图片：先创建项目，再调用 projects.setStyleReference 上传。',
  )
}

/** 项目里存的风格快照带着创建时的中文名称：展示时把内置的那部分换成请求的语言，用户写的原样返回。 */
function localizeProject<T extends { style: StyleSnapshot }>(
  ctx: ServerContext,
  project: T,
  locale: Locale,
): T {
  return { ...project, style: localizeStyleSnapshot(project.style, ctx.catalog.styles, locale) }
}

/** 删掉不再使用的风格参考图（切换到别的风格，或换了一张新的）。 */
async function dropStyleReference(
  ctx: ServerContext,
  project: Project,
  keepPath?: string,
): Promise<void> {
  const path = project.style.referenceFile?.path
  if (path && path !== keepPath) await ctx.files.remove(project.id, path).catch(() => {})
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
  r.handle('projects.list', async ({ query, c }) => {
    const locale = await localeOf(ctx, c)
    const projects = await ctx.store.projects.list({ includeDeleted: query?.includeDeleted })
    const items = await Promise.all(projects.map((p) => toProjectListItem(ctx, p)))
    return { items: items.map((p) => localizeProject(ctx, p, locale)) }
  })

  r.handle('projects.create', async ({ body, c }) => {
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
    return localizeProject(ctx, created, await localeOf(ctx, c))
  })

  r.handle('projects.get', async ({ params, c }) =>
    localizeProject(ctx, await requireProject(ctx, params.projectId), await localeOf(ctx, c)),
  )

  r.handle('projects.update', async ({ params, body, c }) => {
    const cur = await requireProject(ctx, params.projectId)
    await checkNarrationVoice(ctx, body.narrationVoice)
    const next: Project = { ...cur, updatedAt: ctx.clock.now() }
    if (body.name !== undefined) next.name = body.name.trim()
    if (body.summary !== undefined) next.summary = body.summary ?? undefined
    if (body.aspectRatio !== undefined) next.aspectRatio = body.aspectRatio
    if (body.style?.source === 'reference_image') {
      // 只允许对已经上传过参考图的项目改名称；换图用 projects.setStyleReference。
      if (cur.style.source !== 'reference_image' || !cur.style.referenceFile) {
        throw missingStyleReference()
      }
      next.style = { ...cur.style, label: body.style.label ?? cur.style.label }
    } else if (body.style !== undefined) {
      next.style = resolveStyle(ctx, body.style)
    }
    if (body.narrationDelivery !== undefined) next.narrationDelivery = body.narrationDelivery
    if (body.narrationVoice !== undefined) {
      if (body.narrationVoice === null) delete next.narrationVoice
      else next.narrationVoice = body.narrationVoice
    }
    // 画幅、画风、旁白音色改了，不用在这里处理：已有产物会按依据变化自动判为过期。
    await ctx.store.projects.put(next)
    ctx.bus.changed('project', { projectId: next.id, ids: [next.id], op: 'updated' })
    // 换到别的风格了：之前上传的参考图不再需要。
    if (body.style && body.style.source !== 'reference_image') await dropStyleReference(ctx, cur)
    return localizeProject(ctx, next, await localeOf(ctx, c))
  })

  /**
   * 上传 / 替换参考图风格（multipart：`file`，可选 `label`）。图片存在项目文件夹的 `style/` 下，
   * 读取用 `project.style.referenceFile.path` + 文件接口；生成图片时它作为画风参考图传给模型。
   * 换图会让用这张参考图风格生成的图判为过期（依据里带着图片内容的哈希）。
   */
  r.handle('projects.setStyleReference', async ({ params, form, c }) => {
    const cur = await requireProject(ctx, params.projectId)
    const file = await formFile(form, 'file')
    const img = sniffImage(file.bytes)
    const label = formString(form, 'label')?.trim() || undefined
    if (label && label.length > 40) throw badRequest('名称不能超过 40 个字符')
    const sha = createHash('sha256').update(file.bytes).digest('hex')
    const path = `style/reference-${sha.slice(0, 12)}.${img.ext}`
    const info = await ctx.files.put(cur.id, path, file.bytes)
    const referenceFile = { path, mime: img.mime, bytes: info.bytes, sha256: info.sha256 }
    const keepLabel = cur.style.source === 'reference_image' ? cur.style.label : undefined
    const next: Project = {
      ...cur,
      style: expandStyle(
        ctx.catalog.styles,
        { source: 'reference_image', referenceFile, label: label ?? keepLabel },
        ctx.clock.now(),
      ),
      updatedAt: ctx.clock.now(),
    }
    await ctx.store.projects.put(next)
    await dropStyleReference(ctx, cur, path)
    ctx.bus.changed('project', { projectId: next.id, ids: [next.id], op: 'updated' })
    return localizeProject(ctx, next, await localeOf(ctx, c))
  })

  r.handle('projects.delete', async ({ params }) => {
    const cur = await requireProject(ctx, params.projectId)
    await assertNoRunningJobs(ctx, cur.id)
    const now = ctx.clock.now()
    await ctx.store.projects.put({ ...cur, deletedAt: now, updatedAt: now })
    ctx.bus.changed('project', { projectId: cur.id, ids: [cur.id], op: 'deleted' })
    return OK
  })

  r.handle('projects.restore', async ({ params, c }) => {
    const cur = await ctx.store.projects.get(params.projectId)
    if (!cur) throw notFound('project', params.projectId)
    if (cur.deletedAt === undefined) return localizeProject(ctx, cur, await localeOf(ctx, c))
    const next: Project = { ...cur, updatedAt: ctx.clock.now() }
    delete next.deletedAt
    await ctx.store.projects.put(next)
    ctx.bus.changed('project', { projectId: next.id, ids: [next.id], op: 'created' })
    return localizeProject(ctx, next, await localeOf(ctx, c))
  })

  r.handle('projects.purge', async ({ params }) => {
    const cur = await ctx.store.projects.get(params.projectId)
    if (!cur) throw notFound('project', params.projectId)
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

  r.handle('artifacts.keep', async ({ params, body }) => {
    const project = await requireProject(ctx, params.projectId)
    const kept = keepAsIs(await loadProjection(ctx.store, project.id), body.key, ctx.clock.now())
    await ctx.store.artifacts.put(kept)
    ctx.bus.emit({ type: 'artifact.changed', projectId: project.id, key: body.key })
    const view = await loadProjectView(ctx, project.id)
    const report = toArtifactReports(view, (k) => k === body.key)[0]
    return report!
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
