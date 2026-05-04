import { generateImage, ImageRequestError } from '@/core/image/client'
import { db } from '@/core/storage/db'
import { createAsset, deleteAsset } from '@/core/storage/assets'
import { updateStoryboard } from '@/core/storage/storyboards'
import type { Provider, Storyboard } from '@/types/domain'

export interface ShotImageEvent {
  shotId: string
  phase: 'pending' | 'requesting' | 'persisting' | 'done' | 'error'
  message?: string
  imageAssetId?: string
}

interface RunOpts {
  provider: Provider
  storyboard: Storyboard
  /** 可选：把这些角色的参考图作为图生图源图传给模型（保持人物一致性）。 */
  referenceImageBlobs?: Blob[]
  /** "1024x1024" / "1024x1792" / "1792x1024" 之类。 */
  size?: string
  signal?: AbortSignal
}

/**
 * 给单个分镜生成一张图片，落库并把 imageAssetId 写回 storyboard。
 * 老的 imageAssetId 指向的 asset 会被清掉，避免悬空。
 */
export async function* generateShotImage(
  opts: RunOpts,
): AsyncGenerator<ShotImageEvent, void, void> {
  const shot = opts.storyboard
  yield { shotId: shot.id, phase: 'requesting' }

  const promptParts = [shot.imagePrompt?.trim(), shot.sceneText?.trim()].filter(Boolean).join('. ')
  if (!promptParts) {
    yield {
      shotId: shot.id,
      phase: 'error',
      message: '该分镜没有可用的 image_prompt 或 scene_text',
    }
    return
  }

  try {
    const result = await generateImage(opts.provider, {
      model: opts.provider.model,
      prompt: promptParts,
      n: 1,
      size: opts.size,
      referenceImages: opts.referenceImageBlobs,
      signal: opts.signal,
    })
    const first = result.images[0]
    if (!first) {
      yield { shotId: shot.id, phase: 'error', message: 'Image API 没返回图片' }
      return
    }

    yield { shotId: shot.id, phase: 'persisting' }

    // 旧的图片资源先清掉
    if (shot.imageAssetId) {
      try {
        await deleteAsset(shot.imageAssetId)
      } catch {
        /* 失败也不阻断 */
      }
    }

    const asset = await createAsset({
      projectId: shot.projectId,
      kind: 'image',
      blob: first.blob,
      mimeType: first.mimeType,
      width: first.width,
      height: first.height,
    })

    await updateStoryboard(shot.id, {
      imageAssetId: asset.id,
      status: 'image-ready',
    })

    yield { shotId: shot.id, phase: 'done', imageAssetId: asset.id }
  } catch (err) {
    const msg =
      err instanceof ImageRequestError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err)
    await updateStoryboard(shot.id, { status: 'failed' })
    yield { shotId: shot.id, phase: 'error', message: msg }
  }
}

/**
 * 拉一个项目下"角色 → 参考图 Blob"的映射。
 * 返回的 Blob 可以作为图生图源图传给模型，保持角色一致性。
 *
 * 当前简化实现：把所有锁定且有参考图的角色 blob 都返回（最多 4 张），
 * 让客户端 reference_images 里都带上。后续可以根据 storyboard.characterIds
 * 精确筛选。
 */
export async function collectReferenceImages(
  projectId: string,
  characterIds: string[] | undefined,
  maxImages = 4,
): Promise<Blob[]> {
  if (!characterIds || characterIds.length === 0) return []
  const characters = await db.characters.where('id').anyOf(characterIds).toArray()
  const lockedWithRef = characters.filter(
    (c) => c.locked && c.referenceAssetId && c.projectId === projectId,
  )
  const slice = lockedWithRef.slice(0, maxImages)
  const blobs: Blob[] = []
  for (const c of slice) {
    if (!c.referenceAssetId) continue
    const asset = await db.assets.get(c.referenceAssetId)
    if (asset) blobs.push(asset.blob)
  }
  return blobs
}
