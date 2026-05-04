import { useRef, useState } from 'react'
import { Loader2, Sparkles, StopCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActiveProvider } from '@/store/settings'
import { collectReferenceImages, generateShotImage } from '@/core/pipeline/image-shot'
import type { Storyboard } from '@/types/domain'

interface Props {
  shot: Storyboard
  /** 如果传入，会以这个图片大小请求模型；否则模型默认。 */
  size?: string
  className?: string
}

export function ShotImageButton({ shot, size, className }: Props) {
  const provider = useActiveProvider('text2image')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  if (!provider) {
    return (
      <Button variant="ghost" size="sm" disabled className={className}>
        <Sparkles className="h-3.5 w-3.5" /> 未配置文生图
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
    setError(null)
    try {
      const refs = await collectReferenceImages(shot.projectId, shot.characterIds)
      for await (const ev of generateShotImage({
        provider,
        storyboard: shot,
        referenceImageBlobs: refs,
        size,
        signal: abortRef.current.signal,
      })) {
        if (ev.phase === 'error') {
          setError(ev.message ?? '失败')
        }
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  return (
    <div className={className}>
      {running ? (
        <Button variant="destructive" size="sm" onClick={stop} className="gap-1.5">
          <StopCircle className="h-3.5 w-3.5" /> 中止
        </Button>
      ) : (
        <Button
          variant={shot.imageAssetId ? 'ghost' : 'secondary'}
          size="sm"
          onClick={start}
          className="gap-1.5"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {shot.imageAssetId ? '重生' : '生图'}
        </Button>
      )}
      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
