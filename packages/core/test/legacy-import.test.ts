import { beforeAll, describe, expect, it } from 'vitest'
import { evaluateArtifacts } from '../src/artifacts/staleness.ts'
import { currentVersion } from '../src/domain/index.ts'
import {
  importLegacyBackup,
  LegacyImportError,
  parseLegacyBackup,
} from '../src/export/legacy-import.ts'
import type { LegacyBackup } from '../src/export/legacy-import.ts'
import { loadProjection } from '../src/generation/projection.ts'
import { countChars } from '../src/parsers/chapters.ts'
import { episodeShots } from '../src/pipeline/entities.ts'
import { locateMedia, makePipelineEnv } from './fakes.ts'
import type { MediaEnv, PipelineEnv } from './fakes.ts'

// 导入不需要 ffmpeg；没有时用占位。
let media: MediaEnv
beforeAll(async () => {
  media =
    (await locateMedia()) ??
    ({ bins: { ffmpeg: 'ffmpeg', source: 'path' }, caps: {} } as unknown as MediaEnv)
})

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const png = (w: number, h: number, salt = 0) =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...be32(w),
    ...be32(h),
    8,
    6,
    0,
    0,
    0,
    salt,
    salt + 1,
  ])
const mp4 = (salt: number) =>
  new Uint8Array([
    0,
    0,
    0,
    24,
    0x66,
    0x74,
    0x79,
    0x70,
    0x6d,
    0x70,
    0x34,
    0x32,
    salt,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
  ])
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')

/** 按 v0.4 `exportBackup` 的格式造一份备份（`dramai-backup` 版本 1）。 */
function legacySample(): { json: string; backup: LegacyBackup; blobs: Record<string, Uint8Array> } {
  const blobs: Record<string, Uint8Array> = {
    'a-ref-locked': png(512, 768, 1),
    'a-ref-open': png(300, 300, 2),
    'a-img-1': png(1024, 576, 3),
    'a-img-2': png(1024, 576, 4),
    'a-vid-1': mp4(5),
    'a-mat-img': png(640, 480, 6),
  }
  const asset = (id: string, kind: string, mimeType: string, projectId = 'proj-1') => ({
    id,
    projectId,
    kind,
    mimeType,
    width: 1,
    height: 1,
    createdAt: 1_700_000_000_000,
    blobBase64: b64(blobs[id]),
  })
  const backup = {
    format: 'dramai-backup',
    version: 1,
    exportedAt: 1_700_000_100_000,
    appVersion: '0.4.1',
    projects: [
      {
        id: 'proj-1',
        title: '长安夜',
        summary: '一夜之间的故事',
        style: '少年热血漫风格',
        status: 'done',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_050_000,
      },
      {
        id: 'proj-2',
        title: '空项目',
        status: 'draft',
        createdAt: 1_700_000_001_000,
        updatedAt: 1_700_000_001_000,
      },
    ],
    characters: [
      {
        id: 'ch-1',
        projectId: 'proj-1',
        name: '萧云',
        description: '少年剑客，红袍',
        role: 'protagonist',
        referenceAssetId: 'a-ref-locked',
        locked: true,
        createdAt: 1_700_000_000_100,
      },
      {
        id: 'ch-2',
        projectId: 'proj-1',
        name: '老管家',
        description: '白发老人',
        role: 'supporting',
        referenceAssetId: 'a-ref-open',
        locked: false,
        createdAt: 1_700_000_000_200,
      },
      {
        id: 'ch-3',
        projectId: 'proj-1',
        name: '萧云',
        description: '同名的另一个人',
        role: 'extra',
        locked: false,
        createdAt: 1_700_000_000_300,
      },
    ],
    materials: [
      {
        id: 'm-1',
        projectId: 'proj-1',
        kind: 'txt',
        name: '故事.txt',
        text: '第一章 夜\n他走进长安城。\n第二章 晨\n天亮了。',
        createdAt: 1_700_000_000_000,
      },
      {
        id: 'm-2',
        projectId: 'proj-1',
        kind: 'image',
        name: '参考.png',
        text: '',
        assetId: 'a-mat-img',
        createdAt: 1_700_000_000_000,
      },
    ],
    storyboards: [
      {
        id: 's-3',
        projectId: 'proj-1',
        sequence: 3,
        sceneText: '黎明，城门缓缓打开。',
        narration: '天亮了',
        durationSec: 4,
        characterIds: [],
        status: 'pending',
      },
      {
        id: 's-1',
        projectId: 'proj-1',
        sequence: 1,
        sceneText: '萧云踏入长安城。',
        narration: '他来了',
        imagePrompt: 'a young swordsman in red robe, anime style',
        characterIds: ['ch-1'],
        durationSec: 6,
        imageAssetId: 'a-img-1',
        videoAssetId: 'a-vid-1',
        cameraParams: { movement: 'dolly_in', speed: 'slow' },
        status: 'video-ready',
      },
      {
        id: 's-2',
        projectId: 'proj-1',
        sequence: 2,
        sceneText: '老管家在门口等他。',
        imagePrompt: 'old butler at the gate',
        characterIds: ['ch-2', 'ch-1'],
        imageAssetId: 'a-img-2',
        pendingVideoTask: { taskId: 't-9', apiFlavor: 'aliyun', submittedAt: 1 },
        status: 'image-ready',
      },
      {
        id: 's-4',
        projectId: 'proj-1',
        sequence: 4,
        sceneText: '失败的镜头。',
        characterIds: ['ch-3'],
        status: 'failed',
      },
    ],
    assets: ['a-ref-locked', 'a-ref-open', 'a-img-1', 'a-img-2', 'a-mat-img']
      .map((id) => asset(id, 'image', 'image/png'))
      .concat(asset('a-vid-1', 'video', 'video/mp4')),
    generations: [{ id: 'g-1' }, { id: 'g-2' }],
  }
  return { json: JSON.stringify(backup), backup: backup as unknown as LegacyBackup, blobs }
}

