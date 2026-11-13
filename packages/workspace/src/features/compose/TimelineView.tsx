import { useTranslation } from 'react-i18next'
import { Captions, Clapperboard, Music, Mic, VolumeX } from 'lucide-react'
import type { TimelineContent } from '@dramai/api'
import { iconPropsSm, cn } from '@dramai/ui/v2'
import {
  clipName,
  clock,
  missingNarrationClips,
  rulerStep,
  trackBox,
  usToSec,
  type Placement,
  type TimelineIssue,
} from './timeline-model'

/** 每秒占多少像素。时间轴在自己的容器里横向滚动，不撑开页面。 */
export const PX_PER_SEC = 24

function Track({
  icon,
  label,
  width,
  children,
}: {
  icon: React.ReactNode
  label: string
  width: number
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-stretch">
      <div className="sticky left-0 z-10 flex items-center gap-2 border-r border-border bg-surface px-3 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="relative" style={{ width }}>
        {children}
      </div>
    </div>
  )
}

/**
 * 四轨时间线：画面（一格 = 一个镜头的当前视频版本）、旁白、字幕、配乐。
 * 红色是缺东西，黄色轮廓是需要注意；颜色之外每一格都有文字。后端目前只做硬切，所以画面轨上没有转场标记。
 */
export function TimelineView({
  content,
  placement,
  issues,
  thumbs,
  selectedId,
  onSelect,
}: {
  content: TimelineContent
  placement: Placement
  issues: readonly TimelineIssue[]
  /** 镜头 id → 缩略图地址。 */
  thumbs: ReadonlyMap<string, string>
  selectedId?: string
  onSelect: (clipId: string) => void
}) {
  const { t } = useTranslation()
  const totalSec = usToSec(placement.totalUs)
  const width = Math.max(240, totalSec * PX_PER_SEC)
  const step = rulerStep(totalSec)
  const ticks = Array.from({ length: Math.floor(totalSec / step) + 1 }, (_, i) => i * step)
  // A clip with a video whose own audio is at 0 shows it, so a silent clip isn't mistaken for a fault. New clips start
  // at 0 when the video model cannot turn its own audio off; the user can raise it in the inspector.
  const muted = (p: Placement['clips'][number]) => !p.missingVideo && p.sourceVolume === 0
  const staleClips = new Set(
    issues.filter((i) => i.code === 'CLIP_VIDEO_STALE' && i.clipId).map((i) => i.clipId!),
  )
  const overClips = new Set(
    issues
      .filter(
        (i) =>
          (i.code === 'NARRATION_OVERLAPS_NEXT' ||
            i.code === 'NARRATION_OVER_DIALOGUE' ||
            i.code === 'NARRATION_PAST_END') &&
          i.clipId,
      )
      .map((i) => i.clipId!),
  )
  const missingNarr = missingNarrationClips(issues)

  return (
    <div
      role="group"
      aria-label={t('compose.timeline.label')}
      className="overflow-x-auto rounded-lg border border-border bg-surface"
    >
      <div style={{ width: width + 88 }} className="flex flex-col">
        <div className="grid grid-cols-[88px_minmax(0,1fr)] border-b border-border">
          <span className="sticky left-0 z-10 bg-surface" />
          <div className="relative h-7" style={{ width }} aria-hidden>
            {ticks.map((s) => (
              <span
                key={s}
                className="absolute top-1.5 border-l border-border pl-1 font-mono text-xs text-subtle tabular-nums"
                style={{ left: s * PX_PER_SEC }}
              >
                {clock(s)}
              </span>
            ))}
          </div>
        </div>

        <Track
          width={width}
          icon={<Clapperboard {...iconPropsSm} aria-hidden />}
          label={t('compose.timeline.video')}
        >
          <div className="relative h-16 border-b border-border">
            {placement.clips.map((p) => {
              const box = trackBox(p.startUs, p.endUs, PX_PER_SEC)
              const sel = p.clipId === selectedId
              const thumb = thumbs.get(p.shotId)
              return (
                <button
                  key={p.clipId}
                  type="button"
                  aria-pressed={sel}
                  aria-label={
                    t('compose.timeline.clipLabel', {
                      clip: clipName(content, p.clipId),
                      sec: usToSec(p.endUs - p.startUs).toFixed(1),
                    }) + (muted(p) ? `，${t('compose.timeline.muted')}` : '')
                  }
                  onClick={() => onSelect(p.clipId)}
                  className={cn(
                    'absolute top-1 bottom-1 overflow-hidden rounded-sm border bg-sunken bg-cover bg-center text-left text-xs text-white',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                    p.missingVideo
                      ? 'border-danger border-dashed'
                      : staleClips.has(p.clipId)
                        ? 'border-warn'
                        : 'border-border-strong',
                    sel && 'outline-2 outline-accent',
                  )}
                  style={{
                    left: box.left,
                    width: box.width - 2,
                    backgroundImage: thumb ? `url(${thumb})` : undefined,
                  }}
                >
                  <span className="absolute bottom-0 left-0 rounded-tr-xs bg-black/60 px-1 font-mono leading-4">
                    {clipName(content, p.clipId)}
                    {p.missingVideo && ` · ${t('compose.timeline.noVideo')}`}
                    {staleClips.has(p.clipId) && ` · ${t('storyboard.state.stale')}`}
                    {muted(p) && (
                      <>
                        {' · '}
                        <VolumeX {...iconPropsSm} className="inline" aria-hidden />{' '}
                        {t('compose.timeline.muted')}
                      </>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </Track>

        <Track
          width={width}
          icon={<Mic {...iconPropsSm} aria-hidden />}
          label={t('compose.timeline.narration')}
        >
          <div className="relative h-9 border-b border-border">
            {placement.narrations.map((n) => {
              const box = trackBox(n.startUs, n.endUs, PX_PER_SEC)
              return (
                <div
                  key={n.clipId}
                  className={cn(
                    'absolute top-1 bottom-1 truncate rounded-sm bg-surface-2 px-2 text-xs leading-7 text-muted-foreground',
                    overClips.has(n.clipId) && 'outline-1 outline-warn',
                  )}
                  style={{ left: box.left, width: box.width - 2 }}
                  title={
                    overClips.has(n.clipId) ? t('compose.timeline.narrationAttention') : undefined
                  }
                >
                  {t('compose.timeline.narrationOf', { clip: clipName(content, n.clipId) })}
                  {n.truncated && ` · ${t('compose.timeline.cut')}`}
                </div>
              )
            })}
            {missingNarr.map((id) => {
              const p = placement.clips.find((c) => c.clipId === id)
              if (!p) return null
              const box = trackBox(p.startUs, p.endUs, PX_PER_SEC)
              return (
                <div
                  key={`m-${id}`}
                  className="absolute top-1 bottom-1 truncate rounded-sm border border-dashed border-danger bg-danger-soft px-2 text-xs leading-7 text-danger"
                  style={{ left: box.left, width: box.width - 2 }}
                >
                  {t('compose.timeline.noVoice', { clip: clipName(content, id) })}
                </div>
              )
            })}
          </div>
        </Track>

        <Track
          width={width}
          icon={<Captions {...iconPropsSm} aria-hidden />}
          label={t('compose.timeline.subtitles')}
        >
          <div className="relative h-9 border-b border-border">
            {placement.subtitles.map((s, i) => {
              const box = trackBox(s.startUs, s.endUs, PX_PER_SEC)
              return (
                <div
                  key={i}
                  className="absolute top-1 bottom-1 truncate rounded-sm bg-info-soft px-2 text-xs leading-7 text-foreground"
                  style={{ left: box.left, width: box.width - 2 }}
                  title={s.text}
                >
                  {s.text}
                </div>
              )
            })}
          </div>
        </Track>

        <Track
          width={width}
          icon={<Music {...iconPropsSm} aria-hidden />}
          label={t('compose.timeline.bgm')}
        >
          <div className="relative h-9">
            {placement.bgm.map((b) => {
              const box = trackBox(b.startUs, b.endUs, PX_PER_SEC)
              return (
                <div
                  key={b.clipId}
                  className="absolute top-1 bottom-1 truncate rounded-sm bg-success-soft px-2 text-xs leading-7 text-foreground"
                  style={{ left: box.left, width: box.width - 2 }}
                >
                  {t('compose.timeline.bgmLabel', { volume: Math.round(b.volume * 100) })}
                  {b.truncated && ` · ${t('compose.timeline.cut')}`}
                </div>
              )
            })}
          </div>
        </Track>
      </div>
    </div>
  )
}
