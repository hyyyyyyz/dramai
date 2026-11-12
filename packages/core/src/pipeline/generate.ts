import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildExpectations, buildRecord } from '../artifacts/staleness.ts'
import type { ArtifactExpectation, ArtifactRecord } from '../artifacts/types.ts'
import type { Asset } from '../domain/asset.ts'
import type { AspectRatio, FileRef, MediaFacts } from '../domain/common.ts'
import { deriveVoiceOwner } from '../domain/voice.ts'
import {
  appendVersion,
  versionFilePath,
  type MediaKind,
  type MediaSlot,
  type MediaVersion,
} from '../domain/media.ts'
import type { Shot } from '../domain/shot.ts'
import { artifactKeyOf, blockingGaps, resolveInputs } from '../generation/inputs.ts'
import type { GenerationTarget, ResolvedInputs, ResolvedReference } from '../generation/inputs.ts'
import { loadProjection } from '../generation/projection.ts'
import type { ProjectProjection } from '../generation/projection.ts'
import type { Store } from '../ports/index.ts'
import { JobFailure } from '../jobs/worker.ts'
import type { JobContext, JobHandler } from '../jobs/worker.ts'
import { runProviderJob } from '../jobs/provider-job.ts'
import { createFfmpegImageEncoder, fitReferenceImages } from '../media/reference-images.ts'
import type { ImageEncoder, ReferenceImageInput } from '../media/reference-images.ts'
import { probeMedia } from '../media/ffmpeg.ts'
import { resolveOutputSize } from '../media/output-size.ts'
import { readImageSize } from '../parsers/image-size.ts'
import { compileImagePrompt, compileVideoPrompt } from '../prompts/compile.ts'
import { renderMentionsPlain } from '../prompts/mentions.ts'
import { checkCapability, maxRefImagesOf } from '../providers/catalog.ts'
import { snapDuration } from '../providers/duration.ts'
import { getMediaProtocol } from '../providers/protocols/index.ts'
import type {
  BinaryImage,
  ImageGenInput,
  ModelCapability,
  PromptDialect,
  ProviderConfig,
  ProviderKind,
  SpeechInput,
  VideoGenInput,
} from '../providers/types.ts'
import { CAMERA_PHRASE_ZH } from './camera.ts'
import { authFor } from './deps.ts'
import type { PipelineDeps } from './deps.ts'
import {
  buildSheetPrompt,
  buildSheetEditPrompt,
  buildVariantEditPrompt,
  chooseSheetLayout,
  sheetAspect,
} from './sheets.ts'
import type { SheetLayout } from './sheets.ts'
import { removeRetry } from '../util/fs.ts'

/**
 * 生成类任务处理器：设定图 / 分镜图 / 视频 / 旁白配音。
 *
 * 共同流程：
 *  1. 用 `resolveInputs`（和准入、预览、时效判定同一份计算）取这次生成的输入；有阻断性缺口就直接失败，不发请求；
 *  2. 开始时取一份期望依据的快照——生成期间上游或输入又变了，产物一出来就如实判为过期；
 *  3. 参考图压缩（总量 ≤ 8MB 等规则）、按模型写法编译提示词、算输出尺寸；
 *  4. 经 `runProviderJob` 调服务商（拿到上游任务号立刻落检查点，重启后续轮询、绝不重投）；
 *  5. 成品写成**新版本**（旧版本原样保留），登记到产物清单，更新镜头阶段状态。
 */

export function createGenerationHandlers(deps: PipelineDeps): Record<string, JobHandler> {
  return {
    shot_image: (ctx) => runImageJob(deps, ctx),
    asset_sheet: (ctx) => runImageJob(deps, ctx),
    shot_video: (ctx) => runVideoJob(deps, ctx),
    shot_audio: (ctx) => runAudioJob(deps, ctx),
  }
}

// === 公共小件 ===

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
}
const extFor = (mime: string, fallback: string) =>
  EXT[mime.split(';')[0].trim().toLowerCase()] ?? fallback

