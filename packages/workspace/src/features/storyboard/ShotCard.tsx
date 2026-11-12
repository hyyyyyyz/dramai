import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Clock,
  Film,
  ImageIcon,
  Mic,
  Pencil,
  RefreshCw,
  Trash2,
  VolumeX,
} from 'lucide-react'
import type { ArtifactReport, Asset, Shot, ShotRef } from '@dramai/api'
import {
  Button,
  CropMarks,
  Frame,
  IconButton,
  Modal,
  Pill,
  iconProps,
  iconPropsSm,
  cn,
} from '@dramai/ui/v2'
import { useApi } from '@/data/use-api'
import { useFormat } from '@/i18n/format'
import { AssetRefs } from './AssetRefs'
import { BlockedNotice, FailedNotice, StaleNotice } from './ShotNotices'
import { VersionStrip } from './VersionStrip'
import { versionNumber } from './version-model'
import type { ReasonAction } from './reasons'
import { mentionsToNames } from './mentions'
import { currentImage, currentVideo, soundOf, type ShotView } from './shot-model'

const PHASE_PILL: Record<
  ShotView['phase'],
  { tone: 'neutral' | 'info' | 'success' | 'accent'; hollow?: boolean }
> = {
  empty: { tone: 'neutral', hollow: true },
  image_queued: { tone: 'neutral', hollow: true },
  image_running: { tone: 'accent' },
  image_ready: { tone: 'info' },
  video_queued: { tone: 'neutral', hollow: true },
  video_running: { tone: 'accent' },
  video_ready: { tone: 'success' },
}

export interface ShotCardProps {
  projectId: string
  aspect: '9:16' | '16:9' | '1:1'
  shot: Shot
  /** 本集内的镜头序号。 */
  index: number
  view: ShotView
  refs: readonly ShotRef[]
  assets: ReadonlyMap<string, Asset>
  isFirst: boolean
  isLast: boolean
  busy?: boolean
  onGenerate: (kind: 'image' | 'video') => void
  onCancelQueued: () => void
  onEdit: () => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  onSetVersion: (slot: 'image' | 'video', versionId: string) => void
  onRegenerateStale: (report: ArtifactReport) => void
  onKeepStale: (report: ArtifactReport) => void
  staleKept?: boolean
  assetsLoading?: boolean
  onBlockedAction: (a: ReasonAction) => void
  onOpenTasks: () => void
}

