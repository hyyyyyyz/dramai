import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Play } from 'lucide-react'
import { Frame, IconButton, iconProps } from '@dramai/ui/v2'
import { useApi } from '@/data/use-api'
import {
  clipFinished,
  narrationsPlayingAt,
  narrationsToStart,
  previewClips,
  resolveAt,
  timelineAt,
} from './preview-model'
import { US, clock, usToSec, type Placement } from './timeline-model'

/**
 * 浏览器里的时间线预览：不经过渲染，按时间线顺序播放各片段的当前视频，旁白在它的起点响起。
 * 不含字幕、配乐、定格和转场（后端目前只做硬切）；想看最终效果，先渲染成片。
 */
export function PreviewPlayer({
  projectId,
  placement,
  videoPath,
  narrationPath,
  poster,
  aspect,
}: {
  projectId: string
  placement: Placement
  /** 片段 → 它用的视频文件路径（没有就是缺视频）。 */
  videoPath: (shotId: string, versionId: string | undefined) => string | undefined
  /** 旁白版本 → 音频文件路径。 */
  narrationPath: (shotId: string, versionId: string) => string | undefined
  poster?: string
  aspect: '9:16' | '16:9' | '1:1'
}) {
  const { t } = useTranslation()
  const api = useApi()
  const clips = useMemo(() => previewClips(placement), [placement])
  const video = useRef<HTMLVideoElement>(null)
  const audios = useRef(new Map<string, HTMLAudioElement>())
  const state = useRef({ index: 0, playing: false, lastT: 0 })
  const [playing, setPlaying] = useState(false)
  const [tUs, setTUs] = useState(0)
  const total = placement.totalUs

  const srcOf = useCallback(
    (i: number) => {
      const c = clips[i]
      const p = placement.clips[i]
      if (!c || !p || c.missingVideo) return undefined
      const path = videoPath(p.shotId, c.videoVersionId)
      return path ? api.fileUrl(projectId, path) : undefined
    },
    [clips, placement, videoPath, api, projectId],
  )

  const stopAudio = useCallback(() => {
    for (const a of audios.current.values()) a.pause()
  }, [])

  const startNarration = useCallback(
    (n: Placement['narrations'][number], offsetUs = 0) => {
      const path = narrationPath(n.shotId, n.versionId)
      if (!path) return
      let a = audios.current.get(n.clipId)
      if (!a) {
        a = new Audio(api.fileUrl(projectId, path))
        audios.current.set(n.clipId, a)
      }
      a.currentTime = offsetUs / US
      void a.play().catch(() => {})
    },
    [narrationPath, api, projectId],
  )

  /** 跳到时间线上的某一刻：换片段、对齐源视频、重新对齐旁白。 */
  const seek = useCallback(
    (target: number, keepPlaying: boolean) => {
      const r = resolveAt(clips, target)
      const v = video.current
      if (!r || !v) return
      stopAudio()
      state.current.index = r.index
      state.current.lastT = target
      const src = srcOf(r.index)
      const go = () => {
        v.currentTime = r.sourceUs / US
        v.volume = Math.min(1, Math.max(0, clips[r.index]!.volume))
        if (keepPlaying) void v.play().catch(() => {})
      }
      if (src && v.getAttribute('data-src') !== src) {
        v.setAttribute('data-src', src)
        v.src = src
        v.addEventListener('loadedmetadata', go, { once: true })
      } else go()
      setTUs(target)
      if (keepPlaying)
        for (const n of narrationsPlayingAt(placement, target))
          startNarration(n, target - n.startUs)
    },
    [clips, placement, srcOf, startNarration, stopAudio],
  )

  const pause = useCallback(() => {
    state.current.playing = false
    setPlaying(false)
    video.current?.pause()
    stopAudio()
  }, [stopAudio])

  const play = useCallback(() => {
    state.current.playing = true
    setPlaying(true)
    seek(tUs >= total ? 0 : tUs, true)
  }, [seek, tUs, total])

  // 播放时的时钟：到了片段的出点就换下一个，起点落在这一格里的旁白就开始播
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const v = video.current
      if (!v) return
      const i = state.current.index
      const c = clips[i]
      if (!c) return
      const sourceUs = v.currentTime * US
      if (clipFinished(c, sourceUs) || v.ended || !srcOf(i)) {
        const next = i + 1
        if (next >= clips.length) {
          pause()
          setTUs(total)
          return
        }
        seek(clips[next]!.startUs, true)
        return
      }
      const now = timelineAt(c, sourceUs)
      for (const n of narrationsToStart(placement, state.current.lastT, now)) startNarration(n)
      state.current.lastT = now
      setTUs(now)
    }, 100)
    return () => window.clearInterval(id)
  }, [playing, clips, placement, seek, srcOf, startNarration, pause, total])

  useEffect(
    () => () => {
      video.current?.pause()
      for (const a of audios.current.values()) a.pause()
    },
    [],
  )

  const empty = clips.length === 0
  return (
    <div className="flex flex-col gap-3">
      <div className="mx-auto w-full max-w-60">
        <Frame ratio={aspect} className="w-full">
          <video
            ref={video}
            playsInline
            poster={poster}
            className="absolute inset-0 size-full bg-black object-cover"
            aria-label={t('compose.preview.label')}
          />
        </Frame>
      </div>
      <div className="flex items-center gap-3">
        <IconButton
          label={playing ? t('compose.preview.pause') : t('compose.preview.play')}
          disabled={empty}
          onClick={() => (playing ? pause() : play())}
        >
          {playing ? <Pause {...iconProps} aria-hidden /> : <Play {...iconProps} aria-hidden />}
        </IconButton>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {clock(usToSec(tUs))}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(1, total)}
          step={100_000}
          value={Math.min(tUs, total)}
          disabled={empty}
          aria-label={t('compose.preview.seek')}
          onChange={(e) => seek(Number(e.target.value), state.current.playing)}
          className="min-w-0 flex-1 accent-[var(--accent)]"
        />
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {clock(usToSec(total))}
        </span>
      </div>
    </div>
  )
}
