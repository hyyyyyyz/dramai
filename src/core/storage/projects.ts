import { nanoid } from 'nanoid'
import { db } from '@/core/storage/db'
import type { Project } from '@/types/domain'

export async function createProject(input: {
  title: string
  summary?: string
  style?: string
}): Promise<Project> {
  const now = Date.now()
  const project: Project = {
    id: nanoid(12),
    title: input.title.trim() || '未命名项目',
    summary: input.summary?.trim() || undefined,
    style: input.style?.trim() || undefined,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
  await db.projects.add(project)
  return project
}

export async function updateProject(
  id: string,
  patch: Partial<Omit<Project, 'id' | 'createdAt'>>,
): Promise<void> {
  await db.projects.update(id, { ...patch, updatedAt: Date.now() })
}

/**
 * 删除项目以及它名下所有派生数据。
 * 用单个 RW 事务保证原子性。
 */
export async function deleteProject(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.projects, db.characters, db.materials, db.storyboards, db.assets, db.generations],
    async () => {
      await db.projects.delete(id)
      await db.characters.where('projectId').equals(id).delete()
      await db.materials.where('projectId').equals(id).delete()
      await db.storyboards.where('projectId').equals(id).delete()
      await db.assets.where('projectId').equals(id).delete()
      await db.generations.where('projectId').equals(id).delete()
    },
  )
}

export async function getProject(id: string): Promise<Project | undefined> {
  return db.projects.get(id)
}
