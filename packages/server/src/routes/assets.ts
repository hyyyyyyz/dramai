import type { ServerContext } from '../context.ts'
import type { RouteRegistry } from '../handle.ts'
import { registerAssetCrudRoutes } from './assets-crud.ts'
import { registerCandidateRoutes } from './candidates.ts'
import { registerTimelineRoutes } from './timeline.ts'
import { registerVariantRoutes } from './variants.ts'

/** 资产、衍生形态、候选实体、时间线。 */
export function registerAssetRoutes(r: RouteRegistry, ctx: ServerContext): void {
  registerAssetCrudRoutes(r, ctx)
  registerVariantRoutes(r, ctx)
  registerCandidateRoutes(r, ctx)
  registerTimelineRoutes(r, ctx)
}
