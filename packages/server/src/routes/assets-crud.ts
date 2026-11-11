import {
  allocateNumber,
  appendVersion,
  createAsset,
  setCurrentVersion,
  validateAssetName,
} from '@dramai/core'
import type { Asset } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import { badRequest, conflict, HttpError, notFound } from '../errors.ts'
import { formFile, formString } from '../handle.ts'
import type { RouteRegistry } from '../handle.ts'
import {
  sameName,
  sniffImage,
  slotOf,
  storeUploadedSheetVersion,
  syncSheetArtifact,
} from '../services/sheets.ts'
import { OK, requireProject } from './common.ts'

export async function requireAsset(ctx: ServerContext, id: string): Promise<Asset> {
  const asset = await ctx.store.assets.get(id)
  if (!asset || asset.deletedAt !== undefined) throw notFound('资产', id)
  return asset
}

/** 引用了某个资产的镜头（去重，保持镜头顺序无关）。 */
export async function shotsUsingAsset(ctx: ServerContext, asset: Asset): Promise<string[]> {
  const refs = await ctx.store.shotRefs.listByProject(asset.projectId)
  return [...new Set(refs.filter((r) => r.assetId === asset.id).map((r) => r.shotId))]
}

const AUDIO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
}
const AUDIO_BY_NAME = /\.(mp3|wav|m4a|aac|ogg)$/i
const MAX_VOICE_BYTES = 30 * 1024 * 1024

export function audioKind(name: string, mime: string): { ext: string; mime: string } | undefined {
  const m = mime.split(';')[0]!.trim().toLowerCase()
  const ext = AUDIO_EXT[m] ?? AUDIO_BY_NAME.exec(name)?.[1]?.toLowerCase()
  if (!ext) return undefined
  const mimeByExt: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
  }
  return { ext, mime: mimeByExt[ext] ?? m }
}

/**
 * 资产路由。
 *
 * 上传（multipart）约定：
 * - `POST /api/assets/:id/originals`：字段 `file`（图片）。原图只作为生成设定图的输入。
 * - `POST /api/assets/:id/sheet`：字段 `file`（图片）、可选 `variantName`（给某个衍生形态上传成品图）。
 *   上传的图成为当前设定图（版本来源 uploaded），登记为 uploaded 产物，不随描述变化而过期。
 * - `POST /api/assets/:id/voice`：字段 `file`（音频）。角色音色参考。
 */
