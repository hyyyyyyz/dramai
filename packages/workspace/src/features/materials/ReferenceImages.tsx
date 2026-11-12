import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import type { Material } from '@dramai/api'
import { Hint, IconButton, iconProps } from '@dramai/ui/v2'
import { useApi } from '@/data/use-api'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'
import { Block } from '@/features/common/PageHead'
import { DropZone } from '@/features/common/DropZone'
import { ErrorNotice } from '@/features/common/error-text'
import { UploadStatusList } from './MaterialSources'
import { IMAGE_ACCEPT, useUploads } from './use-uploads'

/** 参考图：只是生成设定图的输入，不会直接出现在成片里。 */
export function ReferenceImages({
  projectId,
  materials,
}: {
  projectId: string
  materials: Material[]
}) {
  const { t } = useTranslation()
  const api = useApi()
  const uploads = useUploads(projectId)
  const del = useCall('materials.delete', { invalidate: [qk.materials(projectId), qk.projects] })
  const images = materials.filter((m) => m.kind === 'image' && m.file)
  return (
    <Block
      title={t('materials.images.title')}
      aside={<span className="font-mono">{images.length}</span>}
      aria-label={t('materials.images.title')}
    >
      <div className="flex flex-col gap-3 p-4">
        <ul className="flex flex-wrap gap-2">
          {images.map((m) => (
            <li key={m.id} className="relative">
              <img
                src={api.fileUrl(projectId, m.file!.path)}
                alt={m.name}
                loading="lazy"
                className="aspect-[3/4] w-[72px] rounded-sm bg-sunken object-cover"
              />
              <IconButton
                size="sm"
                className="absolute -top-1.5 -right-1.5 rounded-full border border-border-strong bg-surface"
                label={t('materials.images.delete', { name: m.name })}
                disabled={del.isPending}
                onClick={() => del.mutate({ params: { materialId: m.id } })}
              >
                <X {...iconProps} size={12} aria-hidden />
              </IconButton>
            </li>
          ))}
          <li>
            <DropZone
              accept={IMAGE_ACCEPT}
              onFiles={(f) => void uploads.start(f)}
              className="aspect-[3/4] w-[72px]"
            >
              <Plus {...iconProps} aria-hidden />
              <span className="sr-only">{t('materials.images.add')}</span>
            </DropZone>
          </li>
        </ul>
        <UploadStatusList items={uploads.items} onDismiss={uploads.dismiss} />
        {del.isError && <ErrorNotice error={del.error} />}
        <Hint>{t('materials.images.hint')}</Hint>
      </div>
    </Block>
  )
}
