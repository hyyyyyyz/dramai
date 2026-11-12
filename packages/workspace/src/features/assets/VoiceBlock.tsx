import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'
import type { Asset } from '@dramai/api'
import { Button, Hint, iconProps } from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'
import { useApi } from '@/data/use-api'
import { Block } from '@/features/common/PageHead'
import { ErrorNotice } from '@/features/common/error-text'

/**
 * 角色的音色参考：先试听，听准了再开始按秒计费的视频生成。
 * 角色在 2 个以上镜头开口时，生成视频会把这段音频一并发给模型，让同一个人跨镜头保持同一个嗓子。
 */
export function VoiceBlock({ projectId, asset }: { projectId: string; asset: Asset }) {
  const { t } = useTranslation()
  const api = useApi()
  const file = useRef<HTMLInputElement>(null)
  const upload = useCall('assets.uploadVoice', {
    invalidate: [qk.asset(asset.id), qk.assets(projectId), qk.preflight],
  })
  return (
    <Block title={t('assets.voice.title')} aria-label={t('assets.voice.title')}>
      <div className="flex flex-col gap-3 p-4">
        {asset.voiceRef ? (
          <audio
            controls
            preload="metadata"
            src={api.fileUrl(projectId, asset.voiceRef.path)}
            aria-label={t('assets.voice.play', { name: asset.name })}
            className="w-full"
          />
        ) : (
          <p className="text-sm text-warn">{t('assets.voice.none')}</p>
        )}
        <Hint>{t('assets.voice.hint')}</Hint>
        <div>
          <Button
            size="sm"
            variant="secondary"
            loading={upload.isPending}
            onClick={() => file.current?.click()}
          >
            <Upload {...iconProps} aria-hidden />
            {asset.voiceRef ? t('assets.voice.replace') : t('assets.voice.upload')}
          </Button>
          <input
            ref={file}
            type="file"
            hidden
            accept="audio/*"
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
        {upload.isError && <ErrorNotice error={upload.error} />}
      </div>
    </Block>
  )
}
