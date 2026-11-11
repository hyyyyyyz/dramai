import Dexie, { type Table } from 'dexie'
import type { Asset, Character, Generation, Material, Project, Storyboard } from '@/types/domain'

/**
 * IndexedDB 模式定义。
 *
 * 任何字段或表的变更都需要 `version(N+1).stores({...}).upgrade(...)` 形式
 * 增加新版本号；不要原地修改现有版本。
 */
class DramaiDB extends Dexie {
  projects!: Table<Project, string>
  characters!: Table<Character, string>
  materials!: Table<Material, string>
  storyboards!: Table<Storyboard, string>
  assets!: Table<Asset, string>
  generations!: Table<Generation, string>

  constructor() {
    super('dramai')

    this.version(1).stores({
      // 第一个字段是主键，后续逗号分隔的是次级索引
      projects: 'id, status, createdAt, updatedAt',
      characters: 'id, projectId, role, locked, createdAt',
      materials: 'id, projectId, kind, createdAt',
      storyboards: 'id, projectId, status, [projectId+sequence]',
      assets: 'id, projectId, kind, createdAt',
      generations: 'id, projectId, stageName, status, createdAt',
    })
  }
}

export const db = new DramaiDB()

/** 一次性删除所有 dramai 本地数据。会触发所有 useLiveQuery 重新计算。 */
export async function wipeAll(): Promise<void> {
  await db.delete()
  await db.open()
}
