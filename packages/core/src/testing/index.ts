import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ArtifactRecord } from '../artifacts/types.ts'
import type {
  Material,
  TimelineDocument,
  Asset,
  EntityCandidate,
  Episode,
  Project,
  Scene,
  Shot,
  ShotAssetRef,
} from '../domain/index.ts'
import type { Job } from '../jobs/types.ts'
import type {
  ArtifactRepo,
  AssetRepo,
  CandidateRepo,
  Clock,
  CoreEvent,
  EpisodeRepo,
  EventSink,
  FileInfo,
  FileStore,
  IdGenerator,
  JobFilter,
  JobRepo,
  MaterialRepo,
  ProjectRepo,
  TimelineRepo,
  SceneRepo,
  SecretStore,
  ShotAssetRefRepo,
  ShotRepo,
  Store,
} from '../ports/index.ts'

/**
 * 端口的内存实现，供 core 与 server 的测试使用。读写都做深拷贝，调用方改返回值不会污染存储。
 */

const clone = <T>(v: T): T => structuredClone(v)

export class FakeClock implements Clock {
  private t: number
  constructor(t = 1_700_000_000_000) {
    this.t = t
  }
  now(): number {
    return this.t
  }
  advance(ms: number): void {
    this.t += ms
  }
  set(t: number): void {
    this.t = t
  }
}

export class SequentialIds implements IdGenerator {
  private n = 0
  next(prefix: string): string {
    this.n++
    return `${prefix}_${String(this.n).padStart(4, '0')}`
  }
}

export class MemoryEventSink implements EventSink {
  readonly events: CoreEvent[] = []
  emit(event: CoreEvent): void {
    this.events.push(clone(event))
  }
  ofType<T extends CoreEvent['type']>(type: T): Array<Extract<CoreEvent, { type: T }>> {
    return this.events.filter((e): e is Extract<CoreEvent, { type: T }> => e.type === type)
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>()
  async get(ref: string) {
    return this.map.get(ref)
  }
  async set(ref: string, value: string) {
    this.map.set(ref, value)
  }
  async delete(ref: string) {
    this.map.delete(ref)
  }
  async has(ref: string) {
    return this.map.has(ref)
  }
}

export class MemoryFileStore implements FileStore {
  private readonly files = new Map<string, Uint8Array>()
  private tmpRoot?: string