export function defaultDialect(
  config: ProviderConfig,
  profile?: { prompt: PromptDialect },
): PromptDialect {
  if (profile) return profile.prompt
  switch (config.protocol) {
    case 'openai-images':
      return { lang: 'en', negative: 'field' }
    case 'gemini-image':
      return { lang: 'en', negative: 'inline' }
    default:
      return { lang: 'zh', negative: 'none' }
  }
}

function jobTarget(ctx: JobContext): GenerationTarget {
  const t = ctx.job.params.target as GenerationTarget | undefined
  if (!t || typeof t !== 'object' || !('kind' in t)) {
    throw new JobFailure({
      category: 'invalid_input',
      code: 'BAD_JOB_PARAMS',
      message: '任务缺少 target',
      recoverable: false,
    })
  }
  return t
}

async function providerFor(
  deps: PipelineDeps,
  ctx: JobContext,
  kind: ProviderKind,
): Promise<ProviderConfig> {
  const id = ctx.job.providerSnapshot?.providerConfigId
  const config = id ? await deps.providers.get(id) : undefined
  if (!config) {
    throw new JobFailure({
      category: 'invalid_input',
      code: 'PROVIDER_GONE',
      message: `找不到任务使用的服务商配置：${id ?? '(无)'}`,
      recoverable: false,
    })
  }
  if (config.kind !== kind) {
    throw new JobFailure({
      category: 'invalid_input',
      code: 'PROVIDER_KIND',
      message: `服务商 ${config.label} 不是 ${kind} 类型`,
      recoverable: false,
    })
  }
  return config
}

function guard(inputs: ResolvedInputs): void {
  const blocking = blockingGaps(inputs)
  if (blocking.length > 0) {
    throw new JobFailure({
      category: 'invalid_input',
      code: blocking[0].code,
      message: `生成输入有缺口，未发起请求：${blocking.map((g) => g.message).join('；')}`,
      recoverable: false,
    })
  }
}

/** 读参考图字节，并按规则压缩上传副本（源文件不动）。返回的顺序与 `refs` 一致。 */
export async function prepareReferenceImages(
  deps: PipelineDeps,
  projectId: string,
  refs: ReadonlyArray<ResolvedReference>,
): Promise<BinaryImage[]> {
  if (refs.length === 0) return []
  const inputs: ReferenceImageInput[] = []
  for (const r of refs) {
    const bytes = await deps.files.get(projectId, r.file.path)
    const size = readImageSize(bytes)
    inputs.push({
      id: String(r.index),
      bytes,
      mime: r.file.mime,
      width: size?.width,
      height: size?.height,
      role: r.role === 'start_frame' ? 'frame' : 'reference',
    })
  }
  const encoder: ImageEncoder =
    deps.media?.imageEncoder ??
    (deps.media
      ? createFfmpegImageEncoder(deps.media.bins)
      : async () => {
          throw new JobFailure({
            category: 'invalid_input',
            code: 'NO_IMAGE_ENCODER',
            message: '参考图超出大小预算，需要压缩，但没有可用的 ffmpeg',
            recoverable: false,
          })
        })
  const fit = await fitReferenceImages(inputs, encoder)
  return fit.images.map((i) => ({ bytes: i.bytes, mime: i.mime }))
}

async function probeBytes(
  deps: PipelineDeps,
  bytes: Uint8Array,
  ext: string,
): Promise<MediaFacts | undefined> {
  if (!deps.media) return undefined
  const dir = await mkdtemp(join(tmpdir(), 'dramai-probe-'))
  try {
    const file = join(dir, `f.${ext}`)
    await writeFile(file, bytes)
    const info = await probeMedia(deps.media.bins, file)
    return {
      width: info.width,
      height: info.height,
      durationSec: info.durationSec,
      hasAudio: info.hasAudio,
      fps: info.fps,
    }
  } catch {
    return undefined
  } finally {
    await removeRetry(dir)
  }
}

interface Stored {
  version: MediaVersion
  file: FileRef
}

