import { useTranslation } from 'react-i18next'
import { cn } from '@dramai/ui/v2'
import { useEventSnapshot } from '@/data/use-events'
import { useSystem } from '@/data/queries'

function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-2 flex-none rounded-full',
        tone === 'ok' && 'bg-success',
        tone === 'warn' && 'bg-warn',
        tone === 'bad' && 'bg-danger',
      )}
    />
  )
}

/** 侧栏底部：本地服务（由 SSE 连接和 /api/system 判断）、ffmpeg、数据目录。 */
export function ServiceStatus({ showDataDir }: { showDataDir?: boolean }) {
  const { t } = useTranslation()
  const system = useSystem()
  const { status } = useEventSnapshot()
  const serviceTone =
    system.isError || status === 'closed' ? 'bad' : status === 'connecting' ? 'warn' : 'ok'
  const serviceText =
    serviceTone === 'bad'
      ? t('shell.serviceDown')
      : serviceTone === 'warn'
        ? t('shell.serviceConnecting')
        : t('shell.serviceOk')
  const ff = system.data?.ffmpeg
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background p-3 text-xs leading-normal text-muted-foreground">
      <div className="flex items-center gap-2" role="status">
        <Dot tone={serviceTone} />
        {serviceText}
      </div>
      {ff && (
        <div className="flex items-center gap-2" title={ff.ok ? ff.version : ff.error}>
          <Dot tone={ff.ok ? 'ok' : ff.found ? 'warn' : 'bad'} />
          {ff.ok
            ? t('shell.ffmpegOk')
            : ff.found
              ? t('shell.ffmpegLimited')
              : t('shell.ffmpegMissing')}
        </div>
      )}
      {showDataDir && system.data && (
        <div className="min-w-0 truncate text-subtle" title={system.data.dataDir}>
          {t('shell.dataDir', { dir: system.data.dataDir })}
        </div>
      )}
    </div>
  )
}