  private key(projectId: string, path: string) {
    return `${projectId}/${path}`
  }
  async put(projectId: string, path: string, data: Uint8Array): Promise<FileInfo> {
    this.files.set(this.key(projectId, path), new Uint8Array(data))
    return { bytes: data.byteLength, sha256: createHash('sha256').update(data).digest('hex') }
  }
  async get(projectId: string, path: string): Promise<Uint8Array> {
    const f = this.files.get(this.key(projectId, path))
    if (!f) throw new Error(`file not found: ${path}`)
    return new Uint8Array(f)
  }
  async exists(projectId: string, path: string) {
    return this.files.has(this.key(projectId, path))
  }
  async remove(projectId: string, path: string) {
    this.files.delete(this.key(projectId, path))
  }
  /** 把文件物化到临时目录，给 ffmpeg 用。 */
  async localPath(projectId: string, path: string): Promise<string> {
    const data = await this.get(projectId, path)
    this.tmpRoot ??= await mkdtemp(join(tmpdir(), 'dramai-memfs-'))
    const full = join(this.tmpRoot, projectId, path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, data)
    return full
  }
  /** 测试辅助：模拟文件丢失。 */
  lose(projectId: string, path: string): void {
    this.files.delete(this.key(projectId, path))
  }
}

class MemoryTable<T extends { id: string }> {
  rows = new Map<string, T>()
  get(id: string) {
    const r = this.rows.get(id)
    return r ? clone(r) : undefined
  }
  put(row: T) {
    this.rows.set(row.id, clone(row))
  }
  delete(id: string) {
    this.rows.delete(id)
  }
  all(): T[] {
    return [...this.rows.values()].map(clone)
  }
}

interface State {
  projects: MemoryTable<Project>
  episodes: MemoryTable<Episode>
  scenes: MemoryTable<Scene>
  shots: MemoryTable<Shot>
  assets: MemoryTable<Asset>
  candidates: MemoryTable<EntityCandidate>
  materials: MemoryTable<Material>
  timelines: MemoryTable<TimelineDocument>
  jobs: MemoryTable<Job>
  refs: Map<string, ShotAssetRef[]>
  artifacts: Map<string, ArtifactRecord>
}

function newState(): State {
  return {
    projects: new MemoryTable(),
    episodes: new MemoryTable(),
    scenes: new MemoryTable(),
    shots: new MemoryTable(),
    assets: new MemoryTable(),
    candidates: new MemoryTable(),
    materials: new MemoryTable(),
    timelines: new MemoryTable(),
    jobs: new MemoryTable(),
    refs: new Map(),
    artifacts: new Map(),
  }
}

function snapshot(s: State): State {
  const t = newState()
  for (const k of [
    'projects',
    'episodes',
    'scenes',
    'shots',
    'assets',
    'candidates',
    'materials',
    'timelines',
    'jobs',
  ] as const) {
    ;(t[k].rows as Map<string, unknown>) = new Map([...s[k].rows].map(([id, v]) => [id, clone(v)]))
  }
  t.refs = new Map([...s.refs].map(([k, v]) => [k, clone(v)]))
  t.artifacts = new Map([...s.artifacts].map(([k, v]) => [k, clone(v)]))
  return t
}

const matches = <T>(value: T, want: T | T[] | undefined) =>
  want === undefined || (Array.isArray(want) ? want.includes(value) : value === want)

export class MemoryStore implements Store {
  private state: State = newState()