async function storeVersion(
  deps: PipelineDeps,
  input: {
    projectId: string
    ctx: JobContext
    kind: MediaKind
    dir: 'images' | 'videos' | 'audio'
    ownerKey: string
    bytes: Uint8Array
    mime: string
    source: MediaVersion['source']
    prompt?: string
    config: ProviderConfig
    facts?: MediaFacts
    withNativeAudio?: boolean
    basisDigest?: string
  },
): Promise<Stored> {
  const id = deps.ids.next('ver')
  const ext = extFor(
    input.mime,
    input.kind === 'image' ? 'png' : input.kind === 'video' ? 'mp4' : 'mp3',
  )
  const path = versionFilePath({ dir: input.dir, ownerKey: input.ownerKey, versionId: id, ext })
  const info = await deps.files.put(input.projectId, path, input.bytes)
  const file: FileRef = { path, mime: input.mime, bytes: info.bytes, sha256: info.sha256 }
  const version: MediaVersion = {
    id,
    kind: input.kind,
    file,
    source: input.source,
    createdAt: deps.clock.now(),
    jobId: input.ctx.job.id,
    prompt: input.prompt,
    provider: {
      providerConfigId: input.config.id,
      protocol: input.config.protocol,
      baseUrl: input.config.baseUrl,
      model: input.config.model,
    },
    facts: input.facts,
    withNativeAudio: input.withNativeAudio,
    basisDigest: input.basisDigest,
  }
  return { version, file }
}

/** 造出产物记录（不写库）。生成期间上游变了，就如实判为过期。 */
function buildArtifact(
  deps: PipelineDeps,
  projection: ProjectProjection,
  expectation: ArtifactExpectation | undefined,
  stored: Stored,
  facts?: MediaFacts,
): ArtifactRecord | undefined {
  if (!expectation) return undefined
  return buildRecord({
    projectId: projection.project.id,
    expectation,
    // 用开始时的上游快照：生成期间上游变了，就如实判为过期。
    upstreamRecords: projection.artifacts,
    file: stored.file,
    versionId: stored.version.id,
    facts,
    now: deps.clock.now(),
  })
}

/**
 * 落库时是否按“忽略结果”处理——在落库的事务里读任务，和用户的“忽略”动作串行，不会错过。
 * 被忽略：版本照常进历史，但不成为当前版本，也不登记为当前产物。
 */
async function resultIgnored(tx: Store, ctx: JobContext): Promise<boolean> {
  return (await tx.jobs.get(ctx.job.id))?.ignoreResult === true
}

async function setShotStage(
  deps: PipelineDeps,
  shotId: string | undefined,
  stage: 'image' | 'video' | 'audio',
  status: Shot['stages']['image'],
): Promise<void> {
  if (!shotId) return
  const shot = await deps.store.shots.get(shotId)
  if (!shot) return
  const failedStage =
    status === 'failed' && stage !== 'audio'
      ? stage
      : shot.failedStage === stage
        ? undefined
        : shot.failedStage
  await deps.store.shots.put({
    ...shot,
    stages: { ...shot.stages, [stage]: status },
    failedStage,
    updatedAt: deps.clock.now(),
  })
}

function neededRefs(inputs: ResolvedInputs): number {
  return inputs.references.filter((r) => r.role !== 'style').length
}

// === 图像：设定图 / 分镜图 ===

interface SheetParams {
  layout?: SheetLayout
  resolution?: string
}

export async function runImageJob(deps: PipelineDeps, ctx: JobContext) {
  const target = jobTarget(ctx)
  if (target.kind !== 'asset_sheet' && target.kind !== 'shot_image') {
    throw new JobFailure({
      category: 'invalid_input',
      code: 'BAD_TARGET',
      message: `图像任务不能处理 ${target.kind}`,
      recoverable: false,
    })
  }
  const shotId = target.kind === 'shot_image' ? target.shotId : undefined
  try {
    await setShotStage(deps, shotId, 'image', 'running')
    const result = await doImageJob(deps, ctx, target)
    await setShotStage(deps, shotId, 'image', 'succeeded')
    return result
  } catch (err) {
    await setShotStage(deps, shotId, 'image', 'failed')
    throw err
  }
}

