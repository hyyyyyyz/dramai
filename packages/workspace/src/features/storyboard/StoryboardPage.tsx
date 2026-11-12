import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Film, ImageIcon, MapPin, Sparkles, Split } from 'lucide-react'
import type { ArtifactReport, Asset, Shot } from '@dramai/api'
import {
  Button,
  EmptyState,
  Modal,
  Notice,
  Skeleton,
  iconProps,
  iconPropsLg,
  cn,
} from '@dramai/ui/v2'
import { useCurrentEpisodeSync } from '@/data/current-episode'
import { qk } from '@/data/keys'
import {
  useAssets,
  useCall,
  useCandidates,
  useEpisode,
  useEpisodeArtifacts,
  useJobs,
  useProject,
} from '@/data/queries'
import { useJobOps } from '@/features/jobs/job-ops-context'
import { StreamedText } from '@/features/jobs/StreamedText'
import { ErrorNotice } from '@/features/common/error-text'
import { PageHead } from '@/features/common/PageHead'
import { useShell } from '@/layout/shell-context'
import { useFormat } from '@/i18n/format'
import { BatchConfirmDialog } from './BatchConfirmDialog'
import type { BatchCandidate, BatchKind } from './batch-model'
import { ShotCard } from './ShotCard'
import { ShotEditDialog } from './ShotEditDialog'
import type { ReasonAction } from './reasons'
import { countViews, currentImage, deriveShotView, groupScenes, refsByShot } from './shot-model'
import { useKeptStale } from './use-kept-stale'
import { useEpisodeVerdicts } from './use-verdicts'

type Batch = { kind: Exclude<BatchKind, 'asset_sheet'>; shotIds: string[] }

