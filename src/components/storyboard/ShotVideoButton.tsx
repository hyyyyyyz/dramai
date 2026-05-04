import { useRef, useState } from 'react'
import { Film, Loader2, StopCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActiveProvider } from '@/store/settings'
import { generateShotVideo, type VideoShotEvent } from '@/core/pipeline/video-shot'
import type { Storyboard } from '@/types/domain'

interface Props {
  shot: Storyboard
  className?: string
}

const PHASE_LABEL: Record<VideoShotEvent['phase'], string> = {
  submitting: '提交中…',
  queued: '排队…',
  processing: '生成中…',
  downloading: '下载中…',
  persisting: '保存中…',
  done: '完成',
  error: '失败',
}

export function ShotVideoButton({ shot, className }: Props) {
  const provider = useActiveProvider('image2video')
  const [running, setRunning] = useState(false)
  const [event, setEvent] = useState<VideoShotEvent | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  if (!provider) {
    return (
      <Button variant="ghost" size="sm" disabled className={className}>
        <Film className="h-3.5 w-3.5" /> 未配视频
      </Button>
    )
  }

  if (!shot.imageAssetId) {
    return (
      <Button variant="ghost" size="sm" disabled className={className} title="先生图再生视频">
        <Film className="h-3.5 w-3.5" /> 需先生图
      </Button>
    )
  }

  const stop = () => {
    abortRef.current?.abort()
    setRunning(false)
  }

  const start = async () => {
    abortRef.current = new AbortController()
    setRunning(true)
    setEvent(null)
    try {
      for await (const ev of generateShotVideo({
        provider,
        storyboard: shot,
        signal: abortRef.current.signal,
      })) {
        setEvent(ev)
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  return (
    <div className={className}>
      {running ? (
        <div className="flex items-center gap-2">
          <Button variant="destructive" size="sm" onClick={stop} className="gap-1.5">
            <StopCircle className="h-3.5 w-3.5" /> 中止
          </Button>
          {event && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Loader2 className="h-3 w-3 animate-spin" />
              {PHASE_LABEL[event.phase]}
            </span>
          )}
        </div>
      ) : (
        <Button
          variant={shot.videoAssetId ? 'ghost' : 'secondary'}
          size="sm"
          onClick={start}
          className="gap-1.5"
        >
          <Film className="h-3.5 w-3.5" />
          {shot.videoAssetId ? '重生视频' : '生视频'}
        </Button>
      )}
      {event?.phase === 'error' && event.message && (
        <p className="mt-1 text-xs text-destructive">{event.message}</p>
      )}
    </div>
  )
}