async function doImageJob(
  deps: PipelineDeps,
  ctx: JobContext,
  target: Extract<GenerationTarget, { kind: 'asset_sheet' | 'shot_image' }>,
) {
  const config = await providerFor(deps, ctx, 'image')
  const lookup = deps.catalog.models.lookup(config)
  const cap = lookup.capability
  const projection = await loadProjection(deps.store, ctx.job.projectId)
  const inputs = resolveInputs(projection, target, {
    maxRefImages: maxRefImagesOf(cap) || undefined,
  })
  guard(inputs)
  const expectation = buildExpectations(projection).get(artifactKeyOf(target))
  const params = ctx.job.params as SheetParams
  const mentionAssets = [...projection.assets.values()].map((a) => ({
    id: a.id,
    name: a.name,
    aliases: a.aliases,
  }))
  const dialect = defaultDialect(config, lookup.profile)
  const project = projection.project

  // 能力再核一遍（准入已经查过；这里防止配置在排队期间被改）。
  const issues = checkCapability(lookup, config.model, {
    mode: inputs.references.length > 0 ? 'i2i' : 't2i',
    referenceImages: neededRefs(inputs),
  }).filter((i) => i.level === 'unsupported')
  if (issues.length > 0) {
    throw new JobFailure({
      category: 'invalid_input',
      code: issues[0].code,
      message: issues[0].message,
      recoverable: false,
    })
  }

  // --- 提示词、画幅、参考图 ---
  let text: string
  let negative: string | undefined
  let aspect: AspectRatio = inputs.aspectRatio
  let asset: Asset | undefined
  let layout: SheetLayout = 'single'
  let source: MediaVersion['source'] = 'generated'

  if (target.kind === 'shot_image') {
    const shot = projection.shots.get(target.shotId)!
    const spec = shot.promptSpec?.image
    const plain = (t?: string) => (t ? renderMentionsPlain(t, mentionAssets) : undefined)
    const compiled = compileImagePrompt(
      spec
        ? {
            ...spec,
            subject: plain(spec.subject),
            action: plain(spec.action),
            expression: plain(spec.expression),
            spatial: plain(spec.spatial),
            extra: plain(spec.extra),
            fullEn: plain(spec.fullEn),
          }
        : { subject: plain(inputs.prompt) },
      {
        dialect,
        styleKeywords: project.style.imageKeywords || undefined,
        references: inputs.references,
      },
    )
    text = compiled.text
    negative = compiled.negative
  } else {
    asset = projection.assets.get(target.assetId)!
    if (target.editInstruction !== undefined) {
      // 用一句话改现有设定图：以当前图为唯一参考、增量指令为唯一提示词；画幅沿用当前图。
      source = 'image_edit'
      text = compileImagePrompt(
        { subject: buildSheetEditPrompt(deps.catalog.prompts, inputs.prompt) },
        { dialect },
      ).text
      const current = readImageSize(
        await deps.files.get(project.id, inputs.references[0].file.path),
      )
      aspect = current
        ? current.height > current.width
          ? '9:16'
          : current.width > current.height
            ? '16:9'
            : '1:1'
        : '1:1'
    } else if (target.variantName) {
      source = 'image_edit'
      aspect = '1:1'
      const hasCostume = inputs.references.some((r) => r.role === 'costume')
      text = compileImagePrompt(
        { subject: buildVariantEditPrompt(deps.catalog.prompts, inputs.prompt, hasCostume) },
        { dialect },
      ).text
      // 以当前图为唯一参考；画幅沿用本体设定图（比例由参考图决定）。
      const baseSize = readImageSize(
        await deps.files.get(project.id, inputs.references[0].file.path),
      )
      if (baseSize)
        aspect =
          baseSize.height > baseSize.width
            ? '9:16'
            : baseSize.width > baseSize.height
              ? '16:9'
              : '1:1'
    } else {
      layout = params.layout ?? chooseSheetLayout({ kind: asset.kind, imageModel: cap })
      aspect = sheetAspect(asset.kind, layout)
      const base = buildSheetPrompt(deps.catalog.prompts, asset, project.style, layout, 'front')
      const compiled = compileImagePrompt(
        { subject: base },
        { dialect, references: inputs.references },
      )
      text = compiled.text
      negative = compiled.negative
    }
  }

  const refs = inputs.references
  const refBytes = await prepareReferenceImages(deps, project.id, refs)
  // 只有 OpenAI 兼容的图像接口按像素尺寸出图；Gemini 协议经画幅参数。画幅比例永远来自项目 / 版式，分辨率只决定清晰度。
  const sizeFor = (aspectRatio: AspectRatio) =>
    config.protocol === 'openai-images'
      ? resolveOutputSize({
          aspectRatio,
          resolution: params.resolution && params.resolution !== 'none' ? params.resolution : 1024,
          step: cap.sizeStep ?? 16,
          maxLongSide: cap.maxLongSide,
          maxPixels: cap.maxPixels,
        })
      : undefined
  const protocol = getMediaProtocol(config.protocol)
  const auth = await authFor(deps, config)

  const generateOne = async (
    prompt: string,
    references: BinaryImage[],
    aspectRatio: AspectRatio,
  ) => {
    const input: ImageGenInput = {
      prompt,
      negativePrompt: negative,
      aspectRatio,
      size: sizeFor(aspectRatio),
      references,
    }
    await ctx.setStage('submitting')
    const res = await runProviderJob(ctx, protocol, auth, input, deps.executor)
    const out = res.outputs[0]
    if (!out || out.bytes.byteLength === 0) {
      throw new JobFailure({
        category: 'delivery_failed',
        code: 'EMPTY_RESULT',
        message: '服务商没有返回图片',
        recoverable: false,
      })
    }
    return out
  }

  const first = await generateOne(text, refBytes, aspect)
  await ctx.setStage('processing')
  const ownerKey =
    target.kind === 'shot_image'
      ? target.shotId
      : target.variantName
        ? `${target.assetId}__${target.variantName.replace(/[^\w一-龥-]+/g, '_')}`
        : target.assetId
  const size1 = readImageSize(first.bytes)
  const facts: MediaFacts | undefined = size1
    ? { width: size1.width, height: size1.height }
    : undefined
  const stored = await storeVersion(deps, {
    projectId: project.id,
    ctx,
    kind: 'image',
    dir: 'images',
    ownerKey,
    bytes: first.bytes,
    mime: first.mime,
    source,
    prompt: text,
    config,
    facts,
    basisDigest: undefined,
  })

  // 逐角度版式：侧面、背面以正面为参考（模型支持以图生图时），否则文生图。
  const extraViews: Array<{ view: 'side' | 'back'; stored: Stored }> = []
  if (target.kind === 'asset_sheet' && !target.variantName && layout === 'per_angle' && asset) {
    const frontRef: BinaryImage = { bytes: first.bytes, mime: first.mime }
    const canRef = cap.modes.i2i !== 'unsupported' && cap.refImages.support !== 'unsupported'
    for (const v of ['side', 'back'] as const) {
      const prompt = buildSheetPrompt(deps.catalog.prompts, asset, project.style, layout, v)
      const o = await generateOne(
        canRef
          ? `${prompt}\n以参考图里的人物为准，保持同一张脸、同一发型、同一套服装，只改变朝向。`
          : prompt,
        canRef ? [frontRef] : [],
        aspect,
      )
      const sz = readImageSize(o.bytes)
      extraViews.push({
        view: v,
        stored: await storeVersion(deps, {
          projectId: project.id,
          ctx,
          kind: 'image',
          dir: 'images',
          ownerKey: `${ownerKey}__${v}`,
          bytes: o.bytes,
          mime: o.mime,
          source: 'generated',
          prompt,
          config,
          facts: sz ? { width: sz.width, height: sz.height } : undefined,
        }),
      })
    }
  }

  // --- 落库：新版本追加到槽里（旧版本原样保留）+ 登记产物 ---
  const record = buildArtifact(deps, projection, expectation, stored, facts)
  stored.version.basisDigest = record?.basisDigest
  let adopted = true
  await deps.store.transaction(async (tx) => {
    const now = deps.clock.now()
    // 被用户标记“忽略结果”：版本进历史，但不成为当前版本，也不登记为当前产物。
    adopted = !(await resultIgnored(tx, ctx))
    const keep = { makeCurrent: adopted }
    if (record && adopted) await tx.artifacts.put(record)
    if (target.kind === 'shot_image') {
      const shot = await tx.shots.get(target.shotId)
      if (!shot) throw gone('镜头')
      await tx.shots.put({
        ...shot,
        image: appendVersion(shot.image, stored.version, keep),
        updatedAt: now,
      })
    } else {
      const a = await tx.assets.get(target.assetId)
      if (!a || a.deletedAt) throw gone('资产')
      if (target.variantName) {
        const idx = a.variants.findIndex((v) => v.name === target.variantName)
        if (idx < 0) throw gone('衍生形态')
        const variants = a.variants.map((v, i) =>
          i === idx ? { ...v, sheet: appendVersion(v.sheet, stored.version, keep) } : v,
        )
        await tx.assets.put({ ...a, variants, updatedAt: now })
      } else {
        const views = { ...(a.sheetViews ?? {}) }
        for (const ev of extraViews) {
          views[ev.view] = appendVersion(
            views[ev.view] ?? { currentVersionId: null, versions: [] },
            ev.stored.version,
            keep,
          )
        }
        await tx.assets.put({
          ...a,
          sheet: appendVersion(a.sheet, stored.version, keep),
          sheetLayout: layout === 'single' ? a.sheetLayout : layout,
          sheetViews: extraViews.length > 0 ? views : a.sheetViews,
          updatedAt: now,
        })
      }
    }
  })
  if (record && adopted) {
    deps.events?.emit({ type: 'artifact.changed', projectId: record.projectId, key: record.key })
  }
  return {
    result: {
      versionId: stored.version.id,
      path: stored.file.path,
      views: extraViews.length,
      ...(adopted ? {} : { ignored: true }),
    },
  }
}

