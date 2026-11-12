import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Box, Clapperboard, MapPin, Shirt, User, CircleAlert } from 'lucide-react'
import type { Asset, ShotRef } from '@dramai/api'
import { cn, iconPropsSm } from '@dramai/ui/v2'

const KIND_ICON = { character: User, location: MapPin, prop: Box, costume: Shirt } as const

/**
 * 镜头引用的资产：一排小标签，三态——正常（灰）、没有设定图（黄，写明）、未登记（红色虚线，写明）。
 * 点击跳到资产或候选。
 */
export function AssetRefs({
  projectId,
  refs,
  assets,
  loading,
}: {
  projectId: string
  refs: readonly ShotRef[]
  assets: ReadonlyMap<string, Asset>
  /** 资产列表还没取回来：不能把“还没加载”当成“未登记”。 */
  loading?: boolean
}) {
  const { t } = useTranslation()
  if (refs.length === 0 || loading) return null
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t('storyboard.refs.label')}>
      {refs.map((r) => {
        const asset = assets.get(r.assetId)
        if (!asset) {
          return (
            <li key={`${r.assetId}/${r.variantName ?? ''}`}>
              <Link
                to={`/projects/${projectId}/candidates`}
                className="inline-flex h-6 items-center gap-1 rounded-sm border border-dashed border-danger px-2 text-xs text-danger hover:bg-danger-soft"
              >
                <CircleAlert {...iconPropsSm} size={12} aria-hidden />
                {t('storyboard.refs.unregistered')}
              </Link>
            </li>
          )
        }
        const variant = r.variantName
          ? asset.variants.find((v) => v.name === r.variantName)
          : undefined
        const sheetMissing = variant
          ? !variant.sheet.currentVersionId && !asset.sheet.currentVersionId
          : !asset.sheet.currentVersionId
        const Icon = KIND_ICON[asset.kind] ?? Clapperboard
        return (
          <li key={`${r.assetId}/${r.variantName ?? ''}`}>
            <Link
              to={`/projects/${projectId}/assets/${asset.id}`}
              title={t(`assetKindSingular.${asset.kind}`)}
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-xs',
                'transition-colors duration-(--duration-fast) ease-standard hover:border-border-strong hover:text-foreground',
                sheetMissing
                  ? 'border-warn/60 bg-warn-soft text-warn'
                  : 'border-border bg-surface-2 text-muted-foreground',
              )}
            >
              <Icon {...iconPropsSm} size={12} aria-hidden />
              {asset.name}
              {variant && <span className="text-subtle"> / {variant.name}</span>}
              {sheetMissing && <span> · {t('storyboard.refs.noSheet')}</span>}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
