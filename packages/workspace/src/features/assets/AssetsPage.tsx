import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { AssetKind } from '@dramai/api'
import { Button, EmptyState, Notice, Skeleton, iconProps, iconPropsLg } from '@dramai/ui/v2'
import { useAssets, useCandidates } from '@/data/queries'
import { AssetTabs } from '@/features/common/ProjectTabs'
import { ErrorNotice } from '@/features/common/error-text'
import { PageHead } from '@/features/common/PageHead'
import { useShotIndex } from '@/features/common/use-shot-index'
import { AssetCard } from './AssetCard'
import { ASSET_KINDS } from './asset-model'
import { NewAssetDialog } from './NewAssetDialog'
import { Library } from 'lucide-react'

/** 资产库：角色、地点、道具、服装四类，镜头只引用它们，同一个资产在所有集里是同一个。 */
export function AssetsPage() {
  const { projectId = '' } = useParams()
  const { t } = useTranslation()
  const assets = useAssets(projectId)
  const candidates = useCandidates(projectId)
  const index = useShotIndex(projectId)
  const [creating, setCreating] = useState<AssetKind>()
  const pending = candidates.data?.progress.pending ?? 0
  const items = assets.data?.items ?? []

  return (
    <>
      <PageHead
        title={t('assets.title')}
        sub={t('assets.sub')}
        actions={
          <Button variant="primary" onClick={() => setCreating('character')}>
            <Plus {...iconProps} aria-hidden />
            {t('assets.newAsset')}
          </Button>
        }
      />
      <AssetTabs projectId={projectId} />
      {assets.isError && <ErrorNotice error={assets.error} />}
      {pending > 0 && (
        <Notice
          tone="info"
          className="mb-4"
          actions={
            <Link to={`/projects/${projectId}/candidates`}>
              <Button size="sm" variant="secondary" tabIndex={-1}>
                {t('assets.banner.go')}
              </Button>
            </Link>
          }
        >
          <b className="font-medium">{t('assets.banner.title', { count: pending })}</b>{' '}
          {t('assets.banner.body')}
        </Notice>
      )}
      {assets.isPending && <Skeleton className="h-56" />}
      {assets.isSuccess && items.length === 0 && (
        <EmptyState
          icon={<Library {...iconPropsLg} aria-hidden />}
          title={t('assets.empty.title')}
          description={t('assets.empty.body')}
          action={
            <Button variant="primary" onClick={() => setCreating('character')}>
              {t('assets.newAsset')}
            </Button>
          }
        />
      )}
      {items.length > 0 &&
        ASSET_KINDS.map((kind) => {
          const list = items.filter((a) => a.kind === kind)
          return (
            <section key={kind} aria-label={t(`assetKind.${kind}`)} className="mb-8">
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="font-display text-title-sm font-bold">{t(`assetKind.${kind}`)}</h2>
                <span className="font-mono text-sm text-muted-foreground">{list.length}</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                {list.map((a) => (
                  <AssetCard
                    key={a.id}
                    projectId={projectId}
                    asset={a}
                    usedBy={index.usedBy.get(a.id)?.length ?? 0}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setCreating(kind)}
                  className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-muted-foreground transition-colors duration-(--duration-fast) ease-standard hover:border-foreground/40 hover:text-foreground"
                >
                  <Plus {...iconPropsLg} aria-hidden />
                  {t('assets.newKind', { kind: t(`assetKindSingular.${kind}`) })}
                </button>
              </div>
            </section>
          )
        })}
      {creating && (
        <NewAssetDialog
          projectId={projectId}
          kind={creating}
          onClose={() => setCreating(undefined)}
        />
      )}
    </>
  )
}