export function StoryboardPage() {
  const { projectId = '', episodeId = '' } = useParams()
  const { t } = useTranslation()
  const fmt = useFormat()
  const shell = useShell()
  const ops = useJobOps()
  useCurrentEpisodeSync(projectId, episodeId)

  const project = useProject(projectId)
  const episode = useEpisode(episodeId)
  const artifacts = useEpisodeArtifacts(episodeId)
  const assetsQ = useAssets(projectId)
  const candidates = useCandidates(projectId)
  const jobs = useJobs()
  const kept = useKeptStale()

  const [batch, setBatch] = useState<Batch>()
  const [editing, setEditing] = useState<{ shot: Shot; index: number }>()
  const [deleting, setDeleting] = useState<{ shot: Shot; index: number }>()

  const invalidate = [['episode'], qk.episodes(projectId), qk.preflight, qk.artifacts, qk.projects]
  const setVersion = useCall('shots.setCurrentVersion', { invalidate })
  const reorder = useCall('shots.reorder', { invalidate })
  const remove = useCall('shots.delete', { invalidate })
  const breakdown = useCall('episodes.breakdown', { invalidate: [...invalidate, qk.jobs] })
  const prompts = useCall('episodes.generatePrompts', { invalidate: [...invalidate, qk.jobs] })
  const extract = useCall('episodes.extractEntities', { invalidate: [...invalidate, qk.jobs] })

  const detail = episode.data
  const groups = useMemo(() => (detail ? groupScenes(detail) : []), [detail])
  const shotIds = useMemo(() => groups.flatMap((g) => g.shots.map((s) => s.shot.id)), [groups])
  const verdicts = useEpisodeVerdicts(projectId, shotIds)
  const assets = useMemo(
    () => new Map<string, Asset>((assetsQ.data?.items ?? []).map((a) => [a.id, a])),
    [assetsQ.data],
  )
  const reports = useMemo(
    () => new Map<string, ArtifactReport>((artifacts.data?.items ?? []).map((r) => [r.key, r])),
    [artifacts.data],
  )
  const refs = useMemo(() => refsByShot(detail?.refs ?? []), [detail])
  const jobItems = useMemo(() => jobs.data?.items ?? [], [jobs.data])

  const views = useMemo(
    () =>
      new Map(
        groups
          .flatMap((g) => g.shots)
          .map(
            ({ shot }) =>
              [
                shot.id,
                deriveShotView(shot, {
                  jobs: jobItems,
                  artifacts: reports,
                  verdicts: verdicts.verdicts,
                }),
              ] as const,
          ),
      ),
    [groups, jobItems, reports, verdicts.verdicts],
  )

  if (episode.isError) return <ErrorNotice error={episode.error} />
  if (!detail || project.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  const aspect = project.data?.aspectRatio ?? '9:16'
  const ep = detail.episode
  const epTitle = t('common.episodeTitle', { n: ep.number, title: ep.title })
  const totalShots = shotIds.length
  const totalSec = groups.reduce((n, g) => n + g.durationSec, 0)
  const counts = countViews([...views.values()])
  const allShots = groups.flatMap((g) => g.shots.map((s) => ({ ...s, scene: g })))
  const thumbOf = (s: Shot) => currentImage(s)?.file.path
  const candidateOf = (id: string): BatchCandidate | undefined => {
    const x = allShots.find((s) => s.shot.id === id)
    return x
      ? {
          shotId: id,
          index: x.index,
          label: t('storyboard.batch.shotName', {
            n: String(x.index).padStart(2, '0'),
            scene: sceneName(x.scene.scene),
          }),
          thumb: thumbOf(x.shot),
          target: {
            kind: batch?.kind === 'shot_video' ? 'shot_video' : 'shot_image',
            shotId: id,
          } as const,
        }
      : undefined
  }
  const sceneName = (s: { title?: string; timeOfDay?: string }) =>
    [s.title, s.timeOfDay].filter(Boolean).join(' · ') || t('storyboard.scene.untitled')

  const imageTargets = allShots
    .filter((s) => !currentImage(s.shot) && views.get(s.shot.id)?.phase === 'empty')
    .map((s) => s.shot.id)
  const videoTargets = allShots
    .filter((s) => views.get(s.shot.id)?.phase === 'image_ready')
    .map((s) => s.shot.id)
  const active = jobItems.filter(
    (j) => j.episodeId === episodeId && (j.status === 'queued' || j.status === 'running'),
  )
  const breakdownJob = active.find((j) => j.operation === 'episode_breakdown')
  const promptsJob = active.find((j) => j.operation === 'shot_frames')
  const extractJob = active.find((j) => j.operation === 'entities_extract')

  const openBatch = (kind: Batch['kind'], ids: string[]) => setBatch({ kind, shotIds: ids })
  const queuedJobOf = (shotId: string) =>
    jobItems.find((j) => j.shotId === shotId && j.status === 'queued')

  const onBlockedAction = (shot: Shot, index: number, a: ReasonAction) => {
    if (a.kind === 'prompts') prompts.mutate({ params: { episodeId }, body: { onlyMissing: true } })
    else if (a.kind === 'generateImage') openBatch('shot_image', [shot.id])
    else if (a.kind === 'edit') setEditing({ shot, index })
    else if (a.kind === 'tasks') shell.openTasks()
  }

  const firstError =
    setVersion.error ??
    reorder.error ??
    remove.error ??
    breakdown.error ??
    prompts.error ??
    extract.error ??
    ops.error ??
    null
  const pendingCandidates = candidates.data?.progress.pending ?? 0

  return (
    <>
      <PageHead
        title={epTitle}
        sub={
          totalShots > 0
            ? t('storyboard.sub', {
                scenes: groups.length,
                shots: totalShots,
                duration: fmt.duration(totalSec * 1000),
              })
            : t('storyboard.subEmpty')
        }
        actions={
          totalShots > 0 && (
            <>
              <Button
                variant="secondary"
                disabled={imageTargets.length === 0}
                onClick={() => openBatch('shot_image', imageTargets)}
              >
                <ImageIcon {...iconProps} aria-hidden />
                {t('storyboard.batchImage')}
              </Button>
              <Button
                variant="primary"
                disabled={videoTargets.length === 0}
                onClick={() => openBatch('shot_video', videoTargets)}
              >
                <Film {...iconProps} aria-hidden />
                {t('storyboard.batchVideo')}
              </Button>
            </>
          )
        }
      />

      {firstError !== null && firstError !== undefined && (
        <ErrorNotice error={firstError} className="mb-4" />
      )}

      {totalShots === 0 ? (
        <div className="flex flex-col gap-4">
          {breakdownJob ? (
            <StreamedText
              job={breakdownJob}
              labels={{
                running: t('storyboard.breakdown.running'),
                queued: t('storyboard.breakdown.queued'),
                waiting: t('storyboard.breakdown.waiting'),
                queuedHint: t('storyboard.breakdown.queuedHint'),
                streamLabel: t('storyboard.breakdown.streamLabel'),
              }}
            />
          ) : (
            <EmptyState
              icon={<Split {...iconPropsLg} aria-hidden />}
              title={t('storyboard.empty.title')}
              description={t('storyboard.empty.body')}
              action={
                <Button
                  variant="primary"
                  loading={breakdown.isPending}
                  onClick={() => breakdown.mutate({ params: { episodeId }, body: {} })}
                >
                  {t('storyboard.empty.action')}
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div
            aria-label={t('storyboard.status.label')}
            className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground"
          >
            <Count n={counts.shots} label={t('storyboard.status.shots')} />
            <Count n={counts.videos} label={t('storyboard.status.videos')} />
            <Count n={counts.running} label={t('storyboard.status.running')} tone="accent" />
            <Count n={counts.stale} label={t('storyboard.status.stale')} tone="warn" />
            <Count n={counts.failed} label={t('storyboard.status.failed')} tone="danger" />
            <Count n={counts.blocked} label={t('storyboard.status.blocked')} tone="danger" />
          </div>

          {pendingCandidates > 0 && (
            <Notice
              tone="info"
              actions={
                <Link to={`/projects/${projectId}/candidates`}>
                  <Button size="sm" variant="secondary" tabIndex={-1}>
                    {t('storyboard.candidatesBanner.go')}
                  </Button>
                </Link>
              }
            >
              {t('storyboard.candidatesBanner.text', { count: pendingCandidates })}
            </Notice>
          )}

          <EpisodeTools
            breakdownBusy={breakdown.isPending || Boolean(breakdownJob)}
            promptsBusy={prompts.isPending || Boolean(promptsJob)}
            extractBusy={extract.isPending || Boolean(extractJob)}
            onBreakdown={(mode) => breakdown.mutate({ params: { episodeId }, body: { mode } })}
            onPrompts={() => prompts.mutate({ params: { episodeId }, body: { onlyMissing: true } })}
            onExtract={() => extract.mutate({ params: { episodeId }, body: {} })}
          />

          {breakdownJob && (
            <StreamedText
              job={breakdownJob}
              labels={{
                running: t('storyboard.breakdown.running'),
                queued: t('storyboard.breakdown.queued'),
                waiting: t('storyboard.breakdown.waiting'),
                queuedHint: t('storyboard.breakdown.queuedHint'),
                streamLabel: t('storyboard.breakdown.streamLabel'),
              }}
            />
          )}

          {groups.map((g) => (
            <section
              key={g.scene.id}
              aria-label={t('storyboard.scene.label', { n: g.index, name: sceneName(g.scene) })}
              className="flex flex-col gap-3"
            >
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <span className="font-mono text-sm text-muted-foreground">
                  {t('storyboard.scene.no', { n: g.index })}
                </span>
                <h2 className="font-display text-title-sm font-bold">{sceneName(g.scene)}</h2>
                {g.scene.locationAssetId && assets.get(g.scene.locationAssetId) && (
                  <Link
                    to={`/projects/${projectId}/assets/${g.scene.locationAssetId}`}
                    className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface-2 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <MapPin {...iconProps} size={12} aria-hidden />
                    {assets.get(g.scene.locationAssetId)!.name}
                  </Link>
                )}
                <span className="flex-1" />
                <span className="text-sm text-muted-foreground tabular-nums">
                  {t('storyboard.scene.meta', {
                    count: g.shots.length,
                    duration: fmt.duration(g.durationSec * 1000),
                  })}
                </span>
              </div>
              <ol className="flex flex-col gap-3">
                {g.shots.map(({ shot, index }, i) => {
                  const view = views.get(shot.id)!
                  return (
                    <ShotCard
                      key={shot.id}
                      projectId={projectId}
                      aspect={aspect}
                      shot={shot}
                      index={index}
                      view={view}
                      refs={refs.get(shot.id) ?? []}
                      assets={assets}
                      assetsLoading={assetsQ.isPending}
                      isFirst={i === 0}
                      isLast={i === g.shots.length - 1}
                      busy={setVersion.isPending || reorder.isPending}
                      staleKept={Boolean(
                        (view.videoStale ?? view.imageStale) &&
                        kept.isKept((view.videoStale ?? view.imageStale)!),
                      )}
                      onGenerate={(kind) =>
                        openBatch(kind === 'image' ? 'shot_image' : 'shot_video', [shot.id])
                      }
                      onCancelQueued={() => {
                        const j = queuedJobOf(shot.id)
                        if (j) ops.cancel(j)
                      }}
                      onEdit={() => setEditing({ shot, index })}
                      onDelete={() => setDeleting({ shot, index })}
                      onMove={(dir) => {
                        const order = g.shots.map((x) => x.shot.id)
                        const j = i + dir
                        ;[order[i], order[j]] = [order[j]!, order[i]!]
                        reorder.mutate({ params: { sceneId: g.scene.id }, body: { order } })
                      }}
                      onSetVersion={(slot, versionId) =>
                        setVersion.mutate({
                          params: { shotId: shot.id },
                          body: { slot, versionId },
                        })
                      }
                      onRegenerateStale={(r) =>
                        openBatch(r.kind === 'shot_image' ? 'shot_image' : 'shot_video', [shot.id])
                      }
                      onKeepStale={kept.keep}
                      onBlockedAction={(a) => onBlockedAction(shot, index, a)}
                      onOpenTasks={shell.openTasks}
                    />
                  )
                })}
              </ol>
            </section>
          ))}
        </div>
      )}

      {batch && (
        <BatchConfirmDialog
          projectId={projectId}
          episodeNumber={ep.number}
          aspect={aspect}
          kind={batch.kind}
          candidates={batch.shotIds
            .map(candidateOf)
            .filter((c): c is BatchCandidate => c !== undefined)}
          assets={assets}
          onClose={() => setBatch(undefined)}
        />
      )}
      {editing && (
        <ShotEditDialog
          assets={assets}
          shot={editing.shot}
          index={editing.index}
          projectId={projectId}
          onClose={() => setEditing(undefined)}
        />
      )}
      <Modal
        open={deleting !== undefined}
        onClose={() => setDeleting(undefined)}
        size="sm"
        title={t('storyboard.delete.title', { n: deleting?.index ?? 0 })}
        closeLabel={t('common.close')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger-solid"
              loading={remove.isPending}
              onClick={async () => {
                if (!deleting) return
                try {
                  await remove.mutateAsync({ params: { shotId: deleting.shot.id } })
                  setDeleting(undefined)
                } catch {
                  /* 显示在页面顶部 */
                  setDeleting(undefined)
                }
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t('storyboard.delete.body')}</p>
      </Modal>
    </>
  )
}

function Count({
  n,
  label,
  tone,
}: {
  n: number
  label: string
  tone?: 'accent' | 'warn' | 'danger'
}) {
  return (
    <span
      className={cn(
        tone === 'accent' && 'text-accent-text',
        tone === 'warn' && 'text-warn',
        tone === 'danger' && n > 0 && 'text-danger',
      )}
    >
      <b className="mr-1 font-mono font-medium text-foreground tabular-nums">{n}</b>
      {label}
    </span>
  )
}

/** 本集的整体操作：重新拆分（替换 / 追加）、补镜头提示词、抽取候选。默认收起。 */
function EpisodeTools({
  breakdownBusy,
  promptsBusy,
  extractBusy,
  onBreakdown,
  onPrompts,
  onExtract,
}: {
  breakdownBusy: boolean
  promptsBusy: boolean
  extractBusy: boolean
  onBreakdown: (mode: 'replace' | 'append') => void
  onPrompts: () => void
  onExtract: () => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
        <Sparkles {...iconProps} aria-hidden className="text-muted-foreground" />
        <strong className="font-medium">{t('storyboard.tools.title')}</strong>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {t('storyboard.tools.sum')}
        </span>
        <ChevronDown
          {...iconProps}
          aria-hidden
          className="text-subtle transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="flex flex-col gap-4 border-t border-border p-4">
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">{t('storyboard.tools.prompts')}</div>
          <p className="text-sm text-muted-foreground">{t('storyboard.tools.promptsHint')}</p>
          <div>
            <Button size="sm" variant="secondary" loading={promptsBusy} onClick={onPrompts}>
              {t('storyboard.tools.promptsAction')}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">{t('storyboard.tools.extract')}</div>
          <p className="text-sm text-muted-foreground">{t('storyboard.tools.extractHint')}</p>
          <div>
            <Button size="sm" variant="secondary" loading={extractBusy} onClick={onExtract}>
              {t('storyboard.tools.extractAction')}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">{t('storyboard.tools.redo')}</div>
          <div
            role="radiogroup"
            aria-label={t('storyboard.tools.redo')}
            className="flex flex-wrap gap-2"
          >
            {(['append', 'replace'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-md border border-border-strong bg-sunken px-3 py-2 text-left text-sm',
                  mode === m && 'border-accent bg-accent-soft',
                )}
              >
                <b className="block font-medium">{t(`storyboard.tools.mode.${m}.title`)}</b>
                <span className="text-xs text-muted-foreground">
                  {t(`storyboard.tools.mode.${m}.desc`)}
                </span>
              </button>
            ))}
          </div>
          <div>
            <Button
              size="sm"
              variant="secondary"
              loading={breakdownBusy}
              onClick={() => onBreakdown(mode)}
            >
              {t('storyboard.tools.redoAction')}
            </Button>
          </div>
        </div>
      </div>
    </details>
  )
}
