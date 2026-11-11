import { AsyncLocalStorage } from 'node:async_hooks'
import type {
  ArtifactRecord,
  Asset,
  EntityCandidate,
  Episode,
  InsertJobResult,
  Job,
  JobFilter,
  Material,
  Project,
  ProviderConfig,
  Scene,
  Shot,
  ShotAssetRef,
  Store,
  TimelineDocument,
} from '@dramai/core'
import type { Db, SqlValue } from './db.ts'
import { openNodeSqlite } from './db.ts'
import {
  DOC_TARGET_VERSIONS,
  DocMigrationError,
  migrateSchema,
  SCHEMA_MIGRATIONS,
  upgradeDoc,
} from './migrations.ts'
import type { DocMigrations, EntityName } from './migrations.ts'

export interface ProviderRepo {
  list(): Promise<ProviderConfig[]>
  get(id: string): Promise<ProviderConfig | undefined>
  put(config: ProviderConfig): Promise<void>
  delete(id: string): Promise<void>
}

export interface SettingsRepo {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

export interface RepairEntry {
  entity: string
  id: string
  projectId?: string
  error: string
  at: number
}

/** `Store`（core 的端口）加上服务自己用的几个仓库。 */
export interface ServerStore extends Store {
  providers: ProviderRepo
  settings: SettingsRepo
  /** 物理删除一个项目的全部行（文件夹由调用方删）。 */
  purgeProject(projectId: string): Promise<void>
  /** 启动时升级文档失败的条目（需要修复）。 */
  repairNeeded(): Promise<RepairEntry[]>
  close(): void
}

export interface SqliteStoreOptions {
  /** 测试用：覆盖文档目标版本 / 文档迁移 / 表结构迁移。 */
  targetVersions?: Record<EntityName, number>
  docMigrations?: DocMigrations
  schemaMigrations?: Array<(db: Db) => void>
  now?: () => number
}

/** 串行化：同一连接上，一个事务打开期间，其他异步上下文的读写要排队，不能混进事务里。 */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(fn, fn)
    this.tail = next.catch(() => {})
    return next
  }
}

const j = (v: unknown) => JSON.stringify(v)

export async function openSqliteStore(
  path: string,
  options: SqliteStoreOptions = {},
): Promise<ServerStore> {
  const db = await openNodeSqlite(path)
  try {
    migrateSchema(db, options.schemaMigrations ?? SCHEMA_MIGRATIONS)
    const store = new SqliteStore(db, options)
    store.upgradeAllDocs()
    return store
  } catch (err) {
    db.close()
    throw err
  }
}

class SqliteStore implements ServerStore {
  private readonly mutex = new Mutex()
  private readonly als = new AsyncLocalStorage<true>()
  private readonly targets: Record<EntityName, number>
  private readonly migrations: DocMigrations
  private readonly now: () => number
  private readonly db: Db

  constructor(db: Db, options: SqliteStoreOptions) {
    this.db = db
    this.targets = options.targetVersions ?? DOC_TARGET_VERSIONS
    this.migrations = options.docMigrations ?? {}
    this.now = options.now ?? (() => Date.now())
  }

  // --- 并发控制 ---

