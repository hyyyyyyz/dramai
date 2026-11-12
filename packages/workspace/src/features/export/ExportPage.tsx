import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Download, FileArchive, Film, Captions, Mic } from 'lucide-react'
import { Button, Checkbox, Notice, Pill, Skeleton, iconProps } from '@dramai/ui/v2'
import { useCurrentEpisodeSync } from '@/data/current-episode'
import { useApi } from '@/data/use-api'
import { useEpisode, useEpisodeArtifacts, useSystem, useTimeline } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { Block, PageHead } from '@/features/common/PageHead'
import { useFormat } from '@/i18n/format'
import {
  findReport,
  formatBytes,
  hasFile,
  summarizeNarration,
  type ExportStatus,
} from './export-model'

const TONE = {
  current: 'success',
  stale: 'warn',
  missing: 'neutral',
  blocked: 'danger',
  ready: 'info',
} as const

function Row({
  icon,
  title,
  basis,
  status,
  size,
  children,
}: {
  icon: React.ReactNode
  title: string
  basis: string
  status: ExportStatus | 'ready'
  size?: string
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  return (
    <li className="grid grid-cols-[32px_minmax(0,1.4fr)_minmax(0,1fr)_96px_auto] items-center gap-3 border-t border-border px-4 py-3 first:border-t-0 max-[800px]:grid-cols-[32px_minmax(0,1fr)] max-[800px]:gap-y-2">
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-md bg-surface-2 text-muted-foreground"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="font-sans text-base font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{basis}</p>
      </div>
      <div className="max-[800px]:col-start-2">
        <Pill tone={TONE[status]}>{t(`export.status.${status}`)}</Pill>
      </div>
      <span className="text-sm text-muted-foreground tabular-nums max-[800px]:col-start-2">
        {size ?? '—'}
      </span>
      <div className="flex flex-wrap justify-end gap-2 max-[800px]:col-start-2 max-[800px]:justify-start">
        {children}
      </div>
    </li>
  )
}

/** 下载：一个指向导出地址的链接，样式是按钮；是文件，不是页面跳转。 */
function DownloadLink({
  href,
  variant = 'secondary',
  children,
}: {
  href: string
  variant?: 'secondary' | 'ghost'
  children: React.ReactNode
}) {
  return (
    <a href={href} download>
      <Button size="sm" variant={variant} tabIndex={-1}>
        <Download {...iconProps} size={14} aria-hidden />
        {children}
      </Button>
    </a>
  )
}

export function ExportPage() {
  const { projectId = '', episodeId = '' } = useParams()
  const { t } = useTranslation()
  const api = useApi()
  const fmt = useFormat()
  useCurrentEpisodeSync(projectId, episodeId)
  const episode = useEpisode(episodeId)
  const artifacts = useEpisodeArtifacts(episodeId)
  const timeline = useTimeline(episodeId)
  const system = useSystem()
  const [images, setImages] = useState(true)
  const [withCut, setWithCut] = useState(false)

  if (episode.isError) return <ErrorNotice error={episode.error} />
  if (!episode.data || !artifacts.data) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  const reports = artifacts.data.items
  const base = `/projects/${projectId}/episodes/${episodeId}`
  const ep = episode.data.episode
  const cut = findReport(reports, 'cut')
  const subs = findReport(reports, 'subtitles')
  const narration = summarizeNarration(reports)
  const blockingIssues = timeline.data?.issues.filter((i) => i.severity === 'blocking').length ?? 0
  const packageBlocked = timeline.data ? timeline.data.hasBlockingIssues : false
  const hasClips = (timeline.data?.revision.content.clips.length ?? 0) > 0
  const packageHref = `${api.exportUrl('package', episodeId)}?images=${images ? 1 : 0}&cut=${withCut && hasFile(cut) ? 1 : 0}`
  const ffmpeg = system.data?.ffmpeg

  return (
    <>
      <PageHead
        title={t('export.title', { n: ep.number, title: ep.title })}
        sub={t('export.sub')}
        actions={
          <Link to={`${base}/compose`}>
            <Button variant="secondary" tabIndex={-1}>
              <Film {...iconProps} aria-hidden />
              {t('export.goCompose')}
            </Button>
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        <Block
          title={t('export.block.episode')}
          aside={ffmpeg ? (ffmpeg.ok ? t('export.ffmpeg.ok') : t('export.ffmpeg.bad')) : undefined}
          aria-label={t('export.block.episode')}
        >
          <ul>
            <Row
              icon={<Film {...iconProps} aria-hidden />}
              title={t('export.cut.title')}
              basis={t(`export.cut.basis.${cut?.status ?? 'missing'}`)}
              status={cut?.status ?? 'missing'}
              size={cut?.file ? formatBytes(cut.file.bytes, fmt.locale) : undefined}
            >
              {(cut?.status === 'stale' || !hasFile(cut)) && (
                <Link to={`${base}/compose`}>
                  <Button size="sm" variant="secondary" tabIndex={-1}>
                    {hasFile(cut) ? t('export.cut.rerender') : t('export.cut.render')}
                  </Button>
                </Link>
              )}
              {hasFile(cut) && (
                <DownloadLink
                  href={api.exportUrl('cut', episodeId)}
                  variant={cut?.status === 'stale' ? 'ghost' : 'secondary'}
                >
                  {cut?.status === 'stale' ? t('export.downloadAnyway') : t('export.download')}
                </DownloadLink>
              )}
            </Row>

            <Row
              icon={<Captions {...iconProps} aria-hidden />}
              title={t('export.subs.title')}
              basis={hasClips ? t('export.subs.basis') : t('export.subs.basisEmpty')}
              status={subs?.status ?? (hasClips ? 'current' : 'missing')}
              size={subs?.file ? formatBytes(subs.file.bytes, fmt.locale) : undefined}
            >
              {hasClips && (
                <>
                  <DownloadLink href={api.exportUrl('srt', episodeId)}>SRT</DownloadLink>
                  <DownloadLink href={api.exportUrl('vtt', episodeId)}>VTT</DownloadLink>
                </>
              )}
            </Row>

            <Row
              icon={<Mic {...iconProps} aria-hidden />}
              title={t('export.narration.title')}
              basis={
                narration.total === 0
                  ? t('export.narration.none')
                  : t('export.narration.basis', {
                      current: narration.current,
                      total: narration.total,
                    })
              }
              status={narration.total === 0 ? 'missing' : narration.status}
            >
              {narration.status !== 'current' && narration.total > 0 && (
                <Link to={`${base}/compose`}>
                  <Button size="sm" variant="secondary" tabIndex={-1}>
                    {t('export.narration.go')}
                  </Button>
                </Link>
              )}
            </Row>

            <Row
              icon={<FileArchive {...iconProps} aria-hidden />}
              title={t('export.package.title')}
              basis={
                packageBlocked
                  ? t('export.package.basisBlocked', { count: blockingIssues })
                  : t('export.package.basis')
              }
              status={packageBlocked ? 'blocked' : hasClips ? 'ready' : 'missing'}
            >
              {packageBlocked ? (
                <Link to={`${base}/compose`}>
                  <Button size="sm" variant="ghost" tabIndex={-1}>
                    {t('export.package.fix')}
                  </Button>
                </Link>
              ) : hasClips ? (
                <DownloadLink href={packageHref}>{t('export.package.download')}</DownloadLink>
              ) : null}
            </Row>
          </ul>
        </Block>

        {!packageBlocked && hasClips && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
            <span className="font-medium">{t('export.package.options')}</span>
            <Checkbox
              checked={images}
              onChange={(e) => setImages(e.target.checked)}
              label={t('export.package.images')}
            />
            <Checkbox
              checked={withCut && hasFile(cut)}
              disabled={!hasFile(cut)}
              onChange={(e) => setWithCut(e.target.checked)}
              label={t('export.package.cut')}
            />
          </div>
        )}

        <Notice tone="info">{t('export.package.note')}</Notice>
        <p className="text-sm text-muted-foreground">
          {t('export.project.before')}{' '}
          <Link to="/settings/data" className="text-accent-text underline underline-offset-2">
            {t('export.project.link')}
          </Link>
        </p>
      </div>
    </>
  )
}
