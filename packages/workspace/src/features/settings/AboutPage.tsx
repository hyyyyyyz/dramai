import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'
import { Pill, Skeleton, iconProps } from '@dramai/ui/v2'
import { useSystem } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { Block } from '@/features/common/PageHead'
import { useFormat } from '@/i18n/format'

const FEATURES = [
  'h264',
  'aac',
  'baseFilters',
  'subtitleBurnIn',
  'transitions',
  'loudness',
  'probe',
] as const
const isFeature = (k: string): k is (typeof FEATURES)[number] =>
  (FEATURES as readonly string[]).includes(k)

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-t border-border py-2 first:border-t-0 max-[640px]:grid-cols-1 max-[640px]:gap-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-mono text-sm break-all">{value}</dd>
    </div>
  )
}

/** 设置 · 关于：版本、运行环境，以及 ffmpeg 的路径、版本和能力（缺什么、为什么、怎么办）。 */
export function AboutPage() {
  const { t } = useTranslation()
  const fmt = useFormat()
  const system = useSystem()
  if (system.isError) return <ErrorNotice error={system.error} />
  if (!system.data) return <Skeleton className="h-40" aria-busy />
  const s = system.data
  const f = s.ffmpeg

  return (
    <div className="flex flex-col gap-6">
      <Block title={t('settings.about.app.title')} aria-label={t('settings.about.app.title')}>
        <dl className="px-4 py-2">
          <Fact label={t('settings.about.app.version')} value={s.version} />
          <Fact label={t('settings.about.app.node')} value={s.node} />
          <Fact label={t('settings.about.app.platform')} value={s.platform} />
          <Fact label={t('settings.about.app.started')} value={fmt.dateTime(s.startedAt)} />
        </dl>
      </Block>

      <Block
        title="ffmpeg"
        aside={
          <Pill tone={f.ok ? 'success' : 'danger'}>
            {f.ok ? t('settings.about.ffmpeg.ok') : t('settings.about.ffmpeg.bad')}
          </Pill>
        }
        aria-label="ffmpeg"
      >
        <div className="flex flex-col gap-4 p-4">
          {!f.found && (
            <p className="text-sm text-danger">{f.error ?? t('settings.about.ffmpeg.notFound')}</p>
          )}
          {f.found && (
            <dl>
              {f.path && <Fact label={t('settings.about.ffmpeg.path')} value={f.path} />}
              {f.source && (
                <Fact
                  label={t('settings.about.ffmpeg.source')}
                  value={t(`settings.about.ffmpeg.sources.${f.source}`)}
                />
              )}
              {f.version && <Fact label={t('settings.about.ffmpeg.version')} value={f.version} />}
              {f.videoEncoder && (
                <Fact label={t('settings.about.ffmpeg.encoder')} value={f.videoEncoder} />
              )}
            </dl>
          )}
          {f.features && (
            <ul
              aria-label={t('settings.about.ffmpeg.features')}
              className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm max-[640px]:grid-cols-1"
            >
              {Object.entries(f.features).map(([k, on]) => (
                <li key={k} className="flex items-center gap-2">
                  {on ? (
                    <Check {...iconProps} size={14} className="text-success" aria-hidden />
                  ) : (
                    <X {...iconProps} size={14} className="text-danger" aria-hidden />
                  )}
                  <span>{isFeature(k) ? t(`settings.about.ffmpeg.feature.${k}`) : k}</span>
                  <span className="sr-only">
                    {on
                      ? t('settings.about.ffmpeg.available')
                      : t('settings.about.ffmpeg.unavailable')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {f.missing.length > 0 && (
            <ul className="flex flex-col gap-3">
              {f.missing.map((m) => (
                <li key={m.feature} className="rounded-md bg-surface-2 p-3 text-sm">
                  <div className="font-medium">
                    {isFeature(m.feature)
                      ? t(`settings.about.ffmpeg.feature.${m.feature}`)
                      : m.feature}{' '}
                    ·{' '}
                    {m.required
                      ? t('settings.about.ffmpeg.required')
                      : t('settings.about.ffmpeg.optional')}
                  </div>
                  <p className="text-muted-foreground">{m.reason}</p>
                  <p>{m.remedy}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Block>
    </div>
  )
}
