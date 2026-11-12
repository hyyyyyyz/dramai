import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Field, Hint, Notice, SegmentedControl } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall, useSettings, useSystem } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'

type Subtitles = 'soft' | 'burn' | 'none'
const SIZES = [480, 720, 1080] as const

/**
 * 渲染成片的选项：字幕方式（内嵌可切换 / 烧进画面 / 不要）、清晰度（短边像素）。
 * 烧进画面要 ffmpeg 有字幕滤镜；没有就把这一项置灰并写明原因，不让用户点了才报错。
 */
export function RenderDialog({
  episodeId,
  onClose,
  onStarted,
}: {
  episodeId: string
  onClose: () => void
  onStarted?: () => void
}) {
  const { t } = useTranslation()
  const settings = useSettings()
  const system = useSystem()
  const canBurn = system.data?.ffmpeg.features?.subtitleBurnIn !== false
  const [subtitles, setSubtitles] = useState<Subtitles | undefined>(undefined)
  const [size, setSize] = useState<(typeof SIZES)[number]>(720)
  const chosen: Subtitles = (() => {
    const v = subtitles ?? settings.data?.defaultSubtitles ?? 'soft'
    return v === 'burn' && !canBurn ? 'soft' : v
  })()
  const compose = useCall('episodes.compose', { invalidate: [qk.jobs, qk.artifacts, ['episode']] })

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={t('compose.render.title')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={compose.isPending}
            onClick={() =>
              compose.mutate(
                { params: { episodeId }, body: { subtitles: chosen, shortSide: size } },
                {
                  onSuccess: () => {
                    onStarted?.()
                    onClose()
                  },
                },
              )
            }
          >
            {t('compose.render.start')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('compose.render.subtitles')}>
          <SegmentedControl
            aria-label={t('compose.render.subtitles')}
            value={chosen}
            onValueChange={setSubtitles}
            options={[
              { value: 'soft', label: t('compose.render.sub.soft') },
              { value: 'burn', label: t('compose.render.sub.burn'), disabled: !canBurn },
              { value: 'none', label: t('compose.render.sub.none') },
            ]}
          />
          <Hint>{t(`compose.render.subHint.${chosen}`)}</Hint>
        </Field>
        {!canBurn && <Notice tone="warn">{t('compose.render.noBurn')}</Notice>}
        <Field label={t('compose.render.size')}>
          <SegmentedControl
            aria-label={t('compose.render.size')}
            value={String(size) as `${(typeof SIZES)[number]}`}
            onValueChange={(v) => setSize(Number(v) as (typeof SIZES)[number])}
            options={SIZES.map((s) => ({ value: String(s) as `${typeof s}`, label: `${s}p` }))}
          />
          <Hint>{t('compose.render.sizeHint')}</Hint>
        </Field>
        <p className="text-sm text-muted-foreground">{t('compose.render.honest')}</p>
        {compose.isError && <ErrorNotice error={compose.error} />}
      </div>
    </Modal>
  )
}