const gone = (what: string) =>
  new JobFailure({
    category: 'invalid_input',
    code: 'TARGET_GONE',
    message: `${what}在生成期间被删除，结果没有采用`,
    recoverable: false,
  })

// === 视频 ===

export async function runVideoJob(deps: PipelineDeps, ctx: JobContext) {
  const target = jobTarget(ctx)
  if (target.kind !== 'shot_video') {
    throw new JobFailure({
      category: 'invalid_input',
      code: 'BAD_TARGET',
      message: '视频任务只能处理 shot_video',
      recoverable: false,
    })
  }
  try {
    await setShotStage(deps, target.shotId, 'video', 'running')
    const r = await doVideoJob(deps, ctx, target.shotId)
    await setShotStage(deps, target.shotId, 'video', 'succeeded')
    return r
  } catch (err) {
    await setShotStage(deps, target.shotId, 'video', 'failed')
    throw err
  }
}

function pickResolution(cap: ModelCapability, requested?: string): string | undefined {
  if (requested && requested !== 'none') return requested
  const list = cap.resolutions.value?.filter((r) => r !== 'none') ?? []
  // 默认取档位里居中偏低的一档，不替用户挑最贵的。
  return list.length > 0 ? list[Math.min(list.length - 1, Math.floor(list.length / 2))] : undefined
}

