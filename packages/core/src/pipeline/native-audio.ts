import { currentVersion } from '../domain/media.ts'
import type { MediaVersion } from '../domain/media.ts'
import type { Shot } from '../domain/shot.ts'
import { deriveVoiceOwner } from '../domain/voice.ts'
import { audioCannotBeSwitchedOff } from '../providers/catalog.ts'
import type { ModelRegistry } from '../providers/catalog.ts'
import type { ModelCapability, ProtocolId, ProviderConfig } from '../providers/types.ts'
import type { Store } from '../ports/index.ts'
import type { PipelineDeps } from './deps.ts'
import { appendRevision, headRevision } from '../timeline/document.ts'
import { VOICEOVER_SOURCE_VOLUME } from '../timeline/document.ts'

/**
 * 时间线片段的原声**默认**音量里“关不掉原生音频的模型”这一条。合成本身永远只按时间线上的 `sourceVolume`，
 * 这里只决定**默认值**，而且只在两个时刻：
 *  1. 片段创建时（一集的第一份时间线，或之后新增的镜头）——镜头当时已经有生成的视频（`nativeAudioDefaultVolume`）；
 *  2. 片段创建时还没有视频，**第一次**拿到生成的视频时（`applyNativeAudioDefaultOnFirstVideo`）——
 *     用户很可能先打开合成页（时间线就建好了）再批量生成视频，两种顺序要得到同样的默认音量。
 * 条件始终是同三条：视频是生成的、生成时没有要求原生人声（`withNativeAudio === false`）、
 * 生成它的模型**无法关闭原生音频**（能力里 `audioToggle: unsupported`，读法见 `capabilityOfVersion`）。
 * 用户的选择永远优先：片段已经有过视频、或用户调过这个片段的音量，都不改。
 */

export type ProviderConfigs = ReadonlyMap<string, ProviderConfig>

export async function providerConfigMap(
  deps: Pick<PipelineDeps, 'providers'>,
): Promise<ProviderConfigs> {
  return new Map((await deps.providers.list()).map((c) => [c.id, c]))
}

/**
 * 一个视频版本是用哪份能力生成的：画像（协议 + 型号）加上**当时那份服务商配置**里用户的 `capabilityOverrides`
 * ——和准入读的是同一份（准入用 `models.lookup(provider)`）。服务商配置已被删、或它的协议 / 型号后来改了，
 * 就只用版本快照里的协议和型号（不带覆盖）。
 */
export function capabilityOfVersion(
  version: Pick<MediaVersion, 'provider'>,
  models: ModelRegistry,
  configs?: ProviderConfigs,
): ModelCapability | undefined {
  const snap = version.provider
  if (!snap) return undefined
  const config = snap.providerConfigId ? configs?.get(snap.providerConfigId) : undefined
  const same = config && config.protocol === snap.protocol && config.model === snap.model
  return models.lookup({
    protocol: snap.protocol as ProtocolId,
    model: snap.model,
    ...(same && config.capabilityOverrides
      ? { capabilityOverrides: config.capabilityOverrides }
      : {}),
  }).capability
}

/** 这个视频版本是不是“模型关不掉自带音频、而镜头又没要求原生人声”的那种。 */
export function isUnwantedUnswitchableAudio(
  version: MediaVersion | undefined,
  models: ModelRegistry,
  configs?: ProviderConfigs,
): boolean {
  if (!version || version.source !== 'generated' || version.withNativeAudio !== false) return false
  const cap = capabilityOfVersion(version, models, configs)
  return cap !== undefined && audioCannotBeSwitchedOff(cap)
}

/** 片段创建时的默认音量：0，或 `undefined`（照旧）。 */
export function nativeAudioDefaultVolume(
  shot: Pick<Shot, 'video'>,
  models: ModelRegistry,
  configs?: ProviderConfigs,
): number | undefined {
  return isUnwantedUnswitchableAudio(currentVersion(shot.video), models, configs) ? 0 : undefined
}

/**
 * 第一次拿到生成的视频：若这个镜头在时间线上已经有片段，按同样的三个条件决定默认音量，效果与“先生成视频再建时间线”一致。
 *
 * 只在下面全部成立时才改，其余一律不动：
 * - 之前这个镜头没有当前视频（`shotBefore` 是写入新版本之前的镜头）——换视频、换模型都不改；
 * - 片段的音量**从来没有被改过**：它在这份时间线所有修订里的 `sourceVolume` 始终是同一个值，并且正好是“没有视频时的默认值”
 *   （台词 / 无声镜头 1，旁白镜头 0.3）。用户调过——哪怕调回了原来的数——历史里就有第二个值，就不改。
 *   不需要给片段加字段：时间线的修订历史本来就是追加式、完整保留的。
 * 改动是时间线上追加的一个修订（`author: system`，`changedClipIds` 列出片段，摘要说明原因），用户可以在时间线上调高或回滚；
 * 和用户同时编辑时，服务端的 `baseRevision` 检查会让用户那边得到一次“修订冲突”并刷新，不会丢编辑。
 * 返回改了的片段 id（可能为空）。它自己要在一个事务里调用（读时间线、追加修订、写回是一个整体），
 * 但**不能**和保存视频版本放在同一个事务里：见 `applyNativeAudioDefaultAfterSave`。
 */
