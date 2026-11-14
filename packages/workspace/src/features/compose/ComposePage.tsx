import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Clapperboard, Download, Film, Mic, RefreshCw } from 'lucide-react'
import type { Asset, Shot } from '@dramai/api'
import {
  Button,
  EmptyState,
  Notice,
  Pill,
  Progress,
  SegmentedControl,
  Skeleton,
  iconProps,
  iconPropsLg,
} from '@dramai/ui/v2'
import { useCurrentEpisodeSync } from '@/data/current-episode'
import { qk } from '@/data/keys'
import { useApi } from '@/data/use-api'
import {
  useAssets,
  useCall,
  useEpisode,
  useEpisodeArtifacts,
  useJobs,
  useProject,
  useTimeline,
} from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { Block, PageHead } from '@/features/common/PageHead'
import { useJobOps } from '@/features/jobs/job-ops-context'
import { BatchConfirmDialog } from '@/features/storyboard/BatchConfirmDialog'
import type { BatchCandidate } from '@/features/storyboard/batch-model'
import { currentImage, groupScenes } from '@/features/storyboard/shot-model'
import { useShell } from '@/layout/shell-context'
import { useFormat } from '@/i18n/format'
import { BgmBlock } from './BgmBlock'
import { ClipInspector } from './ClipInspector'
import { IssueList } from './IssueList'
import type { IssueAction } from './issue-actions'
import { PreviewPlayer } from './PreviewPlayer'
import { RenderDialog } from './RenderDialog'
import { RevisionList } from './RevisionList'
import { TimelineView } from './TimelineView'
import {
  clipName,
  countIssues,
  isKnownIssue,
  moveClip,
  setBgm,
  setBgmVolume,
  updateClip,
  type Clip,
  type TimelineIssue,
} from './timeline-model'

type SummaryKey = 'trim' | 'volume' | 'hold' | 'carries'

