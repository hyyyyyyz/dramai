import { SCHEMA_VERSIONS } from '../domain/common.ts'
import { allocateNumber } from '../domain/factories.ts'
import type { Material } from '../domain/material.ts'
import { parseMaterial } from '../parsers/material.ts'
import type { PipelineDeps } from './deps.ts'
import { notFoundError } from '../errors.ts'

export interface IngestedMaterial {
  material: Material
  /** 解析结果摘要：给素材页显示“N 章 · M 字”。 */
  summary: { chapterCount: number; charCount: number; truncated: false }
}

/**
 * 素材入库：解析（docx / txt / md / 图片）→ 存原文件 → 建 Material。
 * 文本**完整保留，不截断**（v0.4 每份截断到 4000 字）；同时识别章节、统计字数。
 */
export async function ingestMaterial(
  deps: PipelineDeps,
  projectId: string,
  file: { name: string; bytes: Uint8Array; mime?: string },
): Promise<IngestedMaterial> {
  const project = await deps.store.projects.get(projectId)
  if (!project) throw notFoundError('project', projectId)
  const parsed = await parseMaterial(file)
  const id = deps.ids.next('mat')
  const path = `materials/${id}/${file.name.replace(/[^\w.一-龥-]+/g, '_')}`
  const info = await deps.files.put(projectId, path, file.bytes)
  const alloc = allocateNumber(project, 'material')
  const material: Material = {
    schemaVersion: SCHEMA_VERSIONS.material,
    id,
    projectId,
    number: alloc.number,
    kind: parsed.kind,
    name: file.name,
    text: parsed.text,
    charCount: parsed.charCount,
    chapters: parsed.chapters,
    file: { path, mime: parsed.mimeType, bytes: info.bytes, sha256: info.sha256 },
    size: parsed.size,
    createdAt: deps.clock.now(),
  }
  await deps.store.transaction(async (tx) => {
    await tx.projects.put({ ...alloc.project, updatedAt: deps.clock.now() })
    await tx.materials.put(material)
  })
  return {
    material,
    summary: {
      chapterCount: parsed.chapters.length,
      charCount: parsed.charCount,
      truncated: false,
    },
  }
}