const importProject = async (env: PipelineEnv, json: string, id = 'proj-1') => {
  const summary = await importLegacyBackup(env.deps, json, { projectIds: [id] })
  return { summary, projectId: summary.projects[0].projectId }
}

describe('v0.4 backup import: flat shot list → hierarchy', () => {
  it('lands in project → episode 1 → scene 1 → shots ordered by sequence', async () => {
    const env = await makePipelineEnv(media)
    const { json } = legacySample()
    const { summary, projectId } = await importProject(env, json)
    expect(summary.projects[0]).toMatchObject({
      name: '长安夜',
      episodes: 1,
      shots: 4,
      assets: 3,
      materials: 2,
      images: 2,
      videos: 1,
    })
    expect(summary.droppedGenerations).toBe(2)
    expect(summary.droppedPendingVideoTasks).toBe(1)

    const project = (await env.deps.store.projects.get(projectId))!
    expect(project).toMatchObject({
      name: '长安夜',
      summary: '一夜之间的故事',
      aspectRatio: '16:9', // 旧版合成写死 1280×720
      narrationDelivery: 'post', // 旧版没有配音，旁白留给剪映
      importedFrom: { format: 'dramai-backup', version: 1, legacyProjectId: 'proj-1' },
    })
    expect(project.style).toMatchObject({ source: 'custom', description: '少年热血漫风格' })
    expect(project.style.imageKeywords).toContain('shonen manga') // 命中预设名，借用关键词
    expect(project.episodeOrder).toHaveLength(1)
    const episode = (await env.deps.store.episodes.get(project.episodeOrder[0]))!
    expect(episode).toMatchObject({ title: '第一集', number: 1 })
    expect(episode.sceneOrder).toHaveLength(1)
    const scene = (await env.deps.store.scenes.get(episode.sceneOrder[0]))!
    expect(scene.shotOrder).toHaveLength(4)
    const shots = await episodeShots(env.deps.store, episode.id)
    expect(shots.map((s) => s.scriptExcerpt)).toEqual([
      '萧云踏入长安城。',
      '老管家在门口等他。',
      '黎明，城门缓缓打开。',
      '失败的镜头。',
    ]) // 按 sequence，而不是文件里的顺序
    expect(shots.map((s) => s.number)).toEqual([1, 2, 3, 4])
    expect(project.counters).toMatchObject({ episode: 1, scene: 1, shot: 4, asset: 3, material: 2 })
  })

  it('maps shot fields: narration, prompt, duration, camera movement, stages and the failed stage', async () => {
    const env = await makePipelineEnv(media)
    const { json } = legacySample()
    const { projectId } = await importProject(env, json)
    const shots = await env.deps.store.shots.listByProject(projectId)
    const by = Object.fromEntries(shots.map((s) => [s.scriptExcerpt.slice(0, 4), s]))
    const s1 = by['萧云踏入']
    expect(s1).toMatchObject({
      narration: '他来了',
      durationSec: 6,
      movement: 'dolly_in',
      ready: true,
      title: '镜头 1',
    })
    expect(s1.prompts).toEqual({
      keyFrame: 'a young swordsman in red robe, anime style',
      firstFrame: 'a young swordsman in red robe, anime style',
    })
    expect(s1.stages).toEqual({ image: 'succeeded', video: 'succeeded', audio: 'pending' })
    expect(by['老管家在'].durationSec).toBe(5) // 缺省 5 秒
    expect(by['老管家在'].movement).toBe('static')
    expect(by['老管家在'].video.currentVersionId).toBeNull() // 待处理的视频任务不导入
    expect(by['失败的镜'].failedStage).toBe('image')
    expect(by['失败的镜'].stages.image).toBe('failed')
    expect(by['黎明，城'].stages.image).toBe('pending')
  })

  it('files come across byte for byte as the first version of each slot', async () => {
    const env = await makePipelineEnv(media)
    const { json, blobs } = legacySample()
    const { projectId } = await importProject(env, json)
    const s1 = (await env.deps.store.shots.listByProject(projectId)).find((s) =>
      s.scriptExcerpt.startsWith('萧云踏入'),
    )!
    const img = currentVersion(s1.image)!
    const vid = currentVersion(s1.video)!
    expect(s1.image.versions).toHaveLength(1)
    expect(await env.ports.files.get(projectId, img.file.path)).toEqual(blobs['a-img-1'])
    expect(await env.ports.files.get(projectId, vid.file.path)).toEqual(blobs['a-vid-1'])
    expect(img.facts).toMatchObject({ width: 1024, height: 576 })
    expect(img.prompt).toBe('a young swordsman in red robe, anime style')
    expect(vid.file.mime).toBe('video/mp4')
  })

  it('characters become assets; a LOCKED reference is the uploaded sheet, an unlocked one is just an original (cannot stand in for the sheet)', async () => {
    const env = await makePipelineEnv(media)
    const { json, blobs } = legacySample()
    const { projectId } = await importProject(env, json)
    const assets = (await env.deps.store.assets.listByProject(projectId)).sort(
      (a, b) => a.number - b.number,
    )
    expect(assets.map((a) => a.name)).toEqual(['萧云', '老管家', '萧云 (2)']) // 重名自动消歧
    const [locked, open, bare] = assets
    expect(locked.kind).toBe('character')
    expect(locked.appearance).toBe('少年剑客，红袍')
    expect(locked.sheet.versions).toHaveLength(1)
    expect(locked.sheet.versions[0].source).toBe('uploaded')
    expect(locked.originals).toEqual([])
    expect(await env.ports.files.get(projectId, locked.sheet.versions[0].file.path)).toEqual(
      blobs['a-ref-locked'],
    )
    expect(open.sheet.currentVersionId).toBeNull()
    expect(open.originals).toHaveLength(1)
    expect(await env.ports.files.get(projectId, open.originals[0].path)).toEqual(
      blobs['a-ref-open'],
    )
    expect(bare.sheet.currentVersionId).toBeNull()
    expect(bare.originals).toEqual([])
    // 引用表来自 characterIds
    const shots = await env.deps.store.shots.listByProject(projectId)
    const refsOf = async (prefix: string) =>
      (
        await env.deps.store.shotRefs.listByShot(
          shots.find((s) => s.scriptExcerpt.startsWith(prefix))!.id,
        )
      )
        .map((r) => r.assetId)
        .sort()
    expect(await refsOf('萧云踏入')).toEqual([locked.id])
    expect(await refsOf('老管家在')).toEqual([open.id, locked.id].sort())
    expect(await refsOf('黎明，城')).toEqual([])
  })

  it('imports materials: text is kept whole with chapters counted; images keep their file', async () => {
    const env = await makePipelineEnv(media)
    const { json, blobs } = legacySample()
    const { projectId } = await importProject(env, json)
    const mats = await env.deps.store.materials.listByProject(projectId)
    expect(mats.map((m) => [m.name, m.kind, m.number])).toEqual([
      ['故事.txt', 'txt', 1],
      ['参考.png', 'image', 2],
    ])
    expect(mats[0]).toMatchObject({
      charCount: countChars('第一章 夜\n他走进长安城。\n第二章 晨\n天亮了。'),
      text: expect.stringContaining('他走进长安城'),
    })
    expect(mats[0].chapters).toHaveLength(2)
    expect(await env.ports.files.get(projectId, mats[1].file!.path)).toEqual(blobs['a-mat-img'])
    expect(mats[1].size).toEqual({ width: 640, height: 480 })
  })

  it('registers usable artifacts as current (A18); a shot whose references have no sheet cannot be evaluated and is skipped', async () => {
    const env = await makePipelineEnv(media)
    const { json } = legacySample()
    const { summary, projectId } = await importProject(env, json)
    const reports = evaluateArtifacts(await loadProjection(env.deps.store, projectId))
    const shots = await env.deps.store.shots.listByProject(projectId)
    const s1 = shots.find((s) => s.scriptExcerpt.startsWith('萧云踏入'))!
    const s2 = shots.find((s) => s.scriptExcerpt.startsWith('老管家在'))!
    const assets = await env.deps.store.assets.listByProject(projectId)
    const locked = assets.find((a) => a.name === '萧云')!
    expect(reports.get(`asset_sheet:${locked.id}`)!.status).toBe('current') // 用户上传的设定图
    expect(reports.get(`shot_image:${s1.id}`)!.status).toBe('current') // 只引用有设定图的角色
    expect(reports.get(`shot_video:${s1.id}`)!.status).toBe('current')
    // 第 2 镜引用了“老管家”（没设定图，只有原图）：依据算不出 → 被拦下，并且没有登记
    expect(reports.get(`shot_image:${s2.id}`)!.status).toBe('blocked')
    expect(await env.deps.store.artifacts.get(projectId, `shot_image:${s2.id}`)).toBeUndefined()
    expect(summary.projects[0]).toMatchObject({ artifactsRegistered: 3, artifactsSkipped: 1 })
    // 文件仍然可用——只是不能在不补设定图的情况下重新生成
    expect(currentVersion(s2.image)).toBeDefined()
    expect(
      (await env.deps.store.episodes.get(
        (await env.deps.store.projects.get(projectId))!.episodeOrder[0],
      ))!.status,
    ).toBe('producing') // 导入的镜头全部 ready，还没有成片
  })

  it('a second, empty project imports cleanly', async () => {
    const env = await makePipelineEnv(media)
    const { json } = legacySample()
    const summary = await importLegacyBackup(env.deps, json, { projectIds: ['proj-2'] })
    expect(summary.projects[0]).toMatchObject({ name: '空项目', shots: 0, assets: 0 })
    const p = (await env.deps.store.projects.get(summary.projects[0].projectId))!
    expect(p.style.source).toBe('none')
  })
})