export function registerAssetCrudRoutes(r: RouteRegistry, ctx: ServerContext): void {
  const touch = (asset: Asset): Asset => ({ ...asset, updatedAt: ctx.clock.now() })
  const notify = (asset: Asset, op: 'created' | 'updated' | 'deleted') =>
    ctx.bus.changed('asset', { projectId: asset.projectId, ids: [asset.id], op })

  const ensureNameFree = async (
    projectId: string,
    kind: Asset['kind'],
    name: string,
    exceptId?: string,
  ) => {
    const problem = validateAssetName(name)
    if (problem) throw new HttpError(400, 'ASSET_NAME_INVALID', `资产名不合法：${problem}`)
    const clash = (await ctx.store.assets.listByProject(projectId)).find(
      (a) => a.id !== exceptId && a.kind === kind && sameName(a.name, name),
    )
    if (clash) {
      throw conflict('ASSET_NAME_TAKEN', `已存在同名资产「${clash.name}」；请直接使用它`, {
        assetId: clash.id,
      })
    }
  }

  r.handle('assets.list', async ({ params }) => {
    await requireProject(ctx, params.projectId)
    return { items: await ctx.store.assets.listByProject(params.projectId) }
  })

  r.handle('assets.create', async ({ params, body }) => {
    await requireProject(ctx, params.projectId)
    const name = body.name.trim()
    await ensureNameFree(params.projectId, body.kind, name)
    const asset = await ctx.store.transaction(async (tx) => {
      const project = (await tx.projects.get(params.projectId))!
      const alloc = allocateNumber(project, 'asset')
      await tx.projects.put({ ...alloc.project, updatedAt: ctx.clock.now() })
      const created: Asset = {
        ...createAsset({
          id: ctx.ids.next('asset'),
          projectId: params.projectId,
          number: alloc.number,
          kind: body.kind,
          name,
          now: ctx.clock.now(),
          description: body.description,
        }),
        aliases: (body.aliases ?? []).map((a) => a.trim()).filter(Boolean),
        appearance: body.appearance,
        styling: body.styling,
      }
      await tx.assets.put(created)
      return created
    })
    notify(asset, 'created')
    return asset
  })

  r.handle('assets.get', async ({ params }) => {
    const asset = await requireAsset(ctx, params.assetId)
    return { asset, usedByShotIds: await shotsUsingAsset(ctx, asset) }
  })

  r.handle('assets.update', async ({ params, body }) => {
    const cur = await requireAsset(ctx, params.assetId)
    const name = body.name?.trim()
    if (name !== undefined && name !== cur.name) {
      await ensureNameFree(cur.projectId, cur.kind, name, cur.id)
    }
    const orUndef = (v: string | null | undefined, old: string | undefined) =>
      v === undefined ? old : (v ?? undefined)
    const next = touch({
      ...cur,
      name: name ?? cur.name,
      aliases: body.aliases ? body.aliases.map((a) => a.trim()).filter(Boolean) : cur.aliases,
      appearance: orUndef(body.appearance, cur.appearance),
      styling: orUndef(body.styling, cur.styling),
      description: orUndef(body.description, cur.description),
    })
    await ctx.store.assets.put(next)
    notify(next, 'updated')
    return next
  })

  r.handle('assets.delete', async ({ params }) => {
    const asset = await requireAsset(ctx, params.assetId)
    // 软删除。仍被引用时拒绝：删掉会让镜头悄悄少一个参考。先到镜头里解除引用。
    const shotIds = await shotsUsingAsset(ctx, asset)
    const all = await ctx.store.assets.listByProject(asset.projectId)
    const costumeOf = all
      .filter((a) => a.variants.some((v) => v.costumeAssetId === asset.id))
      .map((a) => a.id)
    const sceneIds = (await ctx.store.scenes.listByProject(asset.projectId))
      .filter((s) => s.locationAssetId === asset.id)
      .map((s) => s.id)
    if (shotIds.length + costumeOf.length + sceneIds.length > 0) {
      throw conflict('ASSET_IN_USE', `「${asset.name}」仍被使用，请先解除引用再删除`, {
        shotIds,
        costumeOfAssetIds: costumeOf,
        sceneIds,
      })
    }
    await ctx.store.assets.put(touch({ ...asset, deletedAt: ctx.clock.now() }))
    notify(asset, 'deleted')
    return OK
  })

  r.handle('assets.uploadOriginal', async ({ params, form }) => {
    const asset = await requireAsset(ctx, params.assetId)
    const file = await formFile(form, 'file')
    const img = sniffImage(file.bytes)
    const id = ctx.ids.next('orig')
    const path = `originals/${asset.id}/${id}.${img.ext}`
    const info = await ctx.files.put(asset.projectId, path, file.bytes)
    const next = touch({
      ...asset,
      originals: [
        ...asset.originals,
        { path, mime: img.mime, bytes: info.bytes, sha256: info.sha256 },
      ],
    })
    await ctx.store.assets.put(next)
    notify(next, 'updated')
    return next
  })

  r.handle('assets.uploadSheet', async ({ params, form }) => {
    const asset = await requireAsset(ctx, params.assetId)
    const variantName = formString(form, 'variantName') || undefined
    if (variantName && !asset.variants.some((v) => v.name === variantName)) {
      throw notFound('衍生形态', variantName)
    }
    const file = await formFile(form, 'file')
    const ownerKey = variantName ? `${asset.id}__${variantName}` : asset.id
    const version = await storeUploadedSheetVersion(ctx, asset.projectId, ownerKey, file.bytes)
    const next = await ctx.store.transaction(async (tx) => {
      const cur = (await tx.assets.get(asset.id))!
      let updated: Asset
      if (variantName) {
        // 作者上传的成品：不再随本体资产图变化而失效。
        updated = {
          ...cur,
          variants: cur.variants.map((v) =>
            v.name === variantName
              ? { ...v, origin: 'upload' as const, sheet: appendVersion(v.sheet, version) }
              : v,
          ),
        }
      } else {
        updated = { ...cur, sheet: appendVersion(cur.sheet, version) }
      }
      updated = touch(updated)
      await tx.assets.put(updated)
      return updated
    })
    await syncSheetArtifact(ctx, asset.projectId, asset.id, variantName)
    notify(next, 'updated')
    return next
  })

  r.handle('assets.setCurrentSheet', async ({ params, body }) => {
    const asset = await requireAsset(ctx, params.assetId)
    const slot = slotOf(asset, body.variantName)
    if (!slot) throw notFound('衍生形态', body.variantName)
    if (!slot.versions.some((v) => v.id === body.versionId)) {
      throw notFound('设定图版本', body.versionId)
    }
    const next = touch(
      body.variantName
        ? {
            ...asset,
            variants: asset.variants.map((v) =>
              v.name === body.variantName
                ? { ...v, sheet: setCurrentVersion(v.sheet, body.versionId) }
                : v,
            ),
          }
        : { ...asset, sheet: setCurrentVersion(asset.sheet, body.versionId) },
    )
    await ctx.store.assets.put(next)
    await syncSheetArtifact(ctx, asset.projectId, asset.id, body.variantName)
    notify(next, 'updated')
    return next
  })

  r.handle('assets.uploadVoice', async ({ params, form }) => {
    const asset = await requireAsset(ctx, params.assetId)
    if (asset.kind !== 'character') {
      throw new HttpError(400, 'VOICE_NOT_ALLOWED', '只有角色可以设置音色参考')
    }
    const file = await formFile(form, 'file')
    const kind = audioKind(file.name, file.mime)
    if (!kind) throw badRequest('不是支持的音频格式（mp3 / wav / m4a / aac / ogg）')
    if (file.bytes.byteLength === 0) throw badRequest('文件是空的')
    if (file.bytes.byteLength > MAX_VOICE_BYTES) {
      throw badRequest(`音频超过 ${MAX_VOICE_BYTES / 1024 / 1024}MB 上限`)
    }
    const path = `audio/voice/${asset.id}/${ctx.ids.next('voice')}.${kind.ext}`
    const info = await ctx.files.put(asset.projectId, path, file.bytes)
    const next = touch({
      ...asset,
      voiceRef: { path, mime: kind.mime, bytes: info.bytes, sha256: info.sha256 },
    })
    await ctx.store.assets.put(next)
    notify(next, 'updated')
    return next
  })
}
