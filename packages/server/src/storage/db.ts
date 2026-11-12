/**
 * 薄薄的 SQLite 驱动适配层。服务只依赖这个接口——现在用 Node 内置的 `node:sqlite`，
 * 将来若在 Electron 里验证不通过，在同一个接口后面换成 better-sqlite3 即可，存储层其余代码不动。
 */
export type SqlValue = string | number | bigint | null | Uint8Array

export interface Db {
  exec(sql: string): void
  run(sql: string, ...params: SqlValue[]): { changes: number }
  get<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T | undefined
  all<T = Record<string, unknown>>(sql: string, ...params: SqlValue[]): T[]
  close(): void
}

/** 加载 node:sqlite 并吞掉它的“实验性功能”启动警告（其他警告照常输出）。 */
export async function openNodeSqlite(path: string): Promise<Db> {
  const original = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const text = typeof warning === 'string' ? warning : warning?.message
    if (typeof text === 'string' && /SQLite is an experimental feature/i.test(text)) return
    return (original as (...a: unknown[]) => void).call(process, warning, ...rest)
  }) as typeof process.emitWarning
  let mod: typeof import('node:sqlite')
  try {
    mod = await import('node:sqlite')
  } finally {
    process.emitWarning = original
  }
  const raw = new mod.DatabaseSync(path)
  raw.exec(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;',
  )
  const cache = new Map<string, import('node:sqlite').StatementSync>()
  const stmt = (sql: string) => {
    let s = cache.get(sql)
    if (!s) {
      s = raw.prepare(sql)
      cache.set(sql, s)
    }
    return s
  }
  return {
    exec: (sql) => raw.exec(sql),
    run: (sql, ...p) => {
      const r = stmt(sql).run(...p)
      return { changes: Number(r.changes) }
    },
    get: <T>(sql: string, ...p: SqlValue[]) => stmt(sql).get(...p) as T | undefined,
    all: <T>(sql: string, ...p: SqlValue[]) => stmt(sql).all(...p) as T[],
    close: () => raw.close(),
  }
}
