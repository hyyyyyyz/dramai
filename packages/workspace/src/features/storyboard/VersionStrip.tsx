import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play } from 'lucide-react'
import type { MediaSlot } from '@dramai/api'
import { Button, cn } from '@dramai/ui/v2'
import { useApi } from '@/data/use-api'
import { useFormat } from '@/i18n/format'
import { versionNumber } from './version-model'

/**
 * 画面和视频各自的当前版本与历史：一排缩略图，当前用朱砂描边，旧版有“设为当前”。
 * 重新生成不会覆盖旧版本，旧版一直保留。
 */
export function VersionStrip({
  projectId,
  imageSlot,
  videoSlot,
  imageThumbs = true,
  onSetCurrent,
  busy,
}: {
  projectId: string
  imageSlot: MediaSlot
  videoSlot: MediaSlot
  imageThumbs?: boolean
  onSetCurrent: (slot: 'image' | 'video', versionId: string) => void
  busy?: boolean
}) {
  const { t } = useTranslation()
  const api = useApi()
  const fmt = useFormat()
  const [open, setOpen] = useState(false)
  const imgNo = versionNumber(imageSlot, imageSlot.currentVersionId)
  const vidNo = versionNumber(videoSlot, videoSlot.currentVersionId)
  const total = imageSlot.versions.length + videoSlot.versions.length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t('storyboard.versions.image')}{' '}
          <span className="font-mono">{imgNo ? `v${imgNo}` : t('storyboard.versions.none')}</span>
          {imageSlot.versions.length > 1 && (
            <> {t('storyboard.versions.of', { count: imageSlot.versions.length })}</>
          )}
        </span>
        <span>
          {t('storyboard.versions.video')}{' '}
          <span className="font-mono">{vidNo ? `v${vidNo}` : t('storyboard.versions.none')}</span>
          {videoSlot.versions.length > 1 && (
            <> {t('storyboard.versions.of', { count: videoSlot.versions.length })}</>
          )}
        </span>
        {total > 1 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {t('storyboard.versions.history')}
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
          {(
            [
              ['image', imageSlot],
              ['video', videoSlot],
            ] as const
          ).map(([kind, slot]) =>
            slot.versions.length === 0 ? null : (
              <div key={kind} className="flex flex-col gap-2">
                <div className="text-xs text-subtle">{t(`storyboard.versions.${kind}`)}</div>
                <ul className="flex flex-wrap gap-2">
                  {slot.versions.map((v, i) => {
                    const current = v.id === slot.currentVersionId
                    return (
                      <li
                        key={v.id}
                        aria-current={current || undefined}
                        className={cn(
                          'flex w-24 flex-col gap-1 rounded-sm border p-1 text-xs',
                          current ? 'border-accent' : 'border-border',
                        )}
                      >
                        <div className="relative grid aspect-[3/4] place-items-center overflow-hidden rounded-xs bg-sunken">
                          {kind === 'image' && imageThumbs ? (
                            <img
                              src={api.fileUrl(projectId, v.file.path)}
                              alt={t('storyboard.versions.thumbAlt', { n: i + 1 })}
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          ) : (
                            <Play size={14} strokeWidth={1.5} aria-hidden className="text-subtle" />
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono">v{i + 1}</span>
                          <span className="text-subtle">
                            {kind === 'video' && v.facts?.durationSec
                              ? fmt.duration(v.facts.durationSec * 1000)
                              : ''}
                          </span>
                        </div>
                        {current ? (
                          <span className="text-accent-text">
                            {t('storyboard.versions.current')}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1"
                            disabled={busy}
                            aria-label={t('storyboard.versions.setCurrentLabel', {
                              kind: t(`storyboard.versions.${kind}`),
                              n: i + 1,
                            })}
                            onClick={() => onSetCurrent(kind, v.id)}
                          >
                            {t('storyboard.versions.setCurrent')}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ),
          )}
          <p className="text-xs text-subtle">{t('storyboard.versions.note')}</p>
        </div>
      )}
    </div>
  )
}