export function ComposePage() {
  const { projectId = '', episodeId = '' } = useParams()
  const { t } = useTranslation()
  const fmt = useFormat()
  const api = useApi()
  const shell = useShell()
  const ops = useJobOps()
  useCurrentEpisodeSync(projectId, episodeId)

  const project = useProject(projectId)
  const episode = useEpisode(episodeId)
  const timeline = useTimeline(episodeId)
  const artifacts = useEpisodeArtifacts(episodeId)
  const assetsQ = useAssets(projectId)
  const jobs = useJobs()

  const [selectedId, setSelectedId] = useState<string>()
  const [rendering, setRendering] = useState(false)
  const [voiceShots, setVoiceShots] = useState<string[]>()
  const [previewMode, setPreviewMode] = useState<'timeline' | 'cut'>('timeline')
  const bgmRef = useRef<HTMLDivElement>(null)

  const invalidate = [qk.timeline, qk.artifacts, qk.episodes(projectId)]
  const update = useCall('timeline.update', { invalidate })
  const rollback = useCall('timeline.rollback', { invalidate })
  const sync = useCall('timeline.sync', { invalidate })
  const uploadBgm = useCall('timeline.uploadBgm', { invalidate })

  const detail = episode.data
  const view = timeline.data
  const groups = useMemo(() => (detail ? groupScenes(detail) : []), [detail])
  const shots = useMemo(
    () =>
      new Map<string, { shot: Shot; index: number }>(
        groups.flatMap((g) => g.shots).map((s) => [s.shot.id, s]),
      ),
    [groups],
  )
  const assets = useMemo(
    () => new Map<string, Asset>((assetsQ.data?.items ?? []).map((a) => [a.id, a])),
    [assetsQ.data],
  )

  if (episode.isError) return <ErrorNotice error={episode.error} />
  if (timeline.isError) return <ErrorNotice error={timeline.error} />
  if (!detail || !view || project.isPending) {
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
  const content = view.revision.content
  const placement = view.placement
  const issues = view.issues
  const counts = countIssues(issues)
  const cut = artifacts.data?.items.find((r) => r.kind === 'cut')
  const hasCut = cut?.file !== undefined && cut.status !== 'missing'
  const busy = update.isPending || rollback.isPending || sync.isPending || uploadBgm.isPending
  const selected = content.clips.find((c) => c.id === selectedId)
  const placedSelected = placement.clips.find((c) => c.clipId === selectedId)

  const thumbs = new Map<string, string>()
  for (const { shot } of shots.values()) {
    const img = currentImage(shot)
    if (img) thumbs.set(shot.id, api.fileUrl(projectId, img.file.path))
  }
  const videoPath = (shotId: string, versionId: string | undefined) =>
    shots.get(shotId)?.shot.video.versions.find((v) => v.id === versionId)?.file.path
  const narrationPath = (shotId: string, versionId: string) =>
    shots.get(shotId)?.shot.narrationAudio.versions.find((v) => v.id === versionId)?.file.path

  const save = (next: typeof content, summary: string) =>
    update.mutate({
      params: { episodeId },
      body: { content: next, summary, baseRevision: view.head },
    })

  const onClipChange = (clip: Clip, patch: Partial<Clip>, s: { key: SummaryKey; value?: string }) =>
    save(
      updateClip(content, clip.id, patch),
      t(`compose.summary.${s.key}`, { clip: clipName(content, clip.id), value: s.value ?? '' }),
    )

  const missingVoiceShots = [
    ...new Set(
      issues.filter((i) => i.code === 'NARRATION_AUDIO_MISSING' && i.shotId).map((i) => i.shotId!),
    ),
  ]
  const voiceCandidates: BatchCandidate[] = (voiceShots ?? []).flatMap((id) => {
    const x = shots.get(id)
    return x
      ? [
          {
            shotId: id,
            index: x.index,
            label: t('storyboard.batch.shotName', {
              n: String(x.index).padStart(2, '0'),
              scene:
                groups.find((g) => g.scene.id === x.shot.sceneId)?.scene.title ??
                t('storyboard.scene.untitled'),
            }),
            thumb: currentImage(x.shot)?.file.path,
            target: { kind: 'shot_audio', shotId: id } as const,
          },
        ]
      : []
  })

  const onIssueAction = (a: IssueAction) => {
    if (a.kind === 'select') setSelectedId(a.clipId)
    else if (a.kind === 'voice') setVoiceShots(missingVoiceShots)
    else if (a.kind === 'bgm') {
      bgmRef.current?.scrollIntoView({ block: 'center' })
      bgmRef.current?.querySelector('button')?.focus()
    } else if (a.kind === 'render') setRendering(true)
  }

  const describe = (i: TimelineIssue) => {
    const clip = i.clipId ? clipName(content, i.clipId) : ''
    const n =
      i.shotId && shots.get(i.shotId) ? String(shots.get(i.shotId)!.index).padStart(2, '0') : ''
    if (!isKnownIssue(i.code)) return { title: t('timelineIssues.unknown.title', { code: i.code }) }
    return {
      title: t(`timelineIssues.${i.code}.title`, { clip, n }),
      body: t(`timelineIssues.${i.code}.body`, { clip, n }),
    }
  }

  const activeCompose = (jobs.data?.items ?? []).find(
    (j) =>
      j.episodeId === episodeId &&
      j.operation === 'compose' &&
      (j.status === 'queued' || j.status === 'running'),
  )
  const failedCompose = (jobs.data?.items ?? []).find(
    (j) =>
      j.episodeId === episodeId &&
      j.operation === 'compose' &&
      j.status === 'failed' &&
      j.needsAttention,
  )
  const empty = content.clips.length === 0
  const canRender = !empty && !view.hasBlockingIssues && !activeCompose
  const err = update.error ?? rollback.error ?? sync.error ?? ops.error ?? null
  const epTitle = t('common.episodeTitle', { n: ep.number, title: ep.title })
  const base = `/projects/${projectId}/episodes/${episodeId}`

  return (
    <div className="@container">
      <PageHead
        title={epTitle}
        sub={
          empty
            ? t('compose.subEmpty')
            : t('compose.sub', {
                revision: view.head,
                duration: fmt.duration(placement.totalUs / 1000),
                count: content.clips.length,
              })
        }
        actions={
          <>
            <Button
              variant="secondary"
              loading={sync.isPending}
              disabled={busy}
              onClick={() => sync.mutate({ params: { episodeId } })}
            >
              <RefreshCw {...iconProps} aria-hidden />
              {t('compose.sync')}
            </Button>
            <Link to={`${base}/export`}>
              <Button variant="secondary" tabIndex={-1}>
                <Download {...iconProps} aria-hidden />
                {t('compose.goExport')}
              </Button>
            </Link>
            <Button variant="primary" disabled={!canRender} onClick={() => setRendering(true)}>
              <Film {...iconProps} aria-hidden />
              {t('compose.render.button')}
            </Button>
          </>
        }
      />

      {err !== null && err !== undefined && <ErrorNotice error={err} className="mb-4" />}

      {view.hasBlockingIssues && !empty && (
        <Notice tone="danger" className="mb-4">
          {t('compose.blocked', { count: counts.blocking })}
        </Notice>
      )}

      {empty ? (
        <EmptyState
          icon={<Clapperboard {...iconPropsLg} aria-hidden />}
          title={t('compose.empty.title')}
          description={t('compose.empty.body')}
          action={
            <Link to={`${base}/storyboard`}>
              <Button variant="primary" tabIndex={-1}>
                {t('compose.empty.action')}
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_320px] @4xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <TimelineView
              content={content}
              placement={placement}
              issues={issues}
              thumbs={thumbs}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <p className="text-xs text-subtle">{t('compose.honest')}</p>
            {selected ? (
              <ClipInspector
                key={`${selected.id}|${placedSelected?.srcInUs}|${placedSelected?.srcOutUs}|${selected.sourceVolume}|${selected.holdUs}`}
                content={content}
                clip={selected}
                placed={placedSelected}
                shotIndex={placedSelected ? shots.get(placedSelected.shotId)?.index : undefined}
                disabled={busy}
                onChange={(patch, s) => onClipChange(selected, patch, s)}
                onMove={(dir) =>
                  save(
                    moveClip(content, selected.id, dir),
                    t('compose.summary.move', { clip: clipName(content, selected.id) }),
                  )
                }
              />
            ) : (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                {t('compose.inspector.pick')}
              </p>
            )}
            <Block
              title={t('compose.issues.title')}
              aside={
                issues.length === 0
                  ? undefined
                  : t('compose.issues.counts', {
                      blocking: counts.blocking,
                      warning: counts.warning,
                      info: counts.info,
                    })
              }
              aria-label={t('compose.issues.title')}
            >
              {missingVoiceShots.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm">
                  <span>{t('compose.voice.missing', { count: missingVoiceShots.length })}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setVoiceShots(missingVoiceShots)}
                  >
                    <Mic {...iconProps} aria-hidden />
                    {t('compose.voice.generate')}
                  </Button>
                </div>
              )}
              <IssueList
                issues={issues}
                describe={describe}
                onAction={onIssueAction}
                storyboardHref={`${base}/storyboard`}
                disabledActions={busy}
              />
            </Block>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <Block title={t('compose.preview.title')} aria-label={t('compose.preview.title')}>
              <div className="flex flex-col gap-3 p-4">
                {hasCut && (
                  <SegmentedControl
                    aria-label={t('compose.preview.title')}
                    value={previewMode}
                    onValueChange={setPreviewMode}
                    options={[
                      { value: 'timeline', label: t('compose.preview.modeTimeline') },
                      { value: 'cut', label: t('compose.preview.modeCut') },
                    ]}
                  />
                )}
                {previewMode === 'cut' && hasCut ? (
                  <div className="mx-auto w-full max-w-60">
                    <video
                      key={cut?.file?.path}
                      controls
                      playsInline
                      src={api.exportUrl('cut', episodeId)}
                      aria-label={t('compose.preview.cutLabel')}
                      className="w-full rounded-md bg-black"
                    />
                    {cut?.status === 'stale' && (
                      <p className="mt-2 text-xs text-warn">{t('compose.preview.cutStale')}</p>
                    )}
                  </div>
                ) : (
                  <>
                    <PreviewPlayer
                      projectId={projectId}
                      placement={placement}
                      videoPath={videoPath}
                      narrationPath={narrationPath}
                      poster={[...thumbs.values()][0]}
                      aspect={aspect}
                    />
                    <p className="text-xs text-subtle">{t('compose.preview.hint')}</p>
                  </>
                )}
              </div>
            </Block>

            <Block
              title={t('compose.render.title')}
              aside={
                hasCut ? (
                  <Pill tone={cut?.status === 'current' ? 'success' : 'warn'}>
                    {t(`compose.render.cut.${cut?.status ?? 'missing'}`)}
                  </Pill>
                ) : undefined
              }
              aria-label={t('compose.render.title')}
            >
              <div className="flex flex-col gap-3 p-4 text-sm">
                {activeCompose ? (
                  <>
                    <p>
                      {activeCompose.status === 'queued'
                        ? t('compose.render.queued')
                        : t('compose.render.running')}
                    </p>
                    <Progress
                      aria-label={t('compose.render.title')}
                      indeterminate={activeCompose.progress === undefined}
                      value={(activeCompose.progress ?? 0) * 100}
                    />
                    <Button size="sm" variant="ghost" onClick={shell.openTasks}>
                      {t('compose.render.openTasks')}
                    </Button>
                  </>
                ) : (
                  <>
                    {failedCompose && (
                      <Notice
                        tone="danger"
                        actions={
                          <Button size="sm" variant="secondary" onClick={shell.openTasks}>
                            {t('compose.render.openTasks')}
                          </Button>
                        }
                      >
                        {t('compose.render.failed')}
                      </Notice>
                    )}
                    <p className="text-muted-foreground">
                      {hasCut
                        ? cut?.status === 'stale'
                          ? t('compose.render.staleBody')
                          : t('compose.render.currentBody')
                        : t('compose.render.noneBody')}
                    </p>
                    <Button
                      variant="primary"
                      disabled={!canRender}
                      onClick={() => setRendering(true)}
                    >
                      {hasCut ? t('compose.render.again') : t('compose.render.button')}
                    </Button>
                    {!canRender && !activeCompose && (
                      <p className="text-xs text-danger">{t('compose.render.blockedReason')}</p>
                    )}
                  </>
                )}
              </div>
            </Block>

            <div ref={bgmRef}>
              <BgmBlock
                bgm={content.bgm}
                disabled={busy}
                uploading={uploadBgm.isPending}
                error={uploadBgm.error}
                onUpload={(file, durationUs) => {
                  const form = new FormData()
                  form.append('file', file)
                  uploadBgm.mutate(
                    { params: { episodeId }, form },
                    {
                      onSuccess: (r) =>
                        save(
                          setBgm(content, { bgmId: r.bgmId, durationUs }),
                          t('compose.summary.bgmSet'),
                        ),
                    },
                  )
                }}
                onVolume={(v) =>
                  save(
                    setBgmVolume(content, v),
                    t('compose.summary.bgmVolume', { value: Math.round(v * 100) }),
                  )
                }
                onRemove={() => save(setBgm(content, null), t('compose.summary.bgmRemove'))}
              />
            </div>

            <RevisionList
              view={view}
              busy={busy}
              onRollback={(n) => rollback.mutate({ params: { episodeId }, body: { revision: n } })}
            />
          </div>
        </div>
      )}

      {rendering && <RenderDialog episodeId={episodeId} onClose={() => setRendering(false)} />}
      {voiceShots && voiceCandidates.length > 0 && (
        <BatchConfirmDialog
          projectId={projectId}
          episodeNumber={ep.number}
          aspect={aspect}
          kind="shot_audio"
          candidates={voiceCandidates}
          assets={assets}
          onClose={() => setVoiceShots(undefined)}
        />
      )}
    </div>
  )
}
