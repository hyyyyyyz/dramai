import { useTranslation } from 'react-i18next'
import { Lock, Unlock } from 'lucide-react'
import { CopyField, Notice, Skeleton, iconProps, useToast } from '@dramai/ui/v2'
import { useDesktopInfo } from '@/desktop/bridge'
import { useSystem } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { Block } from '@/features/common/PageHead'

/**
 * 设置 · 访问与安全：这个服务要不要访问令牌、当前用什么地址打开。
 * 令牌和监听地址只能在启动时设置（--token / --host），页面上不显示、也不改令牌。
 */
export function AccessPage() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const system = useSystem()
  const desktop = useDesktopInfo()
  if (system.isError) return <ErrorNotice error={system.error} />
  if (!system.data) return <Skeleton className="h-40" aria-busy />
  const required = system.data.auth.tokenRequired
  const host = window.location.host
  const loopback = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)

  return (
    <div className="flex flex-col gap-6">
      {desktop?.secretStorage === 'plain' && (
        <Notice tone="warn">{t('desktop.plainSecrets')}</Notice>
      )}
      <Block title={t('settings.access.token.title')} aria-label={t('settings.access.token.title')}>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 font-medium">
            {required ? <Lock {...iconProps} aria-hidden /> : <Unlock {...iconProps} aria-hidden />}
            {required ? t('settings.access.token.on') : t('settings.access.token.off')}
          </div>
          <p className="text-sm text-muted-foreground">
            {required ? t('settings.access.token.onBody') : t('settings.access.token.offBody')}
          </p>
          <p className="text-sm text-muted-foreground">{t('settings.access.token.how')}</p>
        </div>
      </Block>

      <Block title={t('settings.access.host.title')} aria-label={t('settings.access.host.title')}>
        <div className="flex flex-col gap-3 p-4">
          <CopyField
            aria-label={t('settings.access.host.current')}
            value={window.location.origin}
            copyLabel={t('common.copy')}
            copiedLabel={t('common.copied')}
            onCopied={() => toast({ title: t('common.copied') })}
          />
          <p className="text-sm text-muted-foreground">
            {loopback
              ? t('settings.access.host.local')
              : t('settings.access.host.remote', { host })}
          </p>
          {!loopback && !required && (
            <Notice tone="danger">{t('settings.access.host.remoteNoToken')}</Notice>
          )}
          <p className="text-sm text-muted-foreground">{t('settings.access.host.how')}</p>
        </div>
      </Block>
    </div>
  )
}
