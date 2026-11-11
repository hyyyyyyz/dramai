import { importLegacyBackup, LegacyImportError } from '@dramai/core'
import { badRequest } from '../errors.ts'
import { formFile, formString } from '../handle.ts'
import type { RouteRegistry } from '../handle.ts'
import type { ServerContext } from '../context.ts'

/**
 * 导入 v0.4 备份。multipart 字段：`file`（备份 JSON，必填）、`projectIds`（逗号分隔的旧项目 id，缺省全部）、
 * `allowDuplicate`（"true" 时允许重复导入同一个旧项目）。
 */
export function registerImportRoutes(r: RouteRegistry, ctx: ServerContext): void {
  r.handle('import.legacy', async ({ form }) => {
    const file = await formFile(form, 'file')
    const projectIds = formString(form, 'projectIds')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    let summary
    try {
      summary = await importLegacyBackup(ctx.deps, new TextDecoder().decode(file.bytes), {
        projectIds: projectIds?.length ? projectIds : undefined,
        allowDuplicate: formString(form, 'allowDuplicate') === 'true',
      })
    } catch (err) {
      if (err instanceof LegacyImportError) throw badRequest(err.message)
      throw err
    }
    for (const p of summary.projects) {
      ctx.bus.changed('project', { projectId: p.projectId, ids: [p.projectId], op: 'created' })
    }
    ctx.bus.changed('import')
    return summary
  })
}
