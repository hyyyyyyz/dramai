import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { TimelineContent } from '@dramai/api'
import { Button, Field, Hint, IconButton, Input, SegmentedControl, iconProps } from '@dramai/ui/v2'
import { Block } from '@/features/common/PageHead'
import { clipName, secToUs, usToSec, type Clip, type Placement } from './timeline-model'

type Placed = Placement['clips'][number]

/**
 * 片段检查器：入点出点（只对记录它时的视频版本有效）、原声音量、出点定格、承载旁白、前后挪动。
 * 到下一段的转场：后端目前只做硬切，所以这里写明，不画选项。
 * 输入框的草稿只在挂载时取值：外面用 key 在片段或它的值变化时重新挂载。
 */
export function ClipInspector({
  content,
  clip,
  placed,
  shotIndex,
  disabled,
  onChange,
  onMove,
}: {
  content: TimelineContent
  clip: Clip
  placed: Placed | undefined
  shotIndex?: number
  disabled?: boolean
  onChange: (
    patch: Partial<Clip>,
    summary: { key: 'trim' | 'volume' | 'hold' | 'carries'; value?: string },
  ) => void
  onMove: (dir: -1 | 1) => void
}) {
  const { t } = useTranslation()
  const srcIn = usToSec(placed?.srcInUs ?? 0)
  const srcOut = usToSec(placed?.srcOutUs ?? 0)
  const [inSec, setIn] = useState(srcIn.toFixed(3))
  const [outSec, setOut] = useState(srcOut.toFixed(3))
  const [vol, setVol] = useState(String(clip.sourceVolume))
  const [hold, setHold] = useState(usToSec(clip.holdUs).toFixed(3))

  const num = (s: string) => (s.trim() === '' ? NaN : Number(s))
  const volN = num(vol)
  const holdN = num(hold)
  const inN = num(inSec)
  const outN = num(outSec)
  const volOk = Number.isFinite(volN) && volN >= 0 && volN <= 1
  const holdOk = Number.isFinite(holdN) && holdN >= 0 && holdN <= 10
  // 没有视频的片段没有入点出点可调（输入框是禁用的），不报错
  const trimOk =
    !placed?.videoVersionId ||
    (Number.isFinite(inN) && Number.isFinite(outN) && inN >= 0 && outN > inN)
  const idx = content.clips.findIndex((c) => c.id === clip.id)
  const label = shotIndex
    ? t('compose.inspector.clipOf', {
        clip: clipName(content, clip.id),
        n: String(shotIndex).padStart(2, '0'),
      })
    : clipName(content, clip.id)

  return (
    <Block
      title={label}
      aside={t('compose.inspector.selected')}
      aria-label={t('compose.inspector.title')}
    >
      <div className="grid grid-cols-2 gap-4 p-4 max-[640px]:grid-cols-1">
        <Field
          label={t('compose.inspector.in')}
          error={trimOk ? undefined : t('compose.inspector.trimInvalid')}
        >
          <Input
            mono
            inputMode="decimal"
            value={inSec}
            disabled={disabled || !placed?.videoVersionId}
            onChange={(e) => setIn(e.target.value)}
            onBlur={() =>
              trimOk &&
              inN !== srcIn &&
              onChange(
                {
                  trim: {
                    inUs: secToUs(inN),
                    outUs: secToUs(outN),
                    basisVersionId: placed!.videoVersionId!,
                  },
                },
                { key: 'trim' },
              )
            }
          />
        </Field>
        <Field label={t('compose.inspector.out')}>
          <Input
            mono
            inputMode="decimal"
            value={outSec}
            disabled={disabled || !placed?.videoVersionId}
            onChange={(e) => setOut(e.target.value)}
            onBlur={() =>
              trimOk &&
              outN !== srcOut &&
              onChange(
                {
                  trim: {
                    inUs: secToUs(inN),
                    outUs: secToUs(outN),
                    basisVersionId: placed!.videoVersionId!,
                  },
                },
                { key: 'trim' },
              )
            }
          />
        </Field>
        <Field
          label={t('compose.inspector.volume')}
          error={volOk ? undefined : t('compose.inspector.volumeInvalid')}
          hint={
            clip.sourceVolume === 0 && placed?.videoVersionId && volOk
              ? t('video.mutedClip')
              : undefined
          }
        >
          <Input
            mono
            inputMode="decimal"
            value={vol}
            disabled={disabled}
            onChange={(e) => setVol(e.target.value)}
            onBlur={() =>
              volOk &&
              volN !== clip.sourceVolume &&
              onChange({ sourceVolume: volN }, { key: 'volume', value: String(volN) })
            }
          />
        </Field>
        <Field
          label={t('compose.inspector.hold')}
          error={holdOk ? undefined : t('compose.inspector.holdInvalid')}
        >
          <Input
            mono
            inputMode="decimal"
            value={hold}
            disabled={disabled}
            onChange={(e) => setHold(e.target.value)}
            onBlur={() =>
              holdOk &&
              secToUs(holdN) !== clip.holdUs &&
              onChange({ holdUs: secToUs(holdN) }, { key: 'hold', value: holdN.toFixed(1) })
            }
          />
        </Field>
        <div className="col-span-full flex flex-col gap-2">
          <span className="text-sm font-medium">{t('compose.inspector.carries')}</span>
          <SegmentedControl
            aria-label={t('compose.inspector.carries')}
            value={clip.carriesNarration ? 'yes' : 'no'}
            onValueChange={(v) =>
              !disabled &&
              (v === 'yes') !== clip.carriesNarration &&
              onChange({ carriesNarration: v === 'yes' }, { key: 'carries', value: v })
            }
            options={[
              { value: 'yes', label: t('compose.inspector.yes') },
              { value: 'no', label: t('compose.inspector.no') },
            ]}
          />
        </div>
        <div className="col-span-full flex flex-wrap items-center gap-2">
          <IconButton
            label={t('compose.inspector.earlier')}
            disabled={disabled || idx <= 0}
            onClick={() => onMove(-1)}
          >
            <ArrowLeft {...iconProps} aria-hidden />
          </IconButton>
          <IconButton
            label={t('compose.inspector.later')}
            disabled={disabled || idx >= content.clips.length - 1}
            onClick={() => onMove(1)}
          >
            <ArrowRight {...iconProps} aria-hidden />
          </IconButton>
          <Button size="sm" variant="ghost" disabled>
            {t('compose.inspector.transition')}
          </Button>
        </div>
        <Hint className="col-span-full">{t('compose.inspector.hint')}</Hint>
      </div>
    </Block>
  )
}
