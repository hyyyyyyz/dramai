import {
  appendVersion,
  createAsset,
  createEpisode,
  createProject,
  createScene,
  createShot,
  emptySlot,
} from '../src/domain/index.ts'
import type { Asset, FileRef, MediaKind, MediaSlot, Project, Shot } from '../src/domain/index.ts'
import { loadProjection } from '../src/generation/projection.ts'
import { createMemoryPorts } from '../src/testing/index.ts'
import { sha256Hex } from '../src/util/canonical.ts'
import type { ProviderConfig } from '../src/providers/types.ts'

export type Ports = ReturnType<typeof createMemoryPorts>

export function fileRef(path: string, content = path, mime = 'image/png'): FileRef {
  const data = new TextEncoder().encode(content)
  return { path, mime, bytes: data.byteLength, sha256: sha256Hex(data) }
}

/** 把文件内容写进 FileStore，并返回登记用的 FileRef。 */
export async function putFile(
  ports: Ports,
  projectId: string,
  path: string,
  content = path,
  mime = 'image/png',
) {
  const data = new TextEncoder().encode(content)
  await ports.files.put(projectId, path, data)
  return fileRef(path, content, mime)
}

export function slotWith(
  kind: MediaKind,
  versionId: string,
  file: FileRef,
  source: 'generated' | 'uploaded' = 'generated',
): MediaSlot {
  return appendVersion(emptySlot(), {
    id: versionId,
    kind,
    file,
    source,
    createdAt: 1,
  })
}

export interface World {
  ports: Ports
  project: Project
  hero: Asset
  place: Asset
  prop: Asset
  shot: Shot
  shot2: Shot
  episodeId: string
  sceneId: string
  reload: () => ReturnType<typeof loadProjection>
}

export const imageProvider = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'prov-img',
  label: 'Nano Banana',
  kind: 'image',
  protocol: 'gemini-image',
  baseUrl: 'https://api.302.ai',
  model: 'gemini-2.5-flash-image',
  enabled: true,
  // Nano Banana 的图生图 / 参考图 / 画幅都没验证过：这里模拟“用户已接受”，需要确认的路径在专门的测试里测。
  acceptedUnverified: ['mode:i2i', 'refImages', 'aspectRatio'],
  ...over,
})

export const videoProvider = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  id: 'prov-vid',
  label: 'Wan Flash',
  kind: 'video',
  protocol: 'aliyun-video',
  baseUrl: 'https://api.302ai.cn',
  model: 'wan2.2-i2v-flash',
  enabled: true,
  ...over,
})

/**
 * 一个小而完整的项目：1 集 1 场 2 镜；3 个资产（角色/地点/道具）都有资产图；
 * 第一镜的关键帧提示词提及角色与地点。
 */
export async function makeWorld(options: { sheets?: boolean } = {}): Promise<World> {
  const ports = createMemoryPorts()
  const { store, ids, clock } = ports
  const now = clock.now()
  let project = createProject({ id: ids.next('proj'), name: '测试短剧', aspectRatio: '9:16', now })
  const pid = project.id

  const mkAsset = async (kind: Asset['kind'], name: string, n: number, withSheet: boolean) => {
    let a = createAsset({
      id: ids.next('asset'),
      projectId: pid,
      number: n,
      kind,
      name,
      now,
      description: `${name}的描述`,
    })
    if (withSheet) {
      const f = await putFile(ports, pid, `images/${a.id}/v1.png`, `sheet-${name}`)
      a = { ...a, sheet: slotWith('image', `${a.id}_v1`, f) }
    }
    await store.assets.put(a)
    return a
  }
  const withSheets = options.sheets !== false
  const hero = await mkAsset('character', '林夏', 1, withSheets)
  const place = await mkAsset('location', '老茶馆', 2, withSheets)
  const prop = await mkAsset('prop', '青瓷杯', 3, withSheets)

  const ep = createEpisode({ id: ids.next('ep'), projectId: pid, number: 1, title: '第一集', now })
  const sc = createScene({
    id: ids.next('scene'),
    projectId: pid,
    episodeId: ep.id,
    number: 1,
    now,
  })
  const mkShot = (n: number, text: string, prompt?: string) => {
    const s = createShot({
      id: ids.next('shot'),
      projectId: pid,
      sceneId: sc.id,
      number: n,
      now,
      scriptExcerpt: text,
      durationSec: 5,
    })
    return {
      ...s,
      prompts: { keyFrame: prompt, video: prompt ? '镜头缓慢推近，她转身看向窗外' : undefined },
      narration: `旁白${n}`,
    }
  }
  const shot = mkShot(1, '她走进茶馆', `@{${hero.id}} 站在 @{${place.id}} 门口, cinematic`)
  const shot2 = mkShot(2, '她拿起杯子', `@{${hero.id}} 拿起 @{${prop.id}}`)
  await store.shots.put(shot)
  await store.shots.put(shot2)
  await store.shotRefs.replaceForShot(shot.id, [
    { shotId: shot.id, assetId: hero.id },
    { shotId: shot.id, assetId: place.id },
  ])
  await store.shotRefs.replaceForShot(shot2.id, [
    { shotId: shot2.id, assetId: hero.id },
    { shotId: shot2.id, assetId: prop.id },
  ])
  await store.scenes.put({ ...sc, shotOrder: [shot.id, shot2.id] })
  await store.episodes.put({ ...ep, sceneOrder: [sc.id] })
  project = {
    ...project,
    episodeOrder: [ep.id],
    counters: { episode: 1, scene: 1, shot: 2, asset: 3, material: 0 },
  }
  await store.projects.put(project)

  return {
    ports,
    project,
    hero,
    place,
    prop,
    shot,
    shot2,
    episodeId: ep.id,
    sceneId: sc.id,
    reload: () => loadProjection(store, pid),
  }
}