export async function applyNativeAudioDefaultOnFirstVideo(
  tx: Pick<Store, 'timelines' | 'scenes' | 'projects'>,
  deps: Pick<PipelineDeps, 'catalog' | 'clock'>,
  input: { shotBefore: Shot; version: MediaVersion; configs: ProviderConfigs },
): Promise<{ episodeId: string; clipIds: string[] } | undefined> {
  const { shotBefore, version } = input
  if (currentVersion(shotBefore.video)) return undefined
  if (!isUnwantedUnswitchableAudio(version, deps.catalog.models, input.configs)) return undefined
  const scene = await tx.scenes.get(shotBefore.sceneId)
  if (!scene) return undefined
  const doc = (await tx.timelines.listByProject(shotBefore.projectId)).find(
    (t) => t.episodeId === scene.episodeId,
  )
  if (!doc) return undefined // 还没有时间线：以后创建片段时会按当时的视频算（nativeAudioDefaultVolume）
  const project = await tx.projects.get(shotBefore.projectId)
  if (!project) return undefined
  const owner = deriveVoiceOwner(shotBefore, project.narrationDelivery)
  const noVideoDefault = owner === 'tts' || owner === 'post' ? VOICEOVER_SOURCE_VOLUME : 1
  const head = headRevision(doc)
  const untouched = (clipId: string, volume: number): boolean => {
    if (volume !== noVideoDefault) return false
    for (const rev of doc.revisions) {
      const c = rev.content.clips.find((x) => x.id === clipId)
      if (c && c.sourceVolume !== volume) return false
    }
    return true
  }
  const hit = head.content.clips.filter(
    (c) => c.shotId === shotBefore.id && untouched(c.id, c.sourceVolume),
  )
  if (hit.length === 0) return undefined
  const ids = new Set(hit.map((c) => c.id))
  const next = appendRevision(doc, {
    content: {
      ...head.content,
      clips: head.content.clips.map((c) => (ids.has(c.id) ? { ...c, sourceVolume: 0 } : c)),
    },
    summary:
      '默认音量：这个模型无法关闭自带音频，而这个镜头没有使用原生人声，片段原声默认静音（可以在时间线上调高）',
    author: { kind: 'system' },
    now: deps.clock.now(),
    changedClipIds: [...ids],
    reason: 'native_audio_default',
  })
  await tx.timelines.put(next)
  return { episodeId: doc.episodeId, clipIds: [...ids] }
}

/**
 * 视频版本已经保存之后，再单独做自动静音。**视频已经生成并下载完成（上游已计费），无论这一步成功与否都必须保存下来**：
 * 所以这一步不在保存视频的事务里，自己一个事务，出任何错都只发一条不含内容的提示，不抛出，视频任务仍然成功。
 *
 * 并发：每个镜头的任务各自在保存之后调用这里；这里的事务**在事务内读时间线、追加修订、写回**，
 * 事务之间互斥（SQLite 存储是一把互斥锁加 BEGIN IMMEDIATE），所以多个镜头同时完成时修订编号连续、不丢不重——
 * 靠的是“事务内重读”，不是靠调用顺序。事务内还会确认这个版本仍然是镜头当前的视频（中途被换掉了就不动）。
 * 和第一次创建时间线（`ensureTimeline` 的建档事务）的先后顺序两种都不会漏：时间线先建，这里看得到它并改；
 * 视频先保存，建时间线时按当时的视频直接算出 0，这里再看就已经是 0，不会再追加。
 */
export async function applyNativeAudioDefaultAfterSave(
  deps: PipelineDeps,
  input: { shotBefore: Shot; version: MediaVersion },
): Promise<void> {
  try {
    const { shotBefore, version } = input
    if (currentVersion(shotBefore.video)) return
    const configs = await providerConfigMap(deps)
    if (!isUnwantedUnswitchableAudio(version, deps.catalog.models, configs)) return
    const touched = await deps.store.transaction(async (tx) => {
      const now = await tx.shots.get(shotBefore.id)
      if (!now || currentVersion(now.video)?.id !== version.id) return undefined
      return applyNativeAudioDefaultOnFirstVideo(tx, deps, { shotBefore, version, configs })
    })
    if (touched) {
      deps.events?.emit({
        type: 'timeline.changed',
        projectId: shotBefore.projectId,
        episodeId: touched.episodeId,
      })
    }
  } catch (err) {
    // 不含任何内容：只有出错的类型名。视频已经保存；这个片段的音量保持原样，用户可以在时间线上自己调。
    try {
      // 提示，不是失败：视频已经保存，任务是成功的（所以不用 `job.worker_error`，那个表示执行器出错）
      deps.events?.emit({
        type: 'job.notice',
        level: 'warning',
        code: 'native_audio_default_failed',
        message: `时间线默认静音没有完成（视频已保存）：${err instanceof Error ? err.name : 'Error'}`,
        projectId: input.shotBefore.projectId,
        ...(input.version.jobId ? { jobId: input.version.jobId } : {}),
        shotId: input.shotBefore.id,
      })
    } catch {
      // 连提示都发不出去也不影响视频任务
    }
  }
}
