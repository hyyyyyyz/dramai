import { SCHEMA_VERSIONS } from '@dramai/core'
import type { Db } from './db.ts'

/**
 * 两层迁移：
 *
 * 1. **表结构迁移**（`SCHEMA_MIGRATIONS`）：按 `PRAGMA user_version` 逐步执行，每一步在一个事务里；
 *    只能追加，不改已发布的步骤。
 * 2. **文档迁移**（`DocMigrations`）：每份存下来的文档带 `schemaVersion`，读取 / 启动时按步升级到当前版本。
 *    升级失败的文档记入 `repair` 表（“需要修复”），**不静默损坏**：读取它会得到明确的错误，而不是半截数据。
 *    文档比当前版本新（被更新版本的 dramai 写过）则拒绝读取，提示升级。
 */

export const SCHEMA_MIGRATIONS: Array<(db: Db) => void> = [
  // v1：初始表结构。
  (db) => {
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, deleted_at INTEGER, updated_at INTEGER NOT NULL, doc TEXT NOT NULL
      );
      CREATE TABLE episodes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, doc TEXT NOT NULL);
      CREATE INDEX episodes_project ON episodes(project_id);
      CREATE TABLE scenes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, doc TEXT NOT NULL);
      CREATE INDEX scenes_project ON scenes(project_id);
      CREATE TABLE shots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, doc TEXT NOT NULL);
      CREATE INDEX shots_project ON shots(project_id);
      CREATE TABLE assets (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, deleted_at INTEGER, doc TEXT NOT NULL
      );
      CREATE INDEX assets_project ON assets(project_id);
      CREATE TABLE shot_refs (
        shot_id TEXT NOT NULL, project_id TEXT NOT NULL, asset_id TEXT NOT NULL,
        variant_name TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL,
        PRIMARY KEY (shot_id, asset_id, variant_name)
      );
      CREATE INDEX shot_refs_project ON shot_refs(project_id);
      CREATE INDEX shot_refs_asset ON shot_refs(asset_id);
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, doc TEXT NOT NULL
      );
      CREATE INDEX candidates_project ON candidates(project_id, status);
      CREATE TABLE materials (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, number INTEGER NOT NULL, doc TEXT NOT NULL
      );
      CREATE INDEX materials_project ON materials(project_id);
      CREATE TABLE timelines (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, episode_id TEXT NOT NULL, doc TEXT NOT NULL
      );
      CREATE INDEX timelines_project ON timelines(project_id);
      CREATE TABLE artifacts (
        project_id TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, content_hash TEXT NOT NULL,
        doc TEXT NOT NULL, PRIMARY KEY (project_id, key)
      );
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, type TEXT NOT NULL,
        operation TEXT NOT NULL, shot_id TEXT, batch_id TEXT, dedupe_key TEXT, exclusive_key TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, doc TEXT NOT NULL
      );
      CREATE INDEX jobs_status ON jobs(status, created_at);
      CREATE INDEX jobs_project ON jobs(project_id, status);
      CREATE INDEX jobs_shot ON jobs(shot_id);
      -- 在途任务的去重 / 互斥由唯一索引兜底（insertIfNoConflict 先在事务里检查，索引是最后一道闸）。
      CREATE UNIQUE INDEX jobs_inflight_dedupe ON jobs(project_id, dedupe_key)
        WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');
      CREATE UNIQUE INDEX jobs_inflight_exclusive ON jobs(project_id, exclusive_key)
        WHERE exclusive_key IS NOT NULL AND status IN ('queued', 'running');
      CREATE TABLE providers (id TEXT PRIMARY KEY, position INTEGER NOT NULL, doc TEXT NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE repair (
        entity TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT, error TEXT NOT NULL, at INTEGER NOT NULL,
        PRIMARY KEY (entity, id)
      );
    `)
  },
]

export const CURRENT_SCHEMA_VERSION = SCHEMA_MIGRATIONS.length

export class SchemaTooNewError extends Error {
  constructor(found: number, supported: number) {
    super(
      `数据库版本 ${found} 比当前程序支持的 ${supported} 新：它是被更新版本的 dramai 写过的，请升级后再打开。`,
    )
    this.name = 'SchemaTooNewError'
  }
}

export function migrateSchema(
  db: Db,
  migrations: Array<(db: Db) => void> = SCHEMA_MIGRATIONS,
): { from: number; to: number } {
  const row = db.get<{ user_version: number }>('PRAGMA user_version')
  const from = row?.user_version ?? 0
  if (from > migrations.length) throw new SchemaTooNewError(from, migrations.length)
  for (let v = from; v < migrations.length; v++) {
    db.exec('BEGIN IMMEDIATE')
    try {
      migrations[v](db)
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(
        `数据库迁移到 v${v + 1} 失败：${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }
  return { from, to: migrations.length }
}

// === 文档迁移 ===

export type EntityName =
  | 'project'
  | 'episode'
  | 'scene'
  | 'shot'
  | 'asset'
  | 'candidate'
  | 'material'
  | 'timeline'
  | 'artifact'
  | 'job'

export const DOC_TARGET_VERSIONS: Record<EntityName, number> = { ...SCHEMA_VERSIONS }

export interface DocMigration {
  /** 从这个版本升级到 from + 1。 */
  from: number
  up: (doc: Record<string, unknown>) => Record<string, unknown>
}
export type DocMigrations = Partial<Record<EntityName, DocMigration[]>>

export class DocMigrationError extends Error {
  readonly entity: EntityName
  constructor(entity: EntityName, message: string) {
    super(message)
    this.name = 'DocMigrationError'
    this.entity = entity
  }
}

export function upgradeDoc<T>(
  entity: EntityName,
  raw: Record<string, unknown>,
  targets: Record<EntityName, number> = DOC_TARGET_VERSIONS,
  migrations: DocMigrations = {},
): T {
  let doc = raw
  let version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1
  const target = targets[entity]
  if (version > target) {
    throw new DocMigrationError(
      entity,
      `${entity} 文档版本 ${version} 比当前支持的 ${target} 新，请升级 dramai`,
    )
  }
  while (version < target) {
    const step = migrations[entity]?.find((m) => m.from === version)
    if (!step)
      throw new DocMigrationError(
        entity,
        `${entity} 文档从 v${version} 升级到 v${target} 缺少迁移步骤`,
      )
    doc = { ...step.up(doc), schemaVersion: version + 1 }
    version++
  }
  return doc as T
}
