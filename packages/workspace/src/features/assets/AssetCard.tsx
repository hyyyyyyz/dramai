import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AudioLines, Layers, Link as LinkIcon, VolumeX, ImageIcon } from 'lucide-react'
import type { Asset } from '@dramai/api'
import { iconPropsSm, cn } from '@dramai/ui/v2'
import { useApi } from '@/data/use-api'
import { versionNumber } from '@/features/storyboard/version-model'

/** 资产卡：设定图（缺则虚线空框并写明后果）、名称、被引用数、衍生数、音色状态。 */
export function AssetCard({
  projectId,
  asset,
  usedBy,
}: {
  projectId: string
  asset: Asset
  usedBy: number
}) {
  const { t } = useTranslation()
  const api = useApi()
  const current = asset.sheet.versions.find((v) => v.id === asset.sheet.currentVersionId)
  const no = versionNumber(asset.sheet, asset.sheet.currentVersionId)
  return (
    <Link
      to={`/projects/${projectId}/assets/${asset.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-surface transition-colors duration-(--duration-fast) ease-standard hover:border-border-strong"
    >
      <div
        className={cn(
          'relative grid place-items-center',
          current
            ? 'aspect-[4/3] bg-sunken'
            : 'm-2 min-h-32 flex-1 rounded-sm border border-dashed border-border-strong',
        )}
      >
        {current ? (
          <>
            <img
              src={api.fileUrl(projectId, current.file.path)}
              alt={t('assets.sheetAlt', { name: asset.name })}
              loading="lazy"
              className="size-full object-contain"
            />
            {no && (
              <span className="absolute top-2 left-2 rounded-xs bg-black/60 px-1 font-mono text-[11px] leading-4 text-white">
                {t('assets.sheetVersion', { n: no })}
              </span>
            )}
          </>
        ) : (
          <span className="flex flex-col items-center gap-2 px-4 text-center text-xs text-subtle">
            <ImageIcon size={20} strokeWidth={1.5} aria-hidden />
            {usedBy > 0 ? t('assets.noSheetBlocks') : t('assets.noSheet')}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3">
        <h3 className="truncate font-display text-title-sm font-bold">{asset.name}</h3>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <LinkIcon {...iconPropsSm} size={12} aria-hidden />
            {usedBy > 0 ? t('assets.usedBy', { count: usedBy }) : t('assets.unused')}
          </span>
          {asset.variants.length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Layers {...iconPropsSm} size={12} aria-hidden />
              {t('assets.variantsCount', { count: asset.variants.length })}
            </span>
          )}
          {asset.kind === 'character' && (
            <span
              className={cn('inline-flex items-center gap-1.5', !asset.voiceRef && 'text-warn')}
            >
              {asset.voiceRef ? (
                <AudioLines {...iconPropsSm} size={12} aria-hidden />
              ) : (
                <VolumeX {...iconPropsSm} size={12} aria-hidden />
              )}
              {asset.voiceRef ? t('assets.hasVoice') : t('assets.noVoice')}
            </span>
          )}
          {asset.originals.length > 0 && (
            <span>{t('assets.originalsCount', { count: asset.originals.length })}</span>
          )}
        </div>
      </div>
    </Link>
  )
}