  private run<T>(fn: () => T): Promise<T> {
    // 在事务的异步上下文里：直接执行（事务已经持有互斥）。否则排队。
    if (this.als.getStore()) return Promise.resolve().then(fn)
    return this.mutex.run(fn)
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.als.getStore()) return fn(this) // 嵌套：并入外层事务
    return this.mutex.run(async () => {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const result = await this.als.run(true, () => fn(this))
        this.db.exec('COMMIT')
        return result
      } catch (err) {
        this.db.exec('ROLLBACK')
        throw err
      }
    })
  }

  // --- 文档读写 ---

  private read<T>(entity: EntityName, row: { doc: string } | undefined): T | undefined {
    if (!row) return undefined
    return upgradeDoc<T>(
      entity,
      JSON.parse(row.doc) as Record<string, unknown>,
      this.targets,
      this.migrations,
    )
  }

  private readAll<T>(entity: EntityName, rows: Array<{ doc: string }>): T[] {
    return rows.map((r) => this.read<T>(entity, r)!)
  }

  /** 启动时把所有落后版本的文档升级并写回；失败的记入 repair，不影响其他文档。 */
  upgradeAllDocs(): { upgraded: number; failed: number } {
    const tables: Array<[string, EntityName, string]> = [
      ['projects', 'project', 'id'],
      ['episodes', 'episode', 'id'],
      ['scenes', 'scene', 'id'],
      ['shots', 'shot', 'id'],
      ['assets', 'asset', 'id'],
      ['candidates', 'candidate', 'id'],
      ['materials', 'material', 'id'],
      ['timelines', 'timeline', 'id'],
      ['jobs', 'job', 'id'],
    ]
    let upgraded = 0
    let failed = 0
    for (const [table, entity, idCol] of tables) {
      const target = this.targets[entity]
      const rows = this.db.all<{ id: string; doc: string; project_id?: string }>(
        `SELECT ${idCol} AS id, doc, ${table === 'projects' ? 'id' : 'project_id'} AS project_id FROM ${table}
         WHERE COALESCE(json_extract(doc, '$.schemaVersion'), 1) <> ?`,
        target,
      )
      for (const row of rows) {
        try {
          const doc = upgradeDoc<Record<string, unknown>>(
            entity,
            JSON.parse(row.doc),
            this.targets,
            this.migrations,
          )
          this.db.run(`UPDATE ${table} SET doc = ? WHERE ${idCol} = ?`, j(doc), row.id)
          this.db.run('DELETE FROM repair WHERE entity = ? AND id = ?', entity, row.id)
          upgraded++
        } catch (err) {
          failed++
          this.db.run(
            'INSERT OR REPLACE INTO repair (entity, id, project_id, error, at) VALUES (?, ?, ?, ?, ?)',
            entity,
            row.id,
            row.project_id ?? null,
            err instanceof Error ? err.message : String(err),
            this.now(),
          )
        }
      }
    }
    return { upgraded, failed }
  }

  async repairNeeded(): Promise<RepairEntry[]> {
    return this.run(() =>
      this.db
        .all<{
          entity: string
          id: string
          project_id: string | null
          error: string
          at: number
        }>('SELECT * FROM repair ORDER BY at')
        .map((r) => ({
          entity: r.entity,
          id: r.id,
          projectId: r.project_id ?? undefined,
          error: r.error,
          at: r.at,
        })),
    )
  }

  close(): void {
    this.db.close()
  }

  // --- 项目 ---

  projects = {
    get: (id: string) =>
      this.run(() =>
        this.read<Project>('project', this.db.get('SELECT doc FROM projects WHERE id = ?', id)),
      ),
    put: (p: Project) =>
      this.run(() => {
        this.db.run(
          `INSERT INTO projects (id, deleted_at, updated_at, doc) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at, updated_at = excluded.updated_at, doc = excluded.doc`,
          p.id,
          p.deletedAt ?? null,
          p.updatedAt,
          j(p),
        )
      }),
    list: (o?: { includeDeleted?: boolean }) =>
      this.run(() =>
        this.readAll<Project>(
          'project',
          this.db.all<{ doc: string }>(
            `SELECT doc FROM projects ${o?.includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY updated_at DESC, id`,
          ),
        ),
      ),
    delete: (id: string) =>
      this.run(() => void this.db.run('DELETE FROM projects WHERE id = ?', id)),
  }

  // --- 带 project_id 的普通文档表 ---

  private docRepo<T extends { id: string; projectId: string }>(table: string, entity: EntityName) {
    return {
      get: (id: string) =>
        this.run(() =>
          this.read<T>(entity, this.db.get(`SELECT doc FROM ${table} WHERE id = ?`, id)),
        ),
      put: (d: T) =>
        this.run(() => {
          this.db.run(
            `INSERT INTO ${table} (id, project_id, doc) VALUES (?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, doc = excluded.doc`,
            d.id,
            d.projectId,
            j(d),
          )
        }),
      listByProject: (projectId: string) =>
        this.run(() =>
          this.readAll<T>(
            entity,
            this.db.all<{ doc: string }>(
              `SELECT doc FROM ${table} WHERE project_id = ? ORDER BY rowid`,
              projectId,
            ),
          ),
        ),
      delete: (id: string) =>
        this.run(() => void this.db.run(`DELETE FROM ${table} WHERE id = ?`, id)),
    }
  }

  episodes = this.docRepo<Episode>('episodes', 'episode')
  scenes = this.docRepo<Scene>('scenes', 'scene')
  shots = this.docRepo<Shot>('shots', 'shot')

  assets = {
    get: (id: string) =>
      this.run(() =>
        this.read<Asset>('asset', this.db.get('SELECT doc FROM assets WHERE id = ?', id)),
      ),
    put: (a: Asset) =>
      this.run(() => {
        this.db.run(
          `INSERT INTO assets (id, project_id, deleted_at, doc) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, deleted_at = excluded.deleted_at, doc = excluded.doc`,
          a.id,
          a.projectId,
          a.deletedAt ?? null,
          j(a),
        )
      }),
    listByProject: (projectId: string, o?: { includeDeleted?: boolean }) =>
      this.run(() =>
        this.readAll<Asset>(
          'asset',
          this.db.all<{ doc: string }>(
            `SELECT doc FROM assets WHERE project_id = ? ${o?.includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY rowid`,
            projectId,
          ),
        ),
      ),
    delete: (id: string) => this.run(() => void this.db.run('DELETE FROM assets WHERE id = ?', id)),
  }

  shotRefs = {
    listByShot: (shotId: string) =>
      this.run(() =>
        this.refRows(
          this.db.all('SELECT * FROM shot_refs WHERE shot_id = ? ORDER BY position', shotId),
        ),
      ),
    listByProject: (projectId: string) =>
      this.run(() =>
        this.refRows(
          this.db.all(
            'SELECT * FROM shot_refs WHERE project_id = ? ORDER BY shot_id, position',
            projectId,
          ),
        ),
      ),
    replaceForShot: (shotId: string, refs: ShotAssetRef[]) =>
      this.run(() => {
        const shot = this.db.get<{ project_id: string }>(
          'SELECT project_id FROM shots WHERE id = ?',
          shotId,
        )
        const existing = this.db.get<{ project_id: string }>(
          'SELECT project_id FROM shot_refs WHERE shot_id = ? LIMIT 1',
          shotId,
        )
        const projectId = shot?.project_id ?? existing?.project_id ?? ''
        this.db.run('DELETE FROM shot_refs WHERE shot_id = ?', shotId)
        refs.forEach((r, i) => {
          this.db.run(
            'INSERT OR REPLACE INTO shot_refs (shot_id, project_id, asset_id, variant_name, position) VALUES (?, ?, ?, ?, ?)',
            shotId,
            projectId,
            r.assetId,
            r.variantName ?? '',
            i,
          )
        })
      }),
  }

  private refRows(rows: unknown[]): ShotAssetRef[] {
    return (rows as Array<{ shot_id: string; asset_id: string; variant_name: string }>).map(
      (r) => ({
        shotId: r.shot_id,
        assetId: r.asset_id,
        ...(r.variant_name ? { variantName: r.variant_name } : {}),
      }),
    )
  }

  candidates = {
    get: (id: string) =>
      this.run(() =>
        this.read<EntityCandidate>(
          'candidate',
          this.db.get('SELECT doc FROM candidates WHERE id = ?', id),
        ),
      ),
    put: (c: EntityCandidate) =>
      this.run(() => {
        this.db.run(
          `INSERT INTO candidates (id, project_id, status, doc) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, status = excluded.status, doc = excluded.doc`,
          c.id,
          c.projectId,
          c.status,
          j(c),
        )
      }),
    listByProject: (projectId: string) =>
      this.run(() =>
        this.readAll<EntityCandidate>(
          'candidate',
          this.db.all<{ doc: string }>(
            'SELECT doc FROM candidates WHERE project_id = ? ORDER BY rowid',
            projectId,
          ),
        ),
      ),
    delete: (id: string) =>
      this.run(() => void this.db.run('DELETE FROM candidates WHERE id = ?', id)),
  }

  materials = {
    get: (id: string) =>
      this.run(() =>
        this.read<Material>('material', this.db.get('SELECT doc FROM materials WHERE id = ?', id)),
      ),
    put: (m: Material) =>
      this.run(() => {
        this.db.run(
          `INSERT INTO materials (id, project_id, number, doc) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, number = excluded.number, doc = excluded.doc`,
          m.id,
          m.projectId,
          m.number,
          j(m),
        )
      }),
    listByProject: (projectId: string) =>
      this.run(() =>
        this.readAll<Material>(
          'material',
          this.db.all<{ doc: string }>(
            'SELECT doc FROM materials WHERE project_id = ? ORDER BY number',
            projectId,
          ),
        ),
      ),
    delete: (id: string) =>
      this.run(() => void this.db.run('DELETE FROM materials WHERE id = ?', id)),
  }

  timelines = {
    get: (id: string) =>
      this.run(() =>
        this.read<TimelineDocument>(
          'timeline',
          this.db.get('SELECT doc FROM timelines WHERE id = ?', id),
        ),
      ),
    put: (d: TimelineDocument) =>
      this.run(() => {
        this.db.run(
          `INSERT INTO timelines (id, project_id, episode_id, doc) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, episode_id = excluded.episode_id, doc = excluded.doc`,
          d.id,
          d.projectId,
          d.episodeId,
          j(d),
        )
      }),
    listByProject: (projectId: string) =>
      this.run(() =>
        this.readAll<TimelineDocument>(
          'timeline',
          this.db.all<{ doc: string }>(
            'SELECT doc FROM timelines WHERE project_id = ? ORDER BY rowid',
            projectId,
          ),
        ),
      ),
    delete: (id: string) =>
      this.run(() => void this.db.run('DELETE FROM timelines WHERE id = ?', id)),
  }

  artifacts = {
    get: (projectId: string, key: string) =>
      this.run(() =>
        this.read<ArtifactRecord>(
          'artifact',
          this.db.get('SELECT doc FROM artifacts WHERE project_id = ? AND key = ?', projectId, key),
        ),
      ),
    put: (r: ArtifactRecord) =>
      this.run(() => {
        this.db.run(
          `INSERT INTO artifacts (project_id, key, kind, content_hash, doc) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(project_id, key) DO UPDATE SET kind = excluded.kind, content_hash = excluded.content_hash, doc = excluded.doc`,
          r.projectId,
          r.key,
          r.kind,
          r.contentHash,
          j(r),
        )
      }),
    listByProject: (projectId: string) =>
      this.run(() =>
        this.readAll<ArtifactRecord>(
          'artifact',
          this.db.all<{ doc: string }>(
            'SELECT doc FROM artifacts WHERE project_id = ? ORDER BY key',
            projectId,
          ),
        ),
      ),
    delete: (projectId: string, key: string) =>
      this.run(
        () =>
          void this.db.run(
            'DELETE FROM artifacts WHERE project_id = ? AND key = ?',
            projectId,
            key,
          ),
      ),
  }

  // --- 任务 ---

  private jobColumns(job: Job): SqlValue[] {
    return [
      job.projectId,
      job.status,
      job.type,
      job.operation,
      job.shotId ?? null,
      job.batchId ?? null,
      job.dedupeKey ?? null,
      job.exclusiveKey ?? null,
      job.createdAt,
      job.updatedAt,
      j(job),
    ]
  }

  private putJob(job: Job): void {
    this.db.run(
      `INSERT INTO jobs (id, project_id, status, type, operation, shot_id, batch_id, dedupe_key, exclusive_key, created_at, updated_at, doc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, status = excluded.status, type = excluded.type,
         operation = excluded.operation, shot_id = excluded.shot_id, batch_id = excluded.batch_id,
         dedupe_key = excluded.dedupe_key, exclusive_key = excluded.exclusive_key,
         created_at = excluded.created_at, updated_at = excluded.updated_at, doc = excluded.doc`,
      job.id,
      ...this.jobColumns(job),
    )
  }

  private getJob(id: string): Job | undefined {
    return this.read<Job>('job', this.db.get('SELECT doc FROM jobs WHERE id = ?', id))
  }

  jobs = {
    insertIfNoConflict: (job: Job): Promise<InsertJobResult> =>
      this.run(() => {
        // 检查与插入在同一个同步区间内（并且外层有互斥 / 事务）：并发调用只有一个能插入成功。
        const find = (col: 'dedupe_key' | 'exclusive_key', value: string) =>
          this.read<Job>(
            'job',
            this.db.get(
              `SELECT doc FROM jobs WHERE project_id = ? AND ${col} = ? AND status IN ('queued','running') LIMIT 1`,
              job.projectId,
              value,
            ),
          )
        if (job.dedupeKey) {
          const existing = find('dedupe_key', job.dedupeKey)
          if (existing) return { inserted: false, existing, conflict: 'dedupe' } as const
        }
        if (job.exclusiveKey) {
          const existing = find('exclusive_key', job.exclusiveKey)
          if (existing) return { inserted: false, existing, conflict: 'exclusive' } as const
        }
        if (this.db.get('SELECT 1 AS x FROM jobs WHERE id = ?', job.id))
          throw new Error(`duplicate job id ${job.id}`)
        this.putJob(job)
        return { inserted: true, job } as const
      }),
    insert: (job: Job) =>
      this.run(() => {
        if (this.db.get('SELECT 1 AS x FROM jobs WHERE id = ?', job.id))
          throw new Error(`duplicate job id ${job.id}`)
        this.putJob(job)
      }),
    get: (id: string) => this.run(() => this.getJob(id)),
    transition: (id: string, from: Array<Job['status']>, patch: Partial<Job>) =>
      this.run(() => {
        const cur = this.getJob(id)
        if (!cur || !from.includes(cur.status)) return undefined
        const next = { ...cur, ...patch } as Job
        this.putJob(next)
        return next
      }),
    patch: (id: string, patch: Partial<Job>) =>
      this.run(() => {
        const cur = this.getJob(id)
        if (!cur) return undefined
        const next = { ...cur, ...patch } as Job
        this.putJob(next)
        return next
      }),
    list: (f?: JobFilter) =>
      this.run(() => {
        const where: string[] = []
        const params: SqlValue[] = []
        if (f?.projectId) {
          where.push('project_id = ?')
          params.push(f.projectId)
        }
        if (f?.status) {
          const list = Array.isArray(f.status) ? f.status : [f.status]
          where.push(`status IN (${list.map(() => '?').join(',')})`)
          params.push(...list)
        }
        if (f?.shotId) {
          where.push('shot_id = ?')
          params.push(f.shotId)
        }
        if (f?.batchId) {
          where.push('batch_id = ?')
          params.push(f.batchId)
        }
        return this.readAll<Job>(
          'job',
          this.db.all<{ doc: string }>(
            `SELECT doc FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, id`,
            ...params,
          ),
        )
      }),
  }

  // --- 服务商 / 设置 ---

  providers: ProviderRepo = {
    list: () =>
      this.run(() =>
        this.db
          .all<{ doc: string }>('SELECT doc FROM providers ORDER BY position, id')
          .map((r) => JSON.parse(r.doc) as ProviderConfig),
      ),
    get: (id) =>
      this.run(() => {
        const r = this.db.get<{ doc: string }>('SELECT doc FROM providers WHERE id = ?', id)
        return r ? (JSON.parse(r.doc) as ProviderConfig) : undefined
      }),
    put: (c) =>
      this.run(() => {
        const pos =
          this.db.get<{ position: number }>('SELECT position FROM providers WHERE id = ?', c.id)
            ?.position ??
          (this.db.get<{ m: number | null }>('SELECT MAX(position) AS m FROM providers')?.m ?? -1) +
            1
        this.db.run(
          'INSERT INTO providers (id, position, doc) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc',
          c.id,
          pos,
          j(c),
        )
      }),
    delete: (id) => this.run(() => void this.db.run('DELETE FROM providers WHERE id = ?', id)),
  }

  settings: SettingsRepo = {
    get: <T>(key: string) =>
      this.run(() => {
        const r = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)
        return r ? (JSON.parse(r.value) as T) : undefined
      }),
    set: (key, value) =>
      this.run(
        () =>
          void this.db.run(
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            key,
            j(value),
          ),
      ),
  }

  async purgeProject(projectId: string): Promise<void> {
    await this.transaction(async () => {
      for (const t of [
        'episodes',
        'scenes',
        'shots',
        'assets',
        'shot_refs',
        'candidates',
        'materials',
        'timelines',
        'artifacts',
        'jobs',
        'repair',
      ]) {
        const col = t === 'repair' ? 'project_id' : 'project_id'
        this.db.run(`DELETE FROM ${t} WHERE ${col} = ?`, projectId)
      }
      this.db.run('DELETE FROM projects WHERE id = ?', projectId)
    })
  }
}

export { DocMigrationError }
