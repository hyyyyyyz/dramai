import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Images, Loader2, StopCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActiveProvider } from '@/store/settings'
import { db } from '@/core/storage/db'
import { collectReferenceImages, generateShotImage } from '@/core/pipeline/image-shot'
import type { Storyboard } from '@/types/domain'

interface Props {
  projectId: string
  /** 默认 false：跳过已生过图的分镜；true：强制全部重生。 */
  forceAll?: boolean
}

interface Progress {
  total: number
  done: number
  failed: number
  current?: number
  message?: string
}

export function BatchImageButton({ projectId, forceAll = false }: Props) {
  const provider = useActiveProvider('text2image')
  const shots = useLiveQuery<Storyboard[], Storyboard[]>(
    () =>
      db.storyboards
        .where('[projectId+sequence]')
        .between([projectId, -Infinity], [projectId, Infinity], true, true)
        .toArray(),
    [projectId],
    [],
  )

  const [progress, setProgress] = useState<Progress | null>(null)
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  if (!provider) return null

  const targets = forceAll ? shots : shots.filter((s) => !s.imageAssetId)
  if (shots.length === 0) return null

  const stop = () => {
    abortRef.current?.abort()
    setRunning(false)
  }

  const start = async () => {
    if (targets.length === 0) return
    abortRef.current = new AbortController()
    setRunning(true)
    setProgress({ total: targets.length, done: 0, failed: 0 })

    let done = 0
    let failed = 0
    for (let i = 0; i < targets.length; i++) {
      if (abortRef.current.signal.aborted) break
      const shot = targets[i]
      setProgress({
        total: targets.length,
        done,
        failed,
        current: shot.sequence,
        message: '生成中…',
      })
      try {
        const refs = await collectReferenceImages(shot.projectId, shot.characterIds)
        let lastError: string | undefined
        for await (const ev of generateShotImage({
          provider,
          storyboard: shot,
          referenceImageBlobs: refs,
          signal: abortRef.current.signal,
        })) {
          if (ev.phase === 'error') lastError = ev.message
        }
        if (lastError) failed++
        else done++
      } catch (err) {
        failed++
        if (err instanceof Error && err.name === 'AbortError') break
      }
      setProgress({
        total: targets.length,
        done,
        failed,
        current: shot.sequence,
      })
    }
    setRunning(false)
    abortRef.current = null
  }

  const remaining = targets.length

  return (
    <div className="flex flex-wrap items-center gap-3">
      {running ? (
        <Button variant="destructive" onClick={stop} className="gap-2">
          <StopCircle className="h-4 w-4" /> 中止
        </Button>
      ) : (
        <Button onClick={start} disabled={remaining === 0} variant="secondary" className="gap-2">
          <Images className="h-4 w-4" />
          {forceAll
            ? `重生全部分镜图（${shots.length}）`
            : remaining > 0
              ? `批量生图（剩 ${remaining}）`
              : '所有分镜已有图'}
        </Button>
      )}
      {running && progress && (
        <span className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {progress.done}/{progress.total} 完成
          {progress.failed > 0 && (
            <span className="text-destructive">· 失败 {progress.failed}</span>
          )}
          {progress.current !== undefined && (
            <span>· 当前 #{String(progress.current).padStart(2, '0')}</span>
          )}
        </span>
      )}
    </div>
  )
}