async function doVideoJob(deps: PipelineDeps, ctx: JobContext, shotId: string) {
  const config = await providerFor(deps, ctx, 'video')
  const lookup = deps.catalog.models.lookup(config)
  const cap = lookup.capability
  const projection = await loadProjection(deps.store, ctx.job.projectId)
  const inputs = resolveInputs(projection, { kind: 'shot_video', shotId })
  guard(inputs)
  const expectation = buildExpectations(projection).get(inputs.key)
  const shot = projection.shots.get(shotId)!
  const project = projection.project
  const mentionAssets = [...projection.assets.values()].map((a) => ({
    id: a.id,
    name: a.name,
    aliases: a.aliases,
  }))
  const dialect = defaultDialect(config, lookup.profile)

  // 发声归属：只有对白才开启视频模型的原生人声；旁白整段不进视频提示词。
  const owner = deriveVoiceOwner(shot, project.narrationDelivery)
  if (owner === 'conflict') {
    throw new JobFailure({
      category: 'invalid_input',
      code: 'VOICE_CONFLICT',
      message: '这个镜头同时有对白和旁白，会出现两层人声；请先拆成两个镜头',
      recoverable: false,
    })
  }
  const withAudio = owner === 'native' && cap.nativeAudio !== 'unsupported'

  const plain = (t?: string) => (t ? renderMentionsPlain(t, mentionAssets) : undefined)
  const vs = shot.promptSpec?.video
  const compiled = compileVideoPrompt(
    vs
      ? {
          ...vs,
          openingState: plain(vs.openingState),
          action: plain(vs.action),
          secondary: plain(vs.secondary),
          endState: plain(vs.endState),
          lightingChange: plain(vs.lightingChange),
          extra: plain(vs.extra),
          fullEn: plain(vs.fullEn),
          cameraMove: vs.cameraMove ?? CAMERA_PHRASE_ZH[shot.movement],
        }
      : { action: plain(inputs.prompt), cameraMove: CAMERA_PHRASE_ZH[shot.movement] },
    { dialect },
  )

  const [frame] = await prepareReferenceImages(deps, project.id, [inputs.startFrame!])
  const duration =
    cap.durations.support === 'unsupported' || !cap.durations.value
      ? Math.round(inputs.durationSec ?? 5)
      : snapDuration(inputs.durationSec ?? 5, cap.durations.value)
  const input: VideoGenInput = {
    prompt: compiled.text,
    image: frame,
    durationSec: duration,
    allowedDurations: cap.durations.value?.values,
    aspectRatio: inputs.aspectRatio,
    resolution: pickResolution(cap, ctx.job.params.resolution as string | undefined),
    withAudio,
  }
  const protocol = getMediaProtocol(config.protocol)
  await ctx.setStage('submitting')
  const res = await runProviderJob(ctx, protocol, await authFor(deps, config), input, deps.executor)
  const out = res.outputs[0]
  if (!out || out.bytes.byteLength === 0) {
    throw new JobFailure({
      category: 'delivery_failed',
      code: 'EMPTY_RESULT',
      message: '服务商没有返回视频',
      recoverable: false,
    })
  }
  await ctx.setStage('processing')
  const ext = extFor(out.mime, 'mp4')
  const facts =
    (await probeBytes(deps, out.bytes, ext)) ??
    (res.durationSec ? { durationSec: res.durationSec } : undefined)
  const stored = await storeVersion(deps, {
    projectId: project.id,
    ctx,
    kind: 'video',
    dir: 'videos',
    ownerKey: shotId,
    bytes: out.bytes,
    mime: out.mime.startsWith('video/') ? out.mime : 'video/mp4',
    source: 'generated',
    prompt: compiled.text,
    config,
    facts,
    withNativeAudio: withAudio,
  })
  const record = buildArtifact(deps, projection, expectation, stored, facts)
  stored.version.basisDigest = record?.basisDigest
  let adopted = true
  await deps.store.transaction(async (tx) => {
    const s = await tx.shots.get(shotId)
    if (!s) throw gone('镜头')
    adopted = !(await resultIgnored(tx, ctx))
    if (record && adopted) await tx.artifacts.put(record)
    await tx.shots.put({
      ...s,
      video: appendVersion(s.video, stored.version, { makeCurrent: adopted }),
      updatedAt: deps.clock.now(),
    })
  })
  if (record && adopted) {
    deps.events?.emit({ type: 'artifact.changed', projectId: record.projectId, key: record.key })
  }
  return {
    result: {
      versionId: stored.version.id,
      path: stored.file.path,
      withNativeAudio: withAudio,
      ...(adopted ? {} : { ignored: true }),
    },
  }
}

