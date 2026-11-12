import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from 'lucide-react'
import { Button, Modal, Notice, Pill, Skeleton, Field, Input, iconProps } from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useAsset, useAssets, useCall, useProject } from '@/data/queries'
import { AssetTabs } from '@/features/common/ProjectTabs'
import { ErrorNotice } from '@/features/common/error-text'
import { PageHead } from '@/features/common/PageHead'
import { useShotIndex } from '@/features/common/use-shot-index'
import { OriginalsBlock } from './OriginalsBlock'
import { SheetBlock } from './SheetBlock'
import { VariantsBlock } from './VariantsBlock'
import { VoiceBlock } from './VoiceBlock'
import { UsedByBlock } from './UsedByBlock'
import { versionNumber } from '@/features/storyboard/version-model'

/** 资产详情：设定图与版本、衍生形态、原图、音色参考、被哪些镜头引用。 */
export function AssetDetailPage() {
  const { projectId = '', assetId = '' } = useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const q = useAsset(assetId)
  const all = useAssets(projectId)
  const project = useProject(projectId)
  const index = useShotIndex(projectId)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [name, setName] = useState('')
  const invalidate = [
    qk.asset(assetId),
    qk.assets(projectId),
    qk.preflight,
    qk.artifacts,
    qk.episodes(projectId),
  ]
  const update = useCall('assets.update', { invalidate })
  const remove = useCall('assets.delete', { invalidate })

  const asset = q.data?.asset
  const costumes = useMemo(
    () => (all.data?.items ?? []).filter((a) => a.kind === 'costume'),
    [all.data],
  )
  if (q.isError) return <ErrorNotice error={q.error} />
  if (!asset) return <Skeleton className="h-72" aria-busy />

  const usedBy = index.usedBy.get(asset.id) ?? q.data?.usedByShotIds ?? []
  const sheetNo = versionNumber(asset.sheet, asset.sheet.currentVersionId)

  return (
    <>
      <PageHead
        title={asset.name}
        sub={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Pill tone="info">{t(`assetKindSingular.${asset.kind}`)}</Pill>
            <span>
              {[
                usedBy.length > 0
                  ? t('assets.usedBy', { count: usedBy.length })
                  : t('assets.unused'),
                sheetNo ? t('assets.sheetVersion', { n: sheetNo }) : t('assets.noSheet'),
                asset.variants.length > 0
                  ? t('assets.variantsCount', { count: asset.variants.length })
                  : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        }
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setName(asset.name)
                setRenaming(true)
              }}
            >
              <Pencil {...iconProps} aria-hidden />
              {t('assets.detail.rename')}
            </Button>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              <Trash2 {...iconProps} aria-hidden />
              {t('common.delete')}
            </Button>
          </>
        }
      />
      <AssetTabs projectId={projectId} />
      <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <SheetBlock
            projectId={projectId}
            asset={asset}
            usedByCount={usedBy.length}
            aspect={project.data?.aspectRatio ?? '9:16'}
          />
          <VariantsBlock
            projectId={projectId}
            asset={asset}
            costumes={costumes}
            aspect={project.data?.aspectRatio ?? '9:16'}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <OriginalsBlock projectId={projectId} asset={asset} />
          {asset.kind === 'character' && <VoiceBlock projectId={projectId} asset={asset} />}
          <UsedByBlock projectId={projectId} shotIds={usedBy} shots={index.shots} />
        </div>
      </div>

      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        size="sm"
        title={t('assets.detail.rename')}
        closeLabel={t('common.close')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={name.trim() === ''}
              loading={update.isPending}
              onClick={async () => {
                try {
                  await update.mutateAsync({ params: { assetId }, body: { name: name.trim() } })
                  setRenaming(false)
                } catch {
                  /* 显示在对话框里 */
                }
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label={t('assets.new.name')}>
            <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Notice tone="info">{t('assets.detail.renameNote')}</Notice>
          {update.isError && <ErrorNotice error={update.error} />}
        </div>
      </Modal>

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        size="sm"
        title={t('assets.detail.deleteTitle', { name: asset.name })}
        closeLabel={t('common.close')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger-solid"
              loading={remove.isPending}
              onClick={async () => {
                try {
                  await remove.mutateAsync({ params: { assetId } })
                  void navigate(`/projects/${projectId}/assets`)
                } catch {
                  /* 显示在对话框里：被引用时按错误码说明 */
                }
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>{t('assets.detail.deleteBody')}</p>
          {remove.isError && <ErrorNotice error={remove.error} />}
        </div>
      </Modal>
      <p className="mt-6">
        <Link
          to={`/projects/${projectId}/assets`}
          className="text-sm text-accent-text hover:underline"
        >
          {t('assets.detail.back')}
        </Link>
      </p>
    </>
  )
}
