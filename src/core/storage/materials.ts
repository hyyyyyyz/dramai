import { nanoid } from 'nanoid'
import { db } from '@/core/storage/db'
import { createAsset } from '@/core/storage/assets'
import type { ParsedMaterial } from '@/core/parsers'
import type { Material } from '@/types/domain'

/**
 * 把解析后的素材落盘：原始文件进 assets 表（Blob），
 * 解析文本进 materials 表，两者通过 assetId 关联。
 */
export async function saveMaterial(projectId: string, parsed: ParsedMaterial): Promise<Material> {
  const asset = await createAsset({
    projectId,
    kind: parsed.kind === 'image' ? 'image' : 'doc',
    blob: parsed.blob,
    mimeType: parsed.mimeType,
    width: parsed.preview?.width,
    height: parsed.preview?.height,
  })

  const material: Material = {
    id: nanoid(12),
    projectId,
    kind: parsed.kind,
    name: parsed.name,
    text: parsed.text,
    assetId: asset.id,
    createdAt: Date.now(),
  }
  await db.materials.add(material)
  return material
}

export async function deleteMaterial(materialId: string): Promise<void> {
  await db.transaction('rw', [db.materials, db.assets], async () => {
    const m = await db.materials.get(materialId)
    if (!m) return
    if (m.assetId) await db.assets.delete(m.assetId)
    await db.materials.delete(materialId)
  })
}

export async function listProjectMaterials(projectId: string): Promise<Material[]> {
  return db.materials.where('projectId').equals(projectId).reverse().sortBy('createdAt')
}
