import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageIcon, RefreshCw, Upload } from 'lucide-react'
import type { Asset } from '@dramai/api'
import { Button, Field, Hint, Notice, Textarea, cn, iconProps } from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useCall, useJobs } from '@/data/queries'
import { useApi } from '@/data/use-api'
import { Block } from '@/features/common/PageHead'
import { ErrorNotice } from '@/features/common/error-text'
import { BatchConfirmDialog } from '@/features/storyboard/BatchConfirmDialog'
import { versionNumber } from '@/features/storyboard/version-model'
import { sheetPath } from './asset-model'

/** 设定图：所有后续生成都以它为条件。重新生成不会覆盖旧图，只追加新版本。 */
export function SheetBlock({
  projectId,
  asset,
  usedByCount,
  aspect,
}: {
  projectId: string
  asset: Asset
  usedByCount: number
  aspect: '9:16' | '16:9' | '1:1'
}) {
  const { t } = useTranslation()
  const api = useApi()
  const jobs = useJobs()
  const file = useRef<HTMLInputElement>(null)
  const invalidate = [
    qk.asset(asset.id),
    qk.assets(projectId),
    qk.preflight,
    qk.artifacts,
    qk.episodes(projectId),
  ]
  const update = useCall('assets.update', { invalidate })
  const setCurrent = useCall('assets.setCurrentSheet', { invalidate })
  const upload = useCall('assets.uploadSheet', { invalidate })
  const field = asset.kind === 'character' ? 'appearance' : 'description'
  const saved = (asset[field] as string | undefined) ?? ''
  const [text, setText] = useState(saved)
  const [generating, setGenerating] = useState(false)
  const current = sheetPath(asset.sheet)
  const no = versionNumber(asset.sheet, asset.sheet.currentVersionId)
  const inFlight = (jobs.data?.items ?? []).find(
    (j) =>
      j.assetId === asset.id &&
      j.operation === 'asset_sheet' &&
      (j.status === 'queued' || j.status === 'running'),
  )
  const dirty = text !== saved

  return (
    <Block
      title={t('assets.sheet.title')}
      aside={t('assets.sheet.sub')}
      aria-label={t('assets.sheet.title')}
    >
      <div className="grid gap-4 p-4 @2xl:grid-cols-[220px_minmax(0,1fr)]">
        <div
          className={cn(
            'relative grid aspect-[3/4] place-items-center overflow-hidden rounded-sm',
            current ? 'bg-sunken' : 'border border-dashed border-border-strong text-subtle',
          )}
        >
          {current ? (
            <>
              <img
                src={api.fileUrl(projectId, current)}
                alt={t('assets.sheetAlt', { name: asset.name })}
                className="size-full object-contain"
              />
              {no && (
                <span className="absolute top-2 left-2 rounded-xs bg-black/60 px-1 font-mono text-[11px] leading-4 text-white">
                  {t('assets.sheet.currentBadge', { n: no })}
                </span>
              )}
            </>
          ) : (
            <span className="flex flex-col items-center gap-2 px-4 text-center text-xs">
              <ImageIcon size={20} strokeWidth={1.5} aria-hidden />
              {usedByCount > 0 ? t('assets.noSheetBlocks') : t('assets.noSheet')}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Field
            label={asset.kind === 'character' ? t('assets.appearance') : t('assets.description')}
          >
            <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {asset.kind === 'character' && <Hint>{t('assets.appearanceHint')}</Hint>}
          {dirty && (
            <div>
              <Button
                size="sm"
                variant="secondary"
                loading={update.isPending}
                onClick={() =>
                  update.mutate({
                    params: { assetId: asset.id },
                    body: { [field]: text.trim() || null },
                  })
                }
              >
                {t('assets.sheet.saveText')}
              </Button>
            </div>
          )}
          {inFlight && <Notice tone="info">{t('assets.sheet.inFlight')}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={Boolean(inFlight)}
              onClick={() => setGenerating(true)}
            >
              <RefreshCw {...iconProps} aria-hidden />
              {current ? t('assets.sheet.regenerate') : t('assets.sheet.generate')}
            </Button>
            <Button
              variant="secondary"
              loading={upload.isPending}
              onClick={() => file.current?.click()}
            >
              <Upload {...iconProps} aria-hidden />
              {t('assets.sheet.upload')}
            </Button>
            <input
              ref={file}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const form = new FormData()
                form.append('file', f)
                upload.mutate({ params: { assetId: asset.id }, form })
              }}
            />
          </div>
          <Notice tone="info">{t('assets.sheet.note', { count: usedByCount })}</Notice>
          {(update.isError || upload.isError || setCurrent.isError) && (
            <ErrorNotice error={update.error ?? upload.error ?? setCurrent.error} />
          )}
        </div>
      </div>

      {asset.sheet.versions.length > 0 && (
        <div className="border-t border-border p-4">
          <div className="mb-2 text-sm font-medium">{t('assets.sheet.history')}</div>
          <ul className="flex flex-wrap gap-2">
            {asset.sheet.versions.map((v, i) => {
              const cur = v.id === asset.sheet.currentVersionId
              return (
                <li
                  key={v.id}
                  aria-current={cur || undefined}
                  className={cn(
                    'flex w-24 flex-col gap-1 rounded-sm border p-1 text-xs',
                    cur ? 'border-accent' : 'border-border',
                  )}
                >
                  <img
                    src={api.fileUrl(projectId, v.file.path)}
                    alt={t('storyboard.versions.thumbAlt', { n: i + 1 })}
                    loading="lazy"
                    className="aspect-[3/4] w-full rounded-xs bg-sunken object-cover"
                  />
                  <span className="flex items-center justify-between font-mono">
                    v{i + 1}
                    <span className="font-sans text-subtle">
                      {t(`assets.sheet.source.${v.source}`)}
                    </span>
                  </span>
                  {cur ? (
                    <span className="text-accent-text">{t('storyboard.versions.current')}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1"
                      disabled={setCurrent.isPending}
                      aria-label={t('assets.sheet.setCurrentLabel', { n: i + 1 })}
                      onClick={() =>
                        setCurrent.mutate({
                          params: { assetId: asset.id },
                          body: { versionId: v.id },
                        })
                      }
                    >
                      {t('storyboard.versions.setCurrent')}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {generating && (
        <BatchConfirmDialog
          projectId={projectId}
          aspect={aspect}
          kind="asset_sheet"
          candidates={[
            {
              shotId: asset.id,
              label: asset.name,
              thumb: current,
              target: { kind: 'asset_sheet', assetId: asset.id },
            },
          ]}
          assets={new Map([[asset.id, asset]])}
          onClose={() => setGenerating(false)}
        />
      )}
    </Block>
  )
}