describe('v0.4 backup import: safety', () => {
  it('imports every project by default, never touching existing ones, and skips re-imports of the same legacy project', async () => {
    const env = await makePipelineEnv(media)
    const { json } = legacySample()
    const before = (await env.deps.store.projects.list()).length
    const first = await importLegacyBackup(env.deps, json)
    expect(first.projects).toHaveLength(2)
    expect((await env.deps.store.projects.list()).length).toBe(before + 2)
    const again = await importLegacyBackup(env.deps, json)
    expect(again.projects).toEqual([])
    expect(again.skipped).toEqual([
      { legacyId: 'proj-1', reason: 'ALREADY_IMPORTED' },
      { legacyId: 'proj-2', reason: 'ALREADY_IMPORTED' },
    ])
    const dup = await importLegacyBackup(env.deps, json, {
      projectIds: ['proj-1'],
      allowDuplicate: true,
    })
    expect(dup.projects).toHaveLength(1)
    expect(dup.projects[0].projectId).not.toBe(first.projects[0].projectId)
    expect(new Set([first.projects[0].projectId, dup.projects[0].projectId]).size).toBe(2)
  })

  it('rejects things that are not a v0.4 backup, or are from a newer version', () => {
    expect(() => parseLegacyBackup('不是 json')).toThrow(LegacyImportError)
    expect(() =>
      parseLegacyBackup(JSON.stringify({ format: 'something-else', version: 1 })),
    ).toThrow(/dramai-backup/)
    expect(() =>
      parseLegacyBackup(JSON.stringify({ format: 'dramai-backup', version: 2 })),
    ).toThrow(/高于支持的最高版本/)
    expect(() => parseLegacyBackup(JSON.stringify({ format: 'dramai-backup' }))).toThrow(
      LegacyImportError,
    )
    expect(
      parseLegacyBackup(JSON.stringify({ format: 'dramai-backup', version: 1 })).projects,
    ).toEqual([]) // 缺字段的表按空处理
  })

  it('ignores camera movements it does not know and blobs that are missing, without failing the import', async () => {
    const env = await makePipelineEnv(media)
    const { backup } = legacySample()
    backup.storyboards[1].cameraParams = { movement: 'teleport' }
    backup.assets = backup.assets.filter((a) => a.id !== 'a-img-1')
    const summary = await importLegacyBackup(env.deps, backup, { projectIds: ['proj-1'] })
    const shots = await env.deps.store.shots.listByProject(summary.projects[0].projectId)
    const s1 = shots.find((s) => s.scriptExcerpt.startsWith('萧云踏入'))!
    expect(s1.movement).toBe('static')
    expect(s1.image.currentVersionId).toBeNull()
    expect(s1.stages.image).toBe('pending')
  })
})