/** 一个镜头：状态、描述、声音归属、提示词、引用的资产、版本、状态提示条、操作。分镜页最核心的组件。 */
export function ShotCard(p: ShotCardProps) {
  const { t } = useTranslation()
  const api = useApi()
  const fmt = useFormat()
  const { shot, view } = p
  const [preview, setPreview] = useState(false)
  const img = currentImage(shot)
  const vid = currentVideo(shot)
  const no = String(p.index).padStart(2, '0')
  const sound = soundOf(shot)
  const dialogue = shot.dialogue.filter((d) => d.text.trim())
  const stale = view.videoStale ?? view.imageStale
  const promptText = mentionsToNames(shot.prompts.firstFrame ?? shot.prompts.video ?? '', p.assets)
  const pill = PHASE_PILL[view.phase]
  const failed = view.failedStage !== undefined
  const blocked = view.blocked && !failed ? view.blocked : undefined

  const frameStatus =
    view.phase === 'image_queued' || view.phase === 'video_queued'
      ? 'queued'
      : view.phase === 'image_running' || view.phase === 'video_running'
        ? 'running'
        : failed
          ? 'failed'
          : undefined
  const statusLabel =
    frameStatus === 'queued'
      ? t(
          view.phase === 'video_queued'
            ? 'storyboard.frame.videoQueued'
            : 'storyboard.frame.imageQueued',
        )
      : frameStatus === 'running'
        ? t(
            view.phase === 'video_running'
              ? 'storyboard.frame.videoRunning'
              : 'storyboard.frame.imageRunning',
          )
        : frameStatus === 'failed'
          ? t(
              view.failedStage === 'image'
                ? 'storyboard.frame.imageFailed'
                : 'storyboard.frame.videoFailed',
            )
          : undefined

  const durationLabel = vid?.facts?.durationSec
    ? fmt.duration(vid.facts.durationSec * 1000)
    : undefined
  const imgNo = versionNumber(shot.image, shot.image.currentVersionId)

  const meta = [
    shot.cameraShot ? t(`camera.shot.${shot.cameraShot}`) : undefined,
    shot.angle ? t(`camera.angle.${shot.angle}`) : undefined,
    t(`camera.movement.${shot.movement}`),
    t('storyboard.card.seconds', { n: shot.durationSec }),
  ].filter(Boolean)

  const frame = (
    <Frame
      ratio={p.aspect}
      src={img ? api.fileUrl(p.projectId, img.file.path) : undefined}
      alt={t('storyboard.frame.alt', { n: p.index })}
      version={imgNo ? t('storyboard.frame.version', { n: imgNo }) : undefined}
      duration={vid && !frameStatus ? (durationLabel ?? '') : undefined}
      status={frameStatus}
      statusLabel={statusLabel}
      placeholder={
        frameStatus ? (
          <Clock {...iconProps} aria-hidden />
        ) : (
          <ImageIcon {...iconProps} aria-hidden />
        )
      }
      className="w-full"
    />
  )

  return (
    <li
      data-state={view.phase}
      data-testid={`shot-${p.index}`}
      aria-current={view.phase === 'video_running' ? 'true' : undefined}
      className={cn(
        'grid grid-cols-[40px_120px_minmax(0,1fr)] gap-4 rounded-lg border border-border bg-surface p-4',
        'max-[640px]:grid-cols-[32px_minmax(0,1fr)] max-[640px]:gap-3',
      )}
    >
      <div className="flex flex-col items-start gap-1 pt-1">
        <span className="font-mono text-muted-foreground">{no}</span>
      </div>

      <div className="max-[640px]:col-start-2 max-[640px]:max-w-40">
        {vid && !frameStatus ? (
          <button
            type="button"
            className="block w-full text-left"
            aria-label={t('storyboard.card.playVideo', { n: p.index })}
            onClick={() => setPreview(true)}
          >
            {frame}
          </button>
        ) : view.phase === 'video_running' ? (
          <CropMarks className="m-1.5">{frame}</CropMarks>
        ) : (
          frame
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2 max-[640px]:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          {failed ? (
            <Pill tone="danger">
              {t(
                view.failedStage === 'image'
                  ? 'storyboard.state.imageFailed'
                  : 'storyboard.state.videoFailed',
              )}
            </Pill>
          ) : blocked ? (
            <Pill tone="danger">{t('storyboard.state.blocked')}</Pill>
          ) : (
            <Pill tone={pill.tone} hollow={pill.hollow}>
              {t(`storyboard.state.${view.phase}`)}
            </Pill>
          )}
          {stale && <Pill tone="warn">{t('storyboard.state.stale')}</Pill>}
          <span className="text-xs text-muted-foreground tabular-nums">{meta.join(' · ')}</span>
        </div>

        <p className="leading-relaxed">{shot.scriptExcerpt || shot.title}</p>
        {dialogue.length > 0 && (
          <p className="flex gap-2 text-sm">
            <span className="shrink-0 text-subtle">{t('storyboard.card.dialogue')}</span>
            <span className="min-w-0">
              {dialogue.map((d, i) => (
                <span key={i} className="block">
                  {d.speakerName ? `${d.speakerName}${t('storyboard.card.speakerSep')}` : ''}
                  {d.text}
                </span>
              ))}
            </span>
          </p>
        )}
        {shot.narration?.trim() && (
          <p className="flex gap-2 text-sm">
            <span className="shrink-0 text-subtle">{t('storyboard.card.narration')}</span>
            <span className="min-w-0">{shot.narration}</span>
          </p>
        )}
        <div>
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            title={t('storyboard.sound.hint')}
          >
            {sound === 'narration' ? (
              <Mic {...iconPropsSm} aria-hidden />
            ) : sound === 'dialogue' ? (
              <AudioLines {...iconPropsSm} aria-hidden />
            ) : (
              <VolumeX {...iconPropsSm} aria-hidden />
            )}
            {t(`storyboard.sound.${sound}`)}
          </span>
        </div>
        {(shot.prompts.firstFrame || shot.prompts.video) && (
          <p className="flex min-w-0 gap-2 text-xs">
            <span className="shrink-0 text-subtle">{t('storyboard.card.prompt')}</span>
            <span className="truncate font-mono text-muted-foreground" title={promptText}>
              {promptText}
            </span>
          </p>
        )}
        <AssetRefs
          projectId={p.projectId}
          refs={p.refs}
          assets={p.assets}
          loading={p.assetsLoading}
        />
        <VersionStrip
          projectId={p.projectId}
          imageSlot={shot.image}
          videoSlot={shot.video}
          onSetCurrent={p.onSetVersion}
          busy={p.busy}
        />

        {stale && !failed && !p.staleKept && (
          <StaleNotice
            report={stale}
            assets={p.assets}
            onRegenerate={() => p.onRegenerateStale(stale)}
            onKeep={() => p.onKeepStale(stale)}
          />
        )}
        {failed && view.failedJob && <FailedNotice job={view.failedJob} />}
        {blocked && (
          <BlockedNotice
            projectId={p.projectId}
            verdict={blocked}
            assets={p.assets}
            onAction={p.onBlockedAction}
          />
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          {view.phase === 'image_queued' || view.phase === 'video_queued' ? (
            <Button size="sm" variant="ghost" disabled={p.busy} onClick={p.onCancelQueued}>
              {t('storyboard.actions.cancelQueued')}
            </Button>
          ) : view.phase === 'image_running' || view.phase === 'video_running' ? (
            <Button size="sm" variant="ghost" onClick={p.onOpenTasks}>
              {t('storyboard.actions.viewTask')}
            </Button>
          ) : view.phase === 'empty' ? (
            <Button
              size="sm"
              variant={blocked ? 'secondary' : 'primary'}
              disabled={Boolean(blocked)}
              onClick={() => p.onGenerate('image')}
            >
              <ImageIcon {...iconPropsSm} aria-hidden />
              {t('storyboard.actions.generateImage')}
            </Button>
          ) : view.phase === 'image_ready' ? (
            <Button
              size="sm"
              variant={blocked ? 'secondary' : 'primary'}
              disabled={Boolean(blocked)}
              onClick={() => p.onGenerate('video')}
            >
              <Film {...iconPropsSm} aria-hidden />
              {t('storyboard.actions.generateVideo')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={p.onEdit}>
            <Pencil {...iconPropsSm} aria-hidden />
            {t('storyboard.actions.edit')}
          </Button>
          {view.hasImage &&
            view.phase !== 'image_running' &&
            view.phase !== 'video_running' &&
            view.phase !== 'image_queued' &&
            view.phase !== 'video_queued' && (
              <Button size="sm" variant="ghost" onClick={() => p.onGenerate('image')}>
                <RefreshCw {...iconPropsSm} aria-hidden />
                {t('storyboard.actions.regenerateImage')}
              </Button>
            )}
          {view.hasVideo && view.phase === 'video_ready' && (
            <Button size="sm" variant="ghost" onClick={() => p.onGenerate('video')}>
              <RefreshCw {...iconPropsSm} aria-hidden />
              {t('storyboard.actions.regenerateVideo')}
            </Button>
          )}
          <span className="flex-1" />
          <IconButton
            size="sm"
            label={t('storyboard.actions.moveUp', { n: p.index })}
            disabled={p.isFirst || p.busy}
            onClick={() => p.onMove(-1)}
          >
            <ArrowUp {...iconPropsSm} aria-hidden />
          </IconButton>
          <IconButton
            size="sm"
            label={t('storyboard.actions.moveDown', { n: p.index })}
            disabled={p.isLast || p.busy}
            onClick={() => p.onMove(1)}
          >
            <ArrowDown {...iconPropsSm} aria-hidden />
          </IconButton>
          <IconButton
            size="sm"
            label={t('storyboard.actions.delete', { n: p.index })}
            onClick={p.onDelete}
          >
            <Trash2 {...iconPropsSm} aria-hidden />
          </IconButton>
        </div>
      </div>

      {vid && (
        <Modal
          open={preview}
          onClose={() => setPreview(false)}
          size="md"
          title={t('storyboard.card.previewTitle', { n: p.index })}
          closeLabel={t('common.close')}
        >
          <video
            src={api.fileUrl(p.projectId, vid.file.path)}
            controls
            autoPlay
            playsInline
            className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-sm bg-sunken"
          />
        </Modal>
      )}
    </li>
  )
}