// === 旁白配音 ===

export async function runAudioJob(deps: PipelineDeps, ctx: JobContext) {
  const target = jobTarget(ctx)
  if (target.kind !== 'shot_audio') {
    throw new JobFailure({
      category: 'invalid_input',
      code: 'BAD_TARGET',
      message: '配音任务只能处理 shot_audio',
      recoverable: false,
    })
  }
  try {
    await setShotStage(deps, target.shotId, 'audio', 'running')
    const r = await doAudioJob(deps, ctx, target.shotId)
    await setShotStage(deps, target.shotId, 'audio', 'succeeded')
    return r
  } catch (err) {
    await setShotStage(deps, target.shotId, 'audio', 'failed')
    throw err
  }
}

async function doAudioJob(deps: PipelineDeps, ctx: JobContext, shotId: string) {
  const config = await providerFor(deps, ctx, 'tts')
  const projection = await loadProjection(deps.store, ctx.job.projectId)
  const inputs = resolveInputs(projection, { kind: 'shot_audio', shotId })
  guard(inputs)
  const shot = projection.shots.get(shotId)!
  const project = projection.project
  const owner = deriveVoiceOwner(shot, project.narrationDelivery)
  if (owner !== 'tts') {
    throw new JobFailure({
      category: 'invalid_input',
      code: owner === 'conflict' ? 'VOICE_CONFLICT' : 'NARRATION_NOT_TTS',
      message:
        owner === 'conflict'
          ? '这个镜头同时有对白和旁白，会出现两层人声'
          : '这个镜头的旁白不由 TTS 交付（项目设置为后期配音 / 无旁白，或镜头没有旁白）',
      recoverable: false,
    })
  }
  // 旁白音频的依据里有音色 / 语速 / 服务商：以项目的旁白设置为准（和时效判定用的是同一份）；
  // 项目还没设置时，退而用这次任务的服务商和默认音色。
  const expectation = buildExpectations(
    projection,
    project.narrationVoice ? {} : { audio: { provider: config.id, voice: 'alloy' } },
  ).get(inputs.key)
  const voice = project.narrationVoice?.voice ?? 'alloy'
  const input: SpeechInput = {
    text: inputs.narration ?? '',
    voice,
    speed: project.narrationVoice?.speed,
    format: 'mp3',
  }
  await ctx.setStage('submitting')
  const res = await runProviderJob(
    ctx,
    getMediaProtocol(config.protocol),
    await authFor(deps, config),
    input,
    deps.executor,
  )
  const out = res.outputs[0]
  if (!out || out.bytes.byteLength === 0) {
    throw new JobFailure({
      category: 'delivery_failed',
      code: 'EMPTY_RESULT',
      message: '服务商没有返回音频',
      recoverable: false,
    })
  }
  await ctx.setStage('processing')
  const ext = extFor(out.mime, 'mp3')
  // 配音实测时长：合成时旁白按它摆放，可以比镜头长。
  const facts = await probeBytes(deps, out.bytes, ext)
  const stored = await storeVersion(deps, {
    projectId: project.id,
    ctx,
    kind: 'audio',
    dir: 'audio',
    ownerKey: shotId,
    bytes: out.bytes,
    mime: out.mime.startsWith('audio/') ? out.mime : 'audio/mpeg',
    source: 'generated',
    prompt: inputs.narration,
    config,
    facts,
  })
  const record = buildArtifact(deps, projection, expectation, stored, facts)
  stored.version.basisDigest = record?.basisDigest
  let adopted = true
  await deps.store.transaction(async (tx) => {
    const s = await tx.shots.get(shotId)
    if (!s) throw gone('镜头')
    adopted = !(await resultIgnored(tx, ctx))
    if (record && adopted) await tx.artifacts.put(record)
    await tx.shots.put({
      ...s,
      narrationAudio: appendVersion(s.narrationAudio, stored.version, { makeCurrent: adopted }),
      updatedAt: deps.clock.now(),
    })
  })
  if (record && adopted) {
    deps.events?.emit({ type: 'artifact.changed', projectId: record.projectId, key: record.key })
  }
  return {
    result: {
      versionId: stored.version.id,
      path: stored.file.path,
      durationSec: facts?.durationSec,
      ...(adopted ? {} : { ignored: true }),
    },
  }
}

export type { MediaSlot }
