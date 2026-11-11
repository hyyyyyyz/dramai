import type { Project } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import { notFound } from '../errors.ts'

export const OK = { ok: true } as const

export function must<T>(value: T | undefined | null, what: string, id?: string): T {
  if (value === undefined || value === null) throw notFound(what, id)
  return value
}

/** 取项目；已进回收站的项目默认按不存在处理（恢复 / 彻底删除路由自己用 store 取）。 */
export async function requireProject(ctx: ServerContext, id: string): Promise<Project> {
  const p = must(await ctx.store.projects.get(id), '项目', id)
  if (p.deletedAt !== undefined) throw notFound('项目', id)
  return p
}

/** 实体变更通知（前端据此让对应查询失效重取）。 */
export function changed(
  ctx: ServerContext,
  entity: Parameters<ServerContext['bus']['changed']>[0],
  opts?: Parameters<ServerContext['bus']['changed']>[1],
): void {
  ctx.bus.changed(entity, opts)
}
