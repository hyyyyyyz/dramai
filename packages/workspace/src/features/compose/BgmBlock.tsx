import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Music, Trash2, Upload } from 'lucide-react'
import type { TimelineContent } from '@dramai/api'
import { Button, Field, Hint, iconProps } from '@dramai/ui/v2'
import { Block } from '@/features/common/PageHead'
import { ErrorNotice } from '@/features/common/error-text'
import { audioDurationUs } from './audio-duration'
import { clock, usToSec } from './timeline-model'

/**
 * 配乐：时间线目前只有一条，从头铺到尾（超出视频长度的部分会被截掉），首尾各淡入淡出 1 秒。
 * 没有多条、没有音轨分层，这里不画。
 */
export function BgmBlock({
  bgm,
  disabled,
  uploading,
  error,
  onUpload,
  onVolume,
  onRemove,
}: {
  bgm: TimelineContent['bgm']
  disabled?: boolean
  uploading?: boolean
  error?: unknown
  onUpload: (file: File, durationUs: number) => void
  onVolume: (volume: number) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState(false)
  const track = bgm[0]
  return (
    <Block
      title={t('compose.bgm.title')}
      aside={track ? undefined : t('compose.bgm.none')}
      aria-label={t('compose.bgm.title')}
    >
      <div className="flex flex-col gap-3 p-4">
        {track && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <Music {...iconProps} size={14} aria-hidden />
              <span>
                {t('compose.bgm.length', { length: clock(usToSec(track.outUs - track.inUs)) })}
              </span>
            </div>
            <Field label={t('compose.bgm.volume')}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={track.volume}
                disabled={disabled}
                onChange={(e) => onVolume(Number(e.target.value))}
                aria-valuetext={`${Math.round(track.volume * 100)}%`}
                className="w-full accent-[var(--accent)]"
              />
            </Field>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            loading={uploading}
            onClick={() => input.current?.click()}
          >
            <Upload {...iconProps} aria-hidden />
            {track ? t('compose.bgm.replace') : t('compose.bgm.upload')}
          </Button>
          {track && (
            <Button size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>
              <Trash2 {...iconProps} aria-hidden />
              {t('compose.bgm.remove')}
            </Button>
          )}
          <input
            ref={input}
            type="file"
            hidden
            accept="audio/*"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              setLocalError(false)
              audioDurationUs(f).then(
                (us) => onUpload(f, us),
                () => setLocalError(true),
              )
            }}
          />
        </div>
        <Hint>{t('compose.bgm.hint')}</Hint>
        {localError && <p className="text-sm text-danger">{t('compose.bgm.unreadable')}</p>}
        {error ? <ErrorNotice error={error} /> : null}
      </div>
    </Block>
  )
}
