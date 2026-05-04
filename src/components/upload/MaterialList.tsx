import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileText, Image as ImageIcon, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { db } from '@/core/storage/db'
import { deleteMaterial } from '@/core/storage/materials'
import { getObjectURL, releaseObjectURL } from '@/core/storage/assets'
import type { Asset, Material } from '@/types/domain'

interface Props {
  projectId: string
}

const KIND_LABEL: Record<Material['kind'], string> = {
  doc: 'Word',
  txt: 'Text',
  md: 'Markdown',
  image: '图片',
}

export function MaterialList({ projectId }: Props) {
  const materials = useLiveQuery(
    () => db.materials.where('projectId').equals(projectId).reverse().sortBy('createdAt'),
    [projectId],
    [] as Material[],
  )

  const assetIds = useMemo(
    () => materials.map((m) => m.assetId).filter((x): x is string => !!x),
    [materials],
  )
  const assets = useLiveQuery<Asset[], Asset[]>(
    () =>
      assetIds.length === 0
        ? Promise.resolve<Asset[]>([])
        : db.assets.where('id').anyOf(assetIds).toArray(),
    [assetIds.join(',')],
    [],
  )
  const assetById = useMemo(() => {
    const map = new Map<string, Asset>()
    for (const a of assets) map.set(a.id, a)
    return map
  }, [assets])

  // 组件卸载时回收 ObjectURL
  useEffect(() => {
    const ids = assets.map((a) => a.id)
    return () => {
      for (const id of ids) releaseObjectURL(id)
    }
  }, [assets])

  if (materials.length === 0) {
    return <p className="text-sm text-muted">还没有上传任何素材。</p>
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {materials.map((m) => {
        const asset = m.assetId ? assetById.get(m.assetId) : undefined
        const isImage = m.kind === 'image' && asset
        const previewUrl = isImage ? getObjectURL(asset) : undefined
        return (
          <li
            key={m.id}
            className="flex flex-col overflow-hidden rounded-lg border border-border bg-background-soft"
          >
            {previewUrl ? (
              <div className="relative aspect-video bg-background-soft-2">
                <img
                  src={previewUrl}
                  alt={m.name}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center bg-background-soft-2 text-muted">
                <FileText className="h-8 w-8" />
              </div>
            )}
            <div className="flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                {m.kind === 'image' ? (
                  <ImageIcon className="h-3.5 w-3.5 text-muted" />
                ) : (
                  <FileText className="h-3.5 w-3.5 text-muted" />
                )}
                <Badge variant="muted">{KIND_LABEL[m.kind]}</Badge>
              </div>
              <p className="truncate text-sm font-medium" title={m.name}>
                {m.name}
              </p>
              {m.text && (
                <p className="line-clamp-2 text-xs leading-relaxed text-muted">{m.text}</p>
              )}
              <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-muted">
                <span>
                  {new Date(m.createdAt).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted hover:text-destructive"
                  onClick={() => {
                    if (window.confirm(`确认删除素材「${m.name}」？`)) {
                      deleteMaterial(m.id)
                    }
                  }}
                  aria-label="删除素材"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