  projects: ProjectRepo = {
    get: async (id) => this.state.projects.get(id),
    put: async (p) => this.state.projects.put(p),
    list: async (o) => this.state.projects.all().filter((p) => o?.includeDeleted || !p.deletedAt),
    delete: async (id) => this.state.projects.delete(id),
  }
  episodes: EpisodeRepo = {
    get: async (id) => this.state.episodes.get(id),
    put: async (e) => this.state.episodes.put(e),
    listByProject: async (pid) => this.state.episodes.all().filter((e) => e.projectId === pid),
    delete: async (id) => this.state.episodes.delete(id),
  }
  scenes: SceneRepo = {
    get: async (id) => this.state.scenes.get(id),
    put: async (s) => this.state.scenes.put(s),
    listByProject: async (pid) => this.state.scenes.all().filter((s) => s.projectId === pid),
    delete: async (id) => this.state.scenes.delete(id),
  }
  shots: ShotRepo = {
    get: async (id) => this.state.shots.get(id),
    put: async (s) => this.state.shots.put(s),
    listByProject: async (pid) => this.state.shots.all().filter((s) => s.projectId === pid),
    delete: async (id) => this.state.shots.delete(id),
  }
  assets: AssetRepo = {
    get: async (id) => this.state.assets.get(id),
    put: async (a) => this.state.assets.put(a),
    listByProject: async (pid, o) =>
      this.state.assets
        .all()
        .filter((a) => a.projectId === pid && (o?.includeDeleted || !a.deletedAt)),
    delete: async (id) => this.state.assets.delete(id),
  }
  shotRefs: ShotAssetRefRepo = {
    listByShot: async (shotId) => clone(this.state.refs.get(shotId) ?? []),
    listByProject: async (pid) => {
      const shotIds = new Set(
        this.state.shots
          .all()
          .filter((s) => s.projectId === pid)
          .map((s) => s.id),
      )
      return [...this.state.refs].filter(([k]) => shotIds.has(k)).flatMap(([, v]) => clone(v))
    },
    replaceForShot: async (shotId, refs) => {
      this.state.refs.set(shotId, clone(refs))
    },
  }
  candidates: CandidateRepo = {
    get: async (id) => this.state.candidates.get(id),
    put: async (c) => this.state.candidates.put(c),
    listByProject: async (pid) => this.state.candidates.all().filter((c) => c.projectId === pid),
    delete: async (id) => this.state.candidates.delete(id),
  }
  materials: MaterialRepo = {
    get: async (id) => this.state.materials.get(id),
    put: async (m) => this.state.materials.put(m),
    listByProject: async (pid) =>
      this.state.materials
        .all()
        .filter((m) => m.projectId === pid)
        .sort((a, b) => a.number - b.number),
    delete: async (id) => this.state.materials.delete(id),
  }
  timelines: TimelineRepo = {
    get: async (id) => this.state.timelines.get(id),
    put: async (d) => this.state.timelines.put(d),
    listByProject: async (pid) => this.state.timelines.all().filter((d) => d.projectId === pid),
    delete: async (id) => this.state.timelines.delete(id),
  }
  artifacts: ArtifactRepo = {
    get: async (pid, key) => {
      const r = this.state.artifacts.get(`${pid}/${key}`)
      return r ? clone(r) : undefined
    },
    put: async (r) => {
      this.state.artifacts.set(`${r.projectId}/${r.key}`, clone(r))
    },
    listByProject: async (pid) =>
      [...this.state.artifacts.values()].filter((r) => r.projectId === pid).map(clone),
    delete: async (pid, key) => {
      this.state.artifacts.delete(`${pid}/${key}`)
    },
  }
  jobs: JobRepo = {
    // 检查与插入之间没有 await：单线程下是原子的。
    insertIfNoConflict: async (job) => {
      const inflight = this.state.jobs
        .all()
        .filter(
          (j) => j.projectId === job.projectId && (j.status === 'queued' || j.status === 'running'),
        )
      const dedupe = job.dedupeKey ? inflight.find((j) => j.dedupeKey === job.dedupeKey) : undefined
      if (dedupe) return { inserted: false, existing: dedupe, conflict: 'dedupe' }
      const exclusive = job.exclusiveKey
        ? inflight.find((j) => j.exclusiveKey === job.exclusiveKey)
        : undefined
      if (exclusive) return { inserted: false, existing: exclusive, conflict: 'exclusive' }
      if (this.state.jobs.rows.has(job.id)) throw new Error(`duplicate job id ${job.id}`)
      this.state.jobs.put(job)
      return { inserted: true, job: clone(job) }
    },
    insert: async (job) => {
      if (this.state.jobs.rows.has(job.id)) throw new Error(`duplicate job id ${job.id}`)
      this.state.jobs.put(job)
    },
    get: async (id) => this.state.jobs.get(id),
    transition: async (id, from, patch) => {
      const cur = this.state.jobs.get(id)
      if (!cur || !from.includes(cur.status)) return undefined
      const next = { ...cur, ...patch }
      this.state.jobs.put(next)
      return clone(next)
    },
    patch: async (id, patch) => {
      const cur = this.state.jobs.get(id)
      if (!cur) return undefined
      const next = { ...cur, ...patch }
      this.state.jobs.put(next)
      return clone(next)
    },
    list: async (f?: JobFilter) =>
      this.state.jobs
        .all()
        .filter(
          (j) =>
            (!f?.projectId || j.projectId === f.projectId) &&
            matches(j.status, f?.status) &&
            (!f?.shotId || j.shotId === f.shotId) &&
            (!f?.batchId || j.batchId === f.batchId),
        )
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
  }

  /** 事务：失败则整体回滚到进入前的快照。内存实现不处理并发事务。 */
  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    const before = snapshot(this.state)
    try {
      return await fn(this)
    } catch (err) {
      this.state = before
      throw err
    }
  }
}

export function createMemoryPorts() {
  return {
    store: new MemoryStore(),
    files: new MemoryFileStore(),
    secrets: new MemorySecretStore(),
    events: new MemoryEventSink(),
    clock: new FakeClock(),
    ids: new SequentialIds(),
  }
}

export { checkJobRepoContract } from './job-repo-contract.ts'
