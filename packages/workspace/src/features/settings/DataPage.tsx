import { useTranslation } from 'react-i18next'
import { CopyField, Skeleton, useToast } from '@dramai/ui/v2'
import { useSystem } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { Block } from '@/features/common/PageHead'
import { ImportBlock } from './ImportBlock'
import { TrashBlock } from './TrashBlock'

/** 设置 · 数据与备份：数据文件夹在哪、导入旧版备份、回收站（恢复 / 彻底清除）。 */
export function DataPage() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const system = useSystem()
  if (system.isError) return <ErrorNotice error={system.error} />
  if (!system.data) return <Skeleton className="h-40" aria-busy />

  return (
    <div className="flex flex-col gap-6">
      <Block title={t('settings.data.dir.title')} aria-label={t('settings.data.dir.title')}>
        <div className="flex flex-col gap-3 p-4">
          <CopyField
            aria-label={t('settings.data.dir.title')}
            value={system.data.dataDir}
            copyLabel={t('common.copy')}
            copiedLabel={t('common.copied')}
            onCopied={() => toast({ title: t('common.copied') })}
          />
          <p className="text-sm text-muted-foreground">{t('settings.data.dir.body')}</p>
        </div>
      </Block>
      <ImportBlock />
      <TrashBlock />
    </div>
  )
}
