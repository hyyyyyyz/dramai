import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, Undo2 } from 'lucide-react'
import type { ProjectListItem } from '@dramai/api'
import { Button, Skeleton, iconProps, useToast } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall, useTrashedProjects } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { Block } from '@/features/common/PageHead'
import { useFormat } from '@/i18n/format'

/** 回收站：删除的项目先放这里，可以恢复；“彻底清除”才真正删除文件，不可撤销，要二次确认。 */
export function TrashBlock() {
  const { t } = useTranslation()
  const fmt = useFormat()
  const { toast } = useToast()
  const trash = useTrashedProjects()
  const restore = useCall('projects.restore', { invalidate: [qk.projects] })
  const purge = useCall('projects.purge', { invalidate: [qk.projects] })
  const [purging, setPurging] = useState<ProjectListItem>()

  return (
    <Block
      title={t('settings.data.trash.title')}
      aside={t('settings.data.trash.sub')}
      aria-label={t('settings.data.trash.title')}
    >
      <div className="flex flex-col gap-3 p-4">
        {trash.isError && <ErrorNotice error={trash.error} />}
        {trash.isPending && <Skeleton className="h-12" aria-busy />}
        {trash.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('settings.data.trash.empty')}</p>
        )}
        {trash.data && trash.data.length > 0 && (
          <ul className="flex flex-col">
            {trash.data.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  <small className="text-xs text-muted-foreground">
                    {t('settings.data.trash.meta', {
                      deleted: p.deletedAt ? fmt.ago(p.deletedAt) : '',
                      episodes: p.episodes.length,
                      shots: p.shotCounts.total,
                    })}
                  </small>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={restore.isPending}
                    aria-label={t('settings.data.trash.restoreLabel', { name: p.name })}
                    onClick={() =>
                      restore.mutate(
                        { params: { projectId: p.id } },
                        {
                          onSuccess: () =>
                            toast({
                              tone: 'success',
                              title: t('settings.data.trash.restored', { name: p.name }),
                            }),
                        },
                      )
                    }
                  >
                    <Undo2 {...iconProps} aria-hidden />
                    {t('settings.data.trash.restore')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('settings.data.trash.purgeLabel', { name: p.name })}
                    onClick={() => setPurging(p)}
                  >
                    <Trash2 {...iconProps} aria-hidden />
                    {t('settings.data.trash.purge')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {(restore.isError || purge.isError) && <ErrorNotice error={restore.error ?? purge.error} />}
      </div>

      <Modal
        open={purging !== undefined}
        onClose={() => setPurging(undefined)}
        size="sm"
        title={t('settings.data.trash.purgeTitle', { name: purging?.name ?? '' })}
        closeLabel={t('common.close')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPurging(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger-solid"
              loading={purge.isPending}
              onClick={() =>
                purging &&
                purge.mutate(
                  { params: { projectId: purging.id } },
                  { onSuccess: () => setPurging(undefined) },
                )
              }
            >
              {t('settings.data.trash.purgeConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('settings.data.trash.purgeBody')}</p>
      </Modal>
    </Block>
  )
}
