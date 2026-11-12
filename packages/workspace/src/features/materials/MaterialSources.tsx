import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Trash2, TriangleAlert, Upload as UploadIcon, X } from 'lucide-react'
import type { Material } from '@dramai/api'
import { IconButton, Button, iconProps, cn } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'
import { Block } from '@/features/common/PageHead'
import { DropZone } from '@/features/common/DropZone'
import { ErrorNotice } from '@/features/common/error-text'
import { useErrorText } from '@/features/common/use-error-text'
import { useFormat } from '@/i18n/format'
import { SOURCE_ACCEPT, useUploads, type Upload } from './use-uploads'

export function UploadStatusList({
  items,
  onDismiss,
}: {
  items: Upload[]
  onDismiss: (key: string) => void
}) {
  const { t } = useTranslation()
  const errorText = useErrorText()
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-2" aria-live="polite">
      {items.map((u) => (
        <li
          key={u.key}
          className={cn(
            'flex items-start gap-3 rounded-md border px-3 py-2 text-sm',
            u.status === 'error' ? 'border-danger bg-danger-soft' : 'border-border bg-background',
          )}
        >
          {u.status === 'uploading' ? (
            <UploadIcon {...iconProps} aria-hidden className="mt-0.5 text-muted-foreground" />
          ) : (
            <TriangleAlert {...iconProps} aria-hidden className="mt-0.5 text-danger" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{u.name}</div>
            <div className="text-xs text-muted-foreground">
              {u.status === 'uploading' ? t('materials.uploading') : errorText(u.error)}
            </div>
          </div>
          {u.status === 'error' && (
            <IconButton label={t('common.dismiss')} size="sm" onClick={() => onDismiss(u.key)}>
              <X {...iconProps} aria-hidden />
            </IconButton>
          )}
        </li>
      ))}
    </ul>
  )
}

/** 原文：docx / txt / md，不截断，显示章节数和字数。 */
export function SourceTextBlock({
  projectId,
  materials,
}: {
  projectId: string
  materials: Material[]
}) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const uploads = useUploads(projectId)
  const [deleting, setDeleting] = useState<Material>()
  const del = useCall('materials.delete', {
    invalidate: [qk.materials(projectId), qk.projects, qk.episodes(projectId)],
  })
  const texts = materials.filter((m) => m.kind !== 'image')

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await del.mutateAsync({ params: { materialId: deleting.id } })
      setDeleting(undefined)
    } catch {
      /* 错误显示在对话框里 */
    }
  }

  return (
    <Block
      title={t('materials.source.title')}
      aside={t('materials.source.formats')}
      aria-label={t('materials.source.title')}
    >
      <ul>
        {texts.map((m) => (
          <li
            key={m.id}
            className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3"
          >
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-md bg-surface-2 text-muted-foreground"
            >
              <FileText {...iconProps} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate font-sans text-base font-medium">{m.name}</h3>
              <p className="text-sm text-muted-foreground">
                {[
                  m.chapters.length > 1
                    ? t('materials.source.chapters', { count: m.chapters.length })
                    : null,
                  fmt.chars(m.charCount),
                  t('materials.source.parsed'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <IconButton
              label={t('materials.source.delete', { name: m.name })}
              onClick={() => setDeleting(m)}
            >
              <Trash2 {...iconProps} aria-hidden />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 p-4">
        <UploadStatusList items={uploads.items} onDismiss={uploads.dismiss} />
        <DropZone accept={SOURCE_ACCEPT} onFiles={(f) => void uploads.start(f)}>
          {t('materials.source.drop')}
        </DropZone>
      </div>
      <Modal
        open={deleting !== undefined}
        onClose={() => setDeleting(undefined)}
        size="sm"
        title={t('materials.source.deleteTitle')}
        closeLabel={t('common.close')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger-solid" loading={del.isPending} onClick={confirmDelete}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>{t('materials.source.deleteBody', { name: deleting?.name ?? '' })}</p>
          {del.isError && <ErrorNotice error={del.error} />}
        </div>
      </Modal>
    </Block>
  )
}
