import { nanoid } from 'nanoid'
import { db } from '@/core/storage/db'
import type { Asset, AssetKind } from '@/types/domain'

interface CreateAssetInput {
  projectId: string
  kind: AssetKind
  blob: Blob
  mimeType: string
  width?: number
  height?: number
}

export async function createAsset(input: CreateAssetInput): Promise<Asset> {
  const asset: Asset = {
    id: nanoid(12),
    projectId: input.projectId,
    kind: input.kind,
    mimeType: input.mimeType,
    blob: input.blob,
    width: input.width,
    height: input.height,
    createdAt: Date.now(),
  }
  await db.assets.add(asset)
  return asset
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  return db.assets.get(id)
}

export async function deleteAsset(id: string): Promise<void> {
  await db.assets.delete(id)
}

/**
 * 给 React 组件用的 ObjectURL 缓存。
 * 内部记账避免重复 createObjectURL；调用方组件卸载时记得 release。
 */
const objectUrlCache = new Map<string, string>()

export function getObjectURL(asset: Asset): string {
  const cached = objectUrlCache.get(asset.id)
  if (cached) return cached
  const url = URL.createObjectURL(asset.blob)
  objectUrlCache.set(asset.id, url)
  return url
}

export function releaseObjectURL(assetId: string): void {
  const url = objectUrlCache.get(assetId)
  if (url) {
    URL.revokeObjectURL(url)
    objectUrlCache.delete(assetId)
  }
}
