import { ingestMaterial, MaterialTooLargeError, UnsupportedMaterialError } from '@dramai/core'
import type { Material } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import { conflict, HttpError, notFound } from '../errors.ts'
import { formFile } from '../handle.ts'
import type { RouteRegistry } from '../handle.ts'
import { OK, requireProject } from './common.ts'

/** 列表和上传结果里不带全文（长篇小说几十万字）；全文走 `materials.text`。 */
function withoutText(m: Material) {
  const { text, ...rest } = m
  void text
  return rest
}

export function registerMaterialRoutes(r: RouteRegistry, ctx: ServerContext): void {
  r.handle('materials.list', async ({ params }) => {
    await requireProject(ctx, params.projectId)
    const list = await ctx.store.materials.listByProject(params.projectId)
    return { items: list.map(withoutText) }
  })

  r.handle('materials.upload', async ({ params, form }) => {
    await requireProject(ctx, params.projectId)
    const file = await formFile(form, 'file')
    try {
      const { material, summary } = await ingestMaterial(ctx.deps, params.projectId, {
        name: file.name,
        bytes: file.bytes,
        mime: file.mime || undefined,
      })
      ctx.bus.changed('material', {
        projectId: params.projectId,
        ids: [material.id],
        op: 'created',
      })
      ctx.bus.changed('project', { projectId: params.projectId, op: 'updated' })
      return { material: withoutText(material), summary }
    } catch (err) {
      if (err instanceof MaterialTooLargeError) {
        throw new HttpError(413, 'MATERIAL_TOO_LARGE', err.message)
      }
      if (err instanceof UnsupportedMaterialError) {
        throw new HttpError(
          400,
          'UNSUPPORTED_MATERIAL',
          `${err.message}（支持 txt / md / docx / png / jpg / webp / gif）`,
        )
      }
      throw err
    }
  })

  r.handle('materials.text', async ({ params }) => {
    const m = await ctx.store.materials.get(params.materialId)
    if (!m) throw notFound('素材', params.materialId)
    return { text: m.text }
  })

  r.handle('materials.delete', async ({ params }) => {
    const m = await ctx.store.materials.get(params.materialId)
    if (!m) throw notFound('素材', params.materialId)
    const episodes = await ctx.store.episodes.listByProject(m.projectId)
    const using = episodes.filter((e) => e.sourceRange?.materialId === m.id)
    if (using.length > 0) {
      throw conflict(
        'MATERIAL_IN_USE',
        `「${m.name}」是 ${using.length} 个分集的原文来源，不能删除；请先删除这些分集`,
        { episodeIds: using.map((e) => e.id) },
      )
    }
    await ctx.store.materials.delete(m.id)
    if (m.file) await ctx.files.remove(m.projectId, m.file.path).catch(() => {})
    ctx.bus.changed('material', { projectId: m.projectId, ids: [m.id], op: 'deleted' })
    return OK
  })
}
