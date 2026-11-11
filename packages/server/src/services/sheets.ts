import {
  buildExpectations,
  buildRecord,
  currentVersion,
  loadProjection,
  normalizeEntityName,
  readImageSize,
  versionFilePath,
} from '@dramai/core'
import type { Asset, MediaSlot, MediaVersion } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import { badRequest } from '../errors.ts'

/** 设定图的产物键：本体 `asset_sheet:<id>`，衍生形态 `variant_sheet:<id>/<name>`。 */
export const sheetKey = (assetId: string, variantName?: string): string =>
  variantName ? `variant_sheet:${assetId}/${variantName}` : `asset_sheet:${assetId}`

export const slotOf = (asset: Asset, variantName?: string): MediaSlot | undefined =>
  variantName ? asset.variants.find((v) => v.name === variantName)?.sheet : asset.sheet

/**
 * 让产物登记跟上设定图的“当前版本”：上传一张新图、或把当前版本切到另一个旧版本之后调用。
 * 登记失败（衍生形态的必需上游缺失等）时去掉旧记录——宁可显示“缺失”，也不留一条指向别的文件的记录。
 * 下游（分镜图等）凭 contentHash 判定过期，所以换了图它们会如实变成 stale。
 */
export async function syncSheetArtifact(
  ctx: ServerContext,
  projectId: string,
  assetId: string,
  variantName?: string,
): Promise<void> {
  const key = sheetKey(assetId, variantName)
  const asset = await ctx.store.assets.get(assetId)
  const slot = asset ? slotOf(asset, variantName) : undefined
  const version = slot ? currentVersion(slot) : undefined
  if (!version) {
    await ctx.store.artifacts.delete(projectId, key)
    ctx.bus.emit({ type: 'artifact.changed', projectId, key })
    return
  }
  const projection = await loadProjection(ctx.store, projectId)
  const expectation = buildExpectations(projection).get(key)
  if (!expectation) {
    await ctx.store.artifacts.delete(projectId, key)
  } else {
    try {
      await ctx.store.artifacts.put(
        buildRecord({
          projectId,
          expectation,
          upstreamRecords: projection.artifacts,
          file: version.file,
          versionId: version.id,
          origin: version.source === 'uploaded' ? 'uploaded' : 'generated',
          facts: version.facts,
          now: ctx.clock.now(),
        }),
      )
    } catch {
      await ctx.store.artifacts.delete(projectId, key)
    }
  }
  ctx.bus.emit({ type: 'artifact.changed', projectId, key })
}

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** 校验是一张真实的图片（看文件头，不信客户端给的 mime）。 */
export function sniffImage(bytes: Uint8Array): {
  mime: string
  ext: string
  width: number
  height: number
} {
  if (bytes.byteLength === 0) throw badRequest('文件是空的')
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw badRequest(`图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024}MB 上限`)
  }
  const size = readImageSize(bytes)
  if (!size) throw badRequest('不是支持的图片格式（PNG / JPEG / WebP / GIF）')
  return {
    mime: size.mime,
    ext: IMAGE_EXT[size.mime] ?? 'png',
    width: size.width,
    height: size.height,
  }
}

/** 把上传的图片存成一个设定图版本（来源 uploaded）。 */
export async function storeUploadedSheetVersion(
  ctx: ServerContext,
  projectId: string,
  ownerKey: string,
  bytes: Uint8Array,
): Promise<MediaVersion> {
  const img = sniffImage(bytes)
  const id = ctx.ids.next('ver')
  const path = versionFilePath({ dir: 'images', ownerKey, versionId: id, ext: img.ext })
  const info = await ctx.files.put(projectId, path, bytes)
  return {
    id,
    kind: 'image',
    file: { path, mime: img.mime, bytes: info.bytes, sha256: info.sha256 },
    source: 'uploaded',
    createdAt: ctx.clock.now(),
    facts: { width: img.width, height: img.height },
  }
}

export const sameName = (a: string, b: string): boolean =>
  normalizeEntityName(a) === normalizeEntityName(b)
