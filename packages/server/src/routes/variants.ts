import { emptySlot, validateAsset, validateAssetName } from '@dramai/core'
import type { Asset, AssetVariant } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import { conflict, HttpError, notFound } from '../errors.ts'
import type { RouteRegistry } from '../handle.ts'
import { sheetKey, syncSheetArtifact } from '../services/sheets.ts'
import { requireAsset } from './assets-crud.ts'

/**
 * 衍生形态（角色的换装 / 变身）。与服装资产的边界见 core `AssetVariant`：
 * 衍生形态属于某个角色，可选地通过 `costumeAssetId` 关联一件 kind=costume 的服装资产。
 */
export function registerVariantRoutes(r: RouteRegistry, ctx: ServerContext): void {
  const save = async (asset: Asset): Promise<Asset> => {
    const all = new Map(
      (await ctx.store.assets.listByProject(asset.projectId)).map((a) => [a.id, a]),
    )
    const issues = validateAsset(asset, (id) => {
      const a = all.get(id)
      return a && a.projectId === asset.projectId ? a : undefined
    })
    if (issues.length > 0) {
      throw new HttpError(400, issues[0]!.code, issues[0]!.message, { issues })
    }
    const next = { ...asset, updatedAt: ctx.clock.now() }
    await ctx.store.assets.put(next)
    ctx.bus.changed('asset', { projectId: asset.projectId, ids: [asset.id], op: 'updated' })
    return next
  }

  const findVariant = (asset: Asset, name: string): AssetVariant => {
    const v = asset.variants.find((x) => x.name === name)
    if (!v) throw notFound('variant', name)
    return v
  }

  const shotsUsingVariant = async (asset: Asset, name: string): Promise<string[]> => {
    const refs = await ctx.store.shotRefs.listByProject(asset.projectId)
    return [
      ...new Set(
        refs.filter((x) => x.assetId === asset.id && x.variantName === name).map((x) => x.shotId),
      ),
    ]
  }

  r.handle('variants.create', async ({ params, body }) => {
    const asset = await requireAsset(ctx, params.assetId)
    const name = body.name.trim()
    const problem = validateAssetName(name)
    if (problem) throw new HttpError(400, 'VARIANT_NAME_INVALID', `衍生形态名不合法：${problem}`)
    if (asset.variants.some((v) => v.name === name)) {
      throw conflict('VARIANT_NAME_TAKEN', `「${asset.name}」已有叫「${name}」的衍生形态`)
    }
    const variant: AssetVariant = {
      name,
      description: body.description,
      origin: 'edit',
      editInstruction: body.editInstruction ?? body.description,
      sheet: emptySlot(),
      ...(body.costumeAssetId ? { costumeAssetId: body.costumeAssetId } : {}),
    }
    return save({ ...asset, variants: [...asset.variants, variant] })
  })

  r.handle('variants.update', async ({ params, body }) => {
    const asset = await requireAsset(ctx, params.assetId)
    const cur = findVariant(asset, params.variantName)
    const newName = body.name?.trim()
    const renamed = newName !== undefined && newName !== cur.name
    if (renamed) {
      const problem = validateAssetName(newName)
      if (problem) throw new HttpError(400, 'VARIANT_NAME_INVALID', `衍生形态名不合法：${problem}`)
      if (asset.variants.some((v) => v.name === newName)) {
        throw conflict('VARIANT_NAME_TAKEN', `「${asset.name}」已有叫「${newName}」的衍生形态`)
      }
    }
    const next: AssetVariant = {
      ...cur,
      name: newName ?? cur.name,
      description: body.description ?? cur.description,
      editInstruction: body.editInstruction ?? cur.editInstruction,
    }
    if (body.costumeAssetId === null) delete next.costumeAssetId
    else if (body.costumeAssetId !== undefined) next.costumeAssetId = body.costumeAssetId

    const saved = await ctx.store.transaction(async () =>
      save({
        ...asset,
        variants: asset.variants.map((v) => (v.name === cur.name ? next : v)),
      }),
    )
    if (renamed) {
      // 重命名 = 换了身份：镜头引用跟着改，旧产物键作废，设定图按新键重新登记。
      const refs = await ctx.store.shotRefs.listByProject(asset.projectId)
      const shotIds = [
        ...new Set(
          refs
            .filter((x) => x.assetId === asset.id && x.variantName === cur.name)
            .map((x) => x.shotId),
        ),
      ]
      await ctx.store.transaction(async (tx) => {
        for (const shotId of shotIds) {
          const list = await tx.shotRefs.listByShot(shotId)
          await tx.shotRefs.replaceForShot(
            shotId,
            list.map((x) =>
              x.assetId === asset.id && x.variantName === cur.name
                ? { ...x, variantName: next.name }
                : x,
            ),
          )
        }
        await tx.artifacts.delete(asset.projectId, sheetKey(asset.id, cur.name))
      })
      await syncSheetArtifact(ctx, asset.projectId, asset.id, next.name)
      if (shotIds.length > 0) ctx.bus.changed('shot', { projectId: asset.projectId, ids: shotIds })
    }
    return saved
  })

  r.handle('variants.delete', async ({ params }) => {
    const asset = await requireAsset(ctx, params.assetId)
    findVariant(asset, params.variantName)
    const shotIds = await shotsUsingVariant(asset, params.variantName)
    if (shotIds.length > 0) {
      throw conflict(
        'VARIANT_IN_USE',
        `衍生形态「${params.variantName}」仍被镜头引用，请先在镜头里换掉它`,
        { shotIds },
      )
    }
    const saved = await save({
      ...asset,
      variants: asset.variants.filter((v) => v.name !== params.variantName),
    })
    await ctx.store.artifacts.delete(asset.projectId, sheetKey(asset.id, params.variantName))
    ctx.bus.emit({
      type: 'artifact.changed',
      projectId: asset.projectId,
      key: sheetKey(asset.id, params.variantName),
    })
    return saved
  })
}
