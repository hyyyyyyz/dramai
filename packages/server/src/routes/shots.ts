import {
  allocateNumber,
  appendVersion,
  buildExpectations,
  buildRecord,
  createShot,
  loadProjection,
  MAX_MATERIAL_SIZE,
  readImageSize,
  refreshShotReadiness,
  setCurrentVersion,
  versionFilePath,
} from '@dramai/core'
import type { MediaSlot, MediaVersion, Shot, ShotAssetRef, Store } from '@dramai/core'
import type { ServerContext } from '../context.ts'
import { badRequest, HttpError } from '../errors.ts'
import { formFile } from '../handle.ts'
import type { RouteRegistry } from '../handle.ts'
import {
  afterStructureChange,
  assertNotBusy,
  deleteShotsTx,
  permutationOf,
  removeFiles,
  requireScene,
  requireShot,
} from '../services/structure.ts'
import { OK } from './common.ts'

const SLOT_FIELD = { image: 'image', video: 'video', audio: 'narrationAudio' } as const
const SLOT_KEY = { image: 'shot_image', video: 'shot_video', audio: 'shot_audio' } as const

export function registerShotRoutes(r: RouteRegistry, ctx: ServerContext): void {
  r.handle('shots.create', async ({ params, body }) => {
    const scene = await requireScene(ctx, params.sceneId)
    if (body.afterShotId !== undefined && !scene.shotOrder.includes(body.afterShotId)) {
      throw badRequest(`afterShotId 不在这一场里：${body.afterShotId}`)
    }
    const shot = await ctx.store.transaction(async (tx) => {
      const project = (await tx.projects.get(scene.projectId))!
      const alloc = allocateNumber(project, 'shot')
      const now = ctx.clock.now()
      const created = createShot({
        id: ctx.ids.next('shot'),
        projectId: scene.projectId,
        sceneId: scene.id,
        number: alloc.number,
        title: body.title?.trim(),
        scriptExcerpt: body.scriptExcerpt,
        durationSec: body.durationSec,
        now,
      })
      await tx.shots.put(created)
      const fresh = (await tx.scenes.get(scene.id))!
      const at = body.afterShotId
        ? fresh.shotOrder.indexOf(body.afterShotId) + 1
        : fresh.shotOrder.length
      const order = [...fresh.shotOrder]
      order.splice(at, 0, created.id)
      await tx.scenes.put({ ...fresh, shotOrder: order, updatedAt: now })
      await tx.projects.put({ ...alloc.project, updatedAt: now })
      return created
    })
    ctx.bus.changed('shot', { projectId: shot.projectId, ids: [shot.id], op: 'created' })
    await afterStructureChange(ctx, [scene.episodeId], shot.projectId)
    return shot
  })

  r.handle('shots.get', async ({ params }) => {
    const shot = await requireShot(ctx, params.shotId)
    return { shot, refs: await ctx.store.shotRefs.listByShot(shot.id) }
  })

  r.handle('shots.update', async ({ params, body }) => {
    const cur = await requireShot(ctx, params.shotId)
    const next: Shot = { ...cur, updatedAt: ctx.clock.now() }
    if (body.title !== undefined) next.title = body.title
    if (body.scriptExcerpt !== undefined) next.scriptExcerpt = body.scriptExcerpt
    if (body.movement !== undefined) next.movement = body.movement
    if (body.durationSec !== undefined) next.durationSec = body.durationSec
    if (body.moodTags !== undefined) next.moodTags = body.moodTags
    if (body.dialogue !== undefined) next.dialogue = body.dialogue
    if (body.actionBeats !== undefined) next.actionBeats = body.actionBeats
    clearable(next, 'cameraShot', body.cameraShot)
    clearable(next, 'angle', body.angle)
    clearable(next, 'aspectOverride', body.aspectOverride)
    clearable(next, 'atmosphere', body.atmosphere)
    clearable(next, 'narration', body.narration)
    if (body.prompts) {
      const prompts = { ...cur.prompts }
      for (const k of ['firstFrame', 'keyFrame', 'lastFrame', 'video'] as const) {
        const v = body.prompts[k]
        if (v === undefined) continue
        if (v === null || v === '') delete prompts[k]
        else prompts[k] = v
      }
      next.prompts = prompts
      // 生成时有“语义槽”就按槽重新编译、忽略 prompts 文本；用户手改了文本，就让文本生效（丢掉对应的槽）。
      if (cur.promptSpec) {
        const imageEdited = (['firstFrame', 'keyFrame', 'lastFrame'] as const).some(
          (k) => body.prompts![k] !== undefined && (prompts[k] ?? '') !== (cur.prompts[k] ?? ''),
        )
        const videoEdited =
          body.prompts.video !== undefined && (prompts.video ?? '') !== (cur.prompts.video ?? '')
        if (imageEdited || videoEdited) {
          const spec = { ...cur.promptSpec }
          if (imageEdited) delete spec.image
          if (videoEdited) delete spec.video
          if (spec.image || spec.video || spec.changeMagnitude) next.promptSpec = spec
          else delete next.promptSpec
        }
      }
    }
    await ctx.store.shots.put(next)
    ctx.bus.changed('shot', { projectId: next.projectId, ids: [next.id], op: 'updated' })
    return next
  })

  r.handle('shots.delete', async ({ params }) => {
    const shot = await requireShot(ctx, params.shotId)
    const scene = await requireScene(ctx, shot.sceneId)
    await assertNotBusy(ctx, shot.projectId, { shotIds: [shot.id], what: '这个镜头' })
    const files: string[] = []
    await ctx.store.transaction(async (tx) => {
      files.push(...(await deleteShotsTx(tx, shot.projectId, [shot])))
      const sc = await tx.scenes.get(scene.id)
      if (sc) {
        await tx.scenes.put({
          ...sc,
          shotOrder: sc.shotOrder.filter((id) => id !== shot.id),
          updatedAt: ctx.clock.now(),
        })
      }
    })
    await removeFiles(ctx, shot.projectId, files)
    ctx.bus.changed('shot', { projectId: shot.projectId, ids: [shot.id], op: 'deleted' })
    await afterStructureChange(ctx, [scene.episodeId], shot.projectId)
    return OK
  })

  r.handle('shots.setRefs', async ({ params, body }) => {
    const shot = await requireShot(ctx, params.shotId)
    const seen = new Set<string>()
    const refs: ShotAssetRef[] = []
    for (const ref of body.refs) {
      const asset = await ctx.store.assets.get(ref.assetId)
      if (!asset || asset.projectId !== shot.projectId || asset.deletedAt !== undefined) {
        throw badRequest(`引用的资产不存在或不属于这个项目：${ref.assetId}`)
      }
      if (ref.variantName && !asset.variants.some((v) => v.name === ref.variantName)) {
        throw badRequest(`资产「${asset.name}」没有衍生形态「${ref.variantName}」`)
      }
      const key = `${ref.assetId}\u0000${ref.variantName ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      refs.push({
        shotId: shot.id,
        assetId: ref.assetId,
        ...(ref.variantName ? { variantName: ref.variantName } : {}),
      })
    }
    await ctx.store.transaction(async (tx) => {
      await tx.shotRefs.replaceForShot(shot.id, refs)
    })
    await refreshShotReadiness(ctx.deps, shot.projectId, [shot.id])
    ctx.bus.changed('shot', { projectId: shot.projectId, ids: [shot.id], op: 'updated' })
    return { refs: await ctx.store.shotRefs.listByShot(shot.id) }
  })

  r.handle('shots.reorder', async ({ params, body }) => {
    const scene = await requireScene(ctx, params.sceneId)
    if (!permutationOf(body.order, scene.shotOrder)) {
      throw badRequest('order 必须恰好包含这一场现有的全部镜头（不多不少、不重复）')
    }
    const next = { ...scene, shotOrder: body.order, updatedAt: ctx.clock.now() }
    await ctx.store.scenes.put(next)
    ctx.bus.changed('scene', { projectId: next.projectId, ids: [next.id], op: 'updated' })
    return next
  })

  r.handle('shots.move', async ({ params, body }) => {
    const shot = await requireShot(ctx, params.shotId)
    const to = await requireScene(ctx, body.toSceneId)
    if (to.projectId !== shot.projectId) throw badRequest('不能把镜头移到别的项目的场里')
    const from = await requireScene(ctx, shot.sceneId)
    const moved = await ctx.store.transaction(async (tx) => {
      const now = ctx.clock.now()
      const src = (await tx.scenes.get(from.id))!
      const withoutShot = src.shotOrder.filter((id) => id !== shot.id)
      if (src.id === to.id) {
        const order = [...withoutShot]
        order.splice(Math.min(body.index ?? order.length, order.length), 0, shot.id)
        await tx.scenes.put({ ...src, shotOrder: order, updatedAt: now })
        return shot
      }
      await tx.scenes.put({ ...src, shotOrder: withoutShot, updatedAt: now })
      const dst = (await tx.scenes.get(to.id))!
      const order = [...dst.shotOrder]
      order.splice(Math.min(body.index ?? order.length, order.length), 0, shot.id)
      await tx.scenes.put({ ...dst, shotOrder: order, updatedAt: now })
      const next = { ...shot, sceneId: to.id, updatedAt: now }
      await tx.shots.put(next)
      return next
    })
    ctx.bus.changed('shot', { projectId: shot.projectId, ids: [shot.id], op: 'updated' })
    await afterStructureChange(ctx, [from.episodeId, to.episodeId], shot.projectId)
    return moved
  })

  r.handle('shots.setCurrentVersion', async ({ params, body }) => {
    const shot = await requireShot(ctx, params.shotId)
    const slotName = body.slot
    const field = SLOT_FIELD[slotName]
    const slot: MediaSlot = shot[field]
    let switched: MediaSlot
    try {
      switched = setCurrentVersion(slot, body.versionId)
    } catch {
      throw new HttpError(404, 'UNKNOWN_VERSION', `这个镜头的${slotName}没有版本 ${body.versionId}`)
    }
    const version = switched.versions.find((v) => v.id === body.versionId)!
    const next: Shot = { ...shot, [field]: switched, updatedAt: ctx.clock.now() }
    await ctx.store.transaction(async (tx) => {
      await tx.shots.put(next)
      await repointArtifact(tx, shot.projectId, `${SLOT_KEY[slotName]}:${shot.id}`, version)
    })
    ctx.bus.changed('shot', { projectId: shot.projectId, ids: [shot.id], op: 'updated' })
    ctx.bus.emit({
      type: 'artifact.changed',
      projectId: shot.projectId,
      key: `${SLOT_KEY[slotName]}:${shot.id}`,
    })
    return next
  })

  r.handle('shots.uploadImage', async ({ params, form }) => {
    const shot = await requireShot(ctx, params.shotId)
    const file = await formFile(form, 'file')
    if (file.bytes.byteLength > MAX_MATERIAL_SIZE) {
      throw new HttpError(
        413,
        'IMAGE_TOO_LARGE',
        `图片超过 ${MAX_MATERIAL_SIZE / 1024 / 1024}MB 上限`,
      )
    }
    const size = readImageSize(file.bytes)
    if (!size || size.mime === 'image/gif') {
      throw new HttpError(400, 'UNSUPPORTED_IMAGE', '需要 png / jpg / webp 图片')
    }
    const ext = size.mime === 'image/png' ? 'png' : size.mime === 'image/webp' ? 'webp' : 'jpg'
    const versionId = ctx.ids.next('ver')
    const path = versionFilePath({ dir: 'images', ownerKey: shot.id, versionId, ext })
    const info = await ctx.files.put(shot.projectId, path, file.bytes)
    const fileRef = { path, mime: size.mime, bytes: info.bytes, sha256: info.sha256 }
    const facts = { width: size.width, height: size.height }

    const projection = await loadProjection(ctx.store, shot.projectId)
    const key = `shot_image:${shot.id}`
    const expectation = buildExpectations(projection).get(key)
    // 作者上传的成品：不因设定图还没生成而被拦住，按它当前能确定的依据登记。
    const record = expectation
      ? buildRecord({
          projectId: shot.projectId,
          expectation: { ...expectation, blockedBy: undefined, requiredUpstream: [] },
          upstreamRecords: projection.artifacts,
          file: fileRef,
          versionId,
          origin: 'uploaded',
          facts,
          now: ctx.clock.now(),
        })
      : undefined
    const version: MediaVersion = {
      id: versionId,
      kind: 'image',
      file: fileRef,
      source: 'uploaded',
      createdAt: ctx.clock.now(),
      facts,
      basisDigest: record?.basisDigest,
    }
    const next = await ctx.store.transaction(async (tx) => {
      const fresh = (await tx.shots.get(shot.id))!
      const updated: Shot = {
        ...fresh,
        image: appendVersion(fresh.image, version),
        stages: { ...fresh.stages, image: 'succeeded' },
        updatedAt: ctx.clock.now(),
      }
      if (updated.failedStage === 'image') delete updated.failedStage
      await tx.shots.put(updated)
      if (record) await tx.artifacts.put(record)
      return updated
    })
    ctx.bus.changed('shot', { projectId: shot.projectId, ids: [shot.id], op: 'updated' })
    ctx.bus.emit({ type: 'artifact.changed', projectId: shot.projectId, key })
    return next
  })
}

/** 值为 null 时清掉可选字段，undefined 时不动。 */
function clearable<K extends keyof Shot>(
  shot: Shot,
  key: K,
  value: Shot[K] | null | undefined,
): void {
  if (value === undefined) return
  if (value === null) delete shot[key]
  else shot[key] = value
}

/** 当前版本切换后，产物登记要跟着指向这个版本的文件（下游据它的内容哈希判断是否过期）。 */
async function repointArtifact(
  tx: Store,
  projectId: string,
  key: string,
  version: MediaVersion,
): Promise<void> {
  const rec = await tx.artifacts.get(projectId, key)
  if (!rec) return
  await tx.artifacts.put({
    ...rec,
    file: version.file,
    versionId: version.id,
    contentHash: version.file.sha256,
    basisDigest: version.basisDigest ?? rec.basisDigest,
    facts: version.facts ?? rec.facts,
  })
}