describe('round trip: v0.4 → new model → v0.4-shaped backup → new model', () => {
  /** 模拟 v0.4 `exportBackup` 会从新模型里能导出的东西（扁平镜头、角色、素材、blob）。 */
  async function toLegacy(env: PipelineEnv, projectId: string): Promise<LegacyBackup> {
    const p = (await env.deps.store.projects.get(projectId))!
    const assetsOut: LegacyBackup['assets'] = []
    const blob = async (path: string, mime: string, kind: string) => {
      const id = `x-${assetsOut.length}`
      assetsOut.push({
        id,
        projectId: 'rt',
        kind,
        mimeType: mime,
        createdAt: 1,
        blobBase64: b64(await env.ports.files.get(projectId, path)),
      })
      return id
    }
    const chars: LegacyBackup['characters'] = []
    const assets = (await env.deps.store.assets.listByProject(projectId)).sort(
      (a, b) => a.number - b.number,
    )
    for (const a of assets) {
      const sheet = currentVersion(a.sheet)
      chars.push({
        id: `c-${a.number}`,
        projectId: 'rt',
        name: a.name,
        description: a.appearance,
        role: 'supporting',
        referenceAssetId: sheet
          ? await blob(sheet.file.path, sheet.file.mime, 'image')
          : a.originals[0]
            ? await blob(a.originals[0].path, a.originals[0].mime, 'image')
            : undefined,
        locked: Boolean(sheet),
        createdAt: a.number,
      })
    }
    const idOf = new Map(assets.map((a) => [a.id, `c-${a.number}`]))
    const sb: LegacyBackup['storyboards'] = []
    const shots = await episodeShots(env.deps.store, p.episodeOrder[0])
    let seq = 0
    for (const s of shots) {
      seq++
      const img = currentVersion(s.image)
      const vid = currentVersion(s.video)
      sb.push({
        id: `s-${seq}`,
        projectId: 'rt',
        sequence: seq,
        sceneText: s.scriptExcerpt,
        narration: s.narration,
        imagePrompt: s.prompts.keyFrame,
        characterIds: (await env.deps.store.shotRefs.listByShot(s.id)).map(
          (r) => idOf.get(r.assetId)!,
        ),
        durationSec: s.durationSec,
        cameraParams: { movement: s.movement },
        imageAssetId: img ? await blob(img.file.path, img.file.mime, 'image') : undefined,
        videoAssetId: vid ? await blob(vid.file.path, vid.file.mime, 'video') : undefined,
        status: s.failedStage ? 'failed' : vid ? 'video-ready' : img ? 'image-ready' : 'pending',
      })
    }
    const mats = await env.deps.store.materials.listByProject(projectId)
    return {
      format: 'dramai-backup',
      version: 1,
      projects: [
        {
          id: 'rt',
          title: p.name,
          summary: p.summary,
          style: p.style.description,
          createdAt: p.createdAt,
        },
      ],
      characters: chars,
      materials: mats.map((m) => ({
        id: m.id,
        projectId: 'rt',
        kind: m.kind,
        name: m.name,
        text: m.text,
        createdAt: 1,
      })),
      storyboards: sb,
      assets: assetsOut,
      generations: [],
    }
  }

  it('what comes out of the new model re-imports to the same content', async () => {
    const env = await makePipelineEnv(media)
    const { json, blobs } = legacySample()
    const first = await importProject(env, json)
    const exported = await toLegacy(env, first.projectId)
    const second = await importLegacyBackup(env.deps, exported)
    const a = first.projectId
    const b = second.projects[0].projectId

    const shape = async (pid: string) => {
      const p = (await env.deps.store.projects.get(pid))!
      const shots = await episodeShots(env.deps.store, p.episodeOrder[0])
      const assets = (await env.deps.store.assets.listByProject(pid)).sort(
        (x, y) => x.number - y.number,
      )
      return {
        name: p.name,
        summary: p.summary,
        style: p.style.description,
        shots: await Promise.all(
          shots.map(async (s) => ({
            text: s.scriptExcerpt,
            narration: s.narration,
            prompt: s.prompts.keyFrame,
            duration: s.durationSec,
            movement: s.movement,
            image: currentVersion(s.image)
              ? Buffer.from(
                  await env.ports.files.get(pid, currentVersion(s.image)!.file.path),
                ).toString('hex')
              : null,
            video: currentVersion(s.video)
              ? Buffer.from(
                  await env.ports.files.get(pid, currentVersion(s.video)!.file.path),
                ).toString('hex')
              : null,
            refs: (await env.deps.store.shotRefs.listByShot(s.id))
              .map((r) => assets.findIndex((x) => x.id === r.assetId))
              .sort(),
          })),
        ),
        assets: await Promise.all(
          assets.map(async (x) => ({
            name: x.name,
            appearance: x.appearance,
            sheet: currentVersion(x.sheet)
              ? Buffer.from(
                  await env.ports.files.get(pid, currentVersion(x.sheet)!.file.path),
                ).toString('hex')
              : null,
            original: x.originals[0]
              ? Buffer.from(await env.ports.files.get(pid, x.originals[0].path)).toString('hex')
              : null,
          })),
        ),
        materials: (await env.deps.store.materials.listByProject(pid)).map((m) => [m.name, m.text]),
      }
    }
    expect(await shape(b)).toEqual(await shape(a))
    // 内容真的在里面（不是两个空壳相等）
    const s = await shape(b)
    expect(s.shots).toHaveLength(4)
    expect(s.shots[0].image).toBe(Buffer.from(blobs['a-img-1']).toString('hex'))
    expect(s.assets[0].sheet).toBe(Buffer.from(blobs['a-ref-locked']).toString('hex'))
  })
})
