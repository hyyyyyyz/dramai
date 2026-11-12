import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { Asset, FileRef } from '@dramai/api'
import { Button, Hint, iconProps } from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'
import { useApi } from '@/data/use-api'
import { Block } from '@/features/common/PageHead'
import { ErrorNotice } from '@/features/common/error-text'

/** 原图：你上传的，只是生成设定图的输入，不能直接顶替设定图。想用自己的图当设定图，走“登记为设定图”。 */
export function OriginalsBlock({ projectId, asset }: { projectId: string; asset: Asset }) {
  const { t } = useTranslation()
  const api = useApi()
  const file = useRef<HTMLInputElement>(null)
  const invalidate = [qk.asset(asset.id), qk.assets(projectId), qk.preflight, qk.artifacts]
  const add = useCall('assets.uploadOriginal', { invalidate })
  const register = useCall('assets.uploadSheet', { invalidate })

  /** 把已上传的原图登记为设定图：取回文件再作为设定图上传一次（接口只接受上传）。 */
  const registerAsSheet = async (o: FileRef) => {
    const res = await fetch(api.fileUrl(projectId, o.path), { credentials: 'same-origin' })
    const blob = await res.blob()
    const form = new FormData()
    form.append('file', new File([blob], o.path.split('/').pop() ?? 'original', { type: o.mime }))
    register.mutate({ params: { assetId: asset.id }, form })
  }

  return (
    <Block
      title={t('assets.originals.title')}
      aside={t('assets.originals.sub')}
      aria-label={t('assets.originals.title')}
    >
      <div className="flex flex-col gap-3 p-4">
        <ul className="flex flex-wrap gap-3">
          {asset.originals.map((o, i) => (
            <li key={o.sha256 || o.path} className="flex w-[72px] flex-col gap-1">
              <img
                src={api.fileUrl(projectId, o.path)}
                alt={t('assets.originals.alt', { n: i + 1 })}
                loading="lazy"
                className="aspect-[3/4] w-full rounded-sm bg-sunken object-cover"
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1 text-xs"
                disabled={register.isPending}
                aria-label={t('assets.originals.registerLabel', { n: i + 1 })}
                onClick={() => void registerAsSheet(o)}
              >
                {t('assets.originals.register')}
              </Button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => file.current?.click()}
              aria-label={t('assets.originals.add')}
              className="grid aspect-[3/4] w-[72px] place-items-center rounded-sm border border-dashed border-border-strong text-subtle hover:text-foreground"
            >
              <Plus {...iconProps} aria-hidden />
            </button>
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
                add.mutate({ params: { assetId: asset.id }, form })
              }}
            />
          </li>
        </ul>
        <Hint>{t('assets.originals.hint')}</Hint>
        {(add.isError || register.isError) && <ErrorNotice error={add.error ?? register.error} />}
      </div>
    </Block>
  )
}
