import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAsset, createEpisode, createProject, createScene, createShot } from '@dramai/core'
import { checkJobRepoContract } from '@dramai/core/testing'
import { openNodeSqlite } from '../src/storage/db.ts'
import {
  migrateSchema,
  SchemaTooNewError,
  SCHEMA_MIGRATIONS,
  DOC_TARGET_VERSIONS,
} from '../src/storage/migrations.ts'
import { openSqliteStore } from '../src/storage/sqlite-store.ts'
import type { ServerStore } from '../src/storage/sqlite-store.ts'

const dirs: string[] = []
const stores: ServerStore[] = []
async function tmp() {
  const d = await mkdtemp(join(tmpdir(), 'dramai-store-'))
  dirs.push(d)
  return d
}
async function open(path: string, options?: Parameters<typeof openSqliteStore>[1]) {
  const s = await openSqliteStore(path, options)
  stores.push(s)
  return s
}
async function fresh() {
  return open(join(await tmp(), 'db.sqlite'))
}
afterEach(async () => {
  for (const s of stores.splice(0)) {
    try {
      s.close()
    } catch {
      /* already closed */
    }
  }
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const seed = (store: ServerStore) => {
  const project = createProject({ id: 'p1', name: '测试', aspectRatio: '9:16', now: 1 })
  const episode = createEpisode({ id: 'e1', projectId: 'p1', number: 1, title: '第一集', now: 1 })
  const scene = createScene({ id: 's1', projectId: 'p1', episodeId: 'e1', number: 1, now: 1 })
  const shot = createShot({ id: 'sh1', projectId: 'p1', sceneId: 's1', number: 1, now: 1 })
  const asset = createAsset({
    id: 'a1',
    projectId: 'p1',
    number: 1,
    kind: 'character',
    name: '小明',
    now: 1,
  })
  return { project, episode, scene, shot, asset, store }
}

describe('SqliteStore', () => {
  it('passes the JobRepo contract (concurrent insertIfNoConflict on real SQLite)', async () => {
    await checkJobRepoContract(async () => (await fresh()).jobs)
  })

  it('round-trips entities and survives reopen', async () => {
    const path = join(await tmp(), 'db.sqlite')
    const a = await open(path)
    const { project, episode, scene, shot, asset } = seed(a)
    await a.projects.put(project)
    await a.episodes.put(episode)
    await a.scenes.put(scene)
    await a.shots.put(shot)
    await a.assets.put(asset)
    await a.shotRefs.replaceForShot('sh1', [
      { shotId: 'sh1', assetId: 'a1', variantName: '冬装' },
      { shotId: 'sh1', assetId: 'a1' },
    ])
    a.close()

    const b = await open(path)
    expect(await b.projects.get('p1')).toEqual(project)
    expect(await b.episodes.listByProject('p1')).toEqual([episode])
    expect(await b.shots.get('sh1')).toEqual(shot)
    expect(await b.assets.listByProject('p1')).toEqual([asset])
    // 引用顺序保留，空变体名还原为缺省
    expect(await b.shotRefs.listByShot('sh1')).toEqual([
      { shotId: 'sh1', assetId: 'a1', variantName: '冬装' },
      { shotId: 'sh1', assetId: 'a1' },
    ])
  })

  it('hides soft-deleted projects/assets unless asked', async () => {
    const s = await fresh()
    const { project, asset } = seed(s)
    await s.projects.put({ ...project, deletedAt: 5 })
    await s.assets.put({ ...asset, deletedAt: 5 })
    expect(await s.projects.list()).toHaveLength(0)
    expect(await s.projects.list({ includeDeleted: true })).toHaveLength(1)
    expect(await s.assets.listByProject('p1')).toHaveLength(0)
    expect(await s.assets.listByProject('p1', { includeDeleted: true })).toHaveLength(1)
  })

  it('rolls back a failed transaction and keeps other callers out of it', async () => {
    const s = await fresh()
    const { project, episode } = seed(s)
    await expect(
      s.transaction(async (tx) => {
        await tx.projects.put(project)
        await tx.episodes.put(episode)
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await s.projects.get('p1')).toBeUndefined()
    expect(await s.episodes.get('e1')).toBeUndefined()

    // 事务打开期间，外部的读要等到提交后才执行（读不到未提交的中间态，也不会混进事务）。
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const writing = s.transaction(async (tx) => {
      await tx.projects.put(project)
      await gate
      await tx.episodes.put(episode)
    })
    const outsideRead = s.episodes.get('e1')
    release()
    await writing
    expect(await outsideRead).toEqual(episode)
  })

  it('nested transactions join the outer one', async () => {
    const s = await fresh()
    const { project } = seed(s)
    await expect(
      s.transaction(async (tx) => {
        await tx.transaction(async (inner) => {
          await inner.projects.put(project)
        })
        throw new Error('outer fails')
      }),
    ).rejects.toThrow()
    expect(await s.projects.get('p1')).toBeUndefined()
  })

  it('purgeProject removes every row of the project and only that', async () => {
    const s = await fresh()
    const a = seed(s)
    for (const [id, name] of [
      ['p1', 'a'],
      ['p2', 'b'],
    ] as const) {
      await s.projects.put({ ...a.project, id, name })
      await s.assets.put({ ...a.asset, id: `a_${id}`, projectId: id })
    }
    await s.purgeProject('p1')
    expect(await s.projects.get('p1')).toBeUndefined()
    expect(await s.assets.listByProject('p1')).toHaveLength(0)
    expect(await s.projects.get('p2')).toBeDefined()
    expect(await s.assets.listByProject('p2')).toHaveLength(1)
  })

  it('stores providers (ordered) and settings', async () => {
    const s = await fresh()
    await s.providers.put({ id: 'x', name: 'X' } as never)
    await s.providers.put({ id: 'a', name: 'A' } as never)
    await s.providers.put({ id: 'x', name: 'X2' } as never)
    expect((await s.providers.list()).map((p) => p.id)).toEqual(['x', 'a'])
    expect(await s.providers.get('x')).toMatchObject({ name: 'X2' })
    await s.providers.delete('x')
    expect(await s.providers.get('x')).toBeUndefined()
    await s.settings.set('k', { a: 1 })
    expect(await s.settings.get('k')).toEqual({ a: 1 })
    await s.settings.set('k', { a: 2 })
    expect(await s.settings.get('k')).toEqual({ a: 2 })
    expect(await s.settings.get('none')).toBeUndefined()
  })
})

describe('migrations', () => {
  it('stamps user_version and is idempotent across reopen', async () => {
    const path = join(await tmp(), 'db.sqlite')
    const db = await openNodeSqlite(path)
    migrateSchema(db, SCHEMA_MIGRATIONS)
    expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(
      SCHEMA_MIGRATIONS.length,
    )
    migrateSchema(db, SCHEMA_MIGRATIONS)
    db.close()
  })

  it('runs only the pending steps, each in its own transaction', async () => {
    const db = await openNodeSqlite(join(await tmp(), 'db.sqlite'))
    migrateSchema(db, [(d) => d.exec('CREATE TABLE t1 (x)')])
    const steps = [
      (d: typeof db) => d.exec('CREATE TABLE t1 (x)'), // 已执行，不应再跑
      (d: typeof db) => d.exec('CREATE TABLE t2 (x)'),
      (d: typeof db) => {
        d.exec('CREATE TABLE t3 (x)')
        throw new Error('step 3 fails')
      },
    ]
    expect(() => migrateSchema(db, steps)).toThrow('step 3 fails')
    // 第 2 步已提交，第 3 步整体回滚
    expect(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(2)
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 't2'")).toBeDefined()
    expect(db.get("SELECT name FROM sqlite_master WHERE name = 't3'")).toBeUndefined()
    db.close()
  })

  it('refuses a database written by a newer version, leaving it untouched', async () => {
    const path = join(await tmp(), 'db.sqlite')
    const db = await openNodeSqlite(path)
    migrateSchema(db, SCHEMA_MIGRATIONS)
    db.exec(`PRAGMA user_version = ${SCHEMA_MIGRATIONS.length + 5}`)
    db.close()
    await expect(openSqliteStore(path)).rejects.toThrow(SchemaTooNewError)
    const again = await openNodeSqlite(path)
    expect(again.get<{ user_version: number }>('PRAGMA user_version')?.user_version).toBe(
      SCHEMA_MIGRATIONS.length + 5,
    )
    again.close()
  })

  it('upgrades old documents on open, writes them back, and records failures in repair', async () => {
    const path = join(await tmp(), 'db.sqlite')
    const a = await open(path)
    const { project, asset } = seed(a)
    await a.projects.put(project)
    await a.assets.put(asset)
    await a.assets.put({ ...asset, id: 'a2', name: '坏的' })
    a.close()

    const targets = { ...DOC_TARGET_VERSIONS, asset: DOC_TARGET_VERSIONS.asset + 1 }
    const b = await open(path, {
      targetVersions: targets,
      docMigrations: {
        asset: [
          {
            from: DOC_TARGET_VERSIONS.asset,
            up: (doc) => {
              if (doc.name === '坏的') throw new Error('cannot upgrade')
              return { ...doc, name: `${String(doc.name)}-v2` }
            },
          },
        ],
      },
    })
    const good = await b.assets.get('a1')
    expect(good).toMatchObject({ name: '小明-v2', schemaVersion: targets.asset })
    const repair = await b.repairNeeded()
    expect(repair).toHaveLength(1)
    expect(repair[0]).toMatchObject({ entity: 'asset', id: 'a2', projectId: 'p1' })
    // 坏文档读取时报错而不是静默返回旧结构
    await expect(b.assets.get('a2')).rejects.toThrow()
  })

  it('refuses documents newer than this build instead of corrupting them', async () => {
    const path = join(await tmp(), 'db.sqlite')
    const a = await open(path)
    const { project } = seed(a)
    await a.projects.put({ ...project, schemaVersion: DOC_TARGET_VERSIONS.project + 3 })
    a.close()
    const b = await open(path)
    await expect(b.projects.get('p1')).rejects.toThrow(/新/)
    expect((await b.repairNeeded()).map((r) => r.id)).toContain('p1')
  })
})
