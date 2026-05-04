import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  AlertTriangle,
  Captions,
  Download,
  FileArchive,
  Film,
  Loader2,
  StopCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/core/storage/db'
import { concatVideos, type ConcatProgress } from '@/core/composition/concat'
import { buildSrt, buildVtt } from '@/core/composition/subtitles'
import { buildJianyingPackage } from '@/core/export/jianying'
import { triggerDownload } from '@/core/export/json'
import type { Asset, Project, Storyboard } from '@/types/domain'

interface Props {
  project: Project
}

export function CompositionCard({ project }: Props) {
  const shots = useLiveQuery<Storyboard[], Storyboard[]>(
    async () =>
      db.storyboards
        .where('[projectId+sequence]')
        .between([project.id, -Infinity], [project.id, Infinity], true, true)
        .toArray(),
    [project.id],
    [],
  )

  const videoAssetIds = shots.map((s) => s.videoAssetId).filter((x): x is string => !!x)
  const videoCount = videoAssetIds.length

  const composedAsset = useLiveQuery<Asset | undefined, null>(
    async () => {
      const list = await db.assets
        .where('projectId')
        .equals(project.id)
        .and((a) => a.mimeType === 'video/mp4' && a.kind === 'video')
        .toArray()
      // 按 createdAt 降序拿第一个、且 storyboards 里没引用的（即合成产物）
      const referenced = new Set(videoAssetIds)
      const standalone = list
        .filter((a) => !referenced.has(a.id))
        .sort((a, b) => b.createdAt - a.createdAt)
      return standalone[0]
    },
    [project.id, videoAssetIds.join(',')],
    null,
  )

  const [composing, setComposing] = useState(false)
  const [progress, setProgress] = useState<ConcatProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const stopCompose = () => {
    abortRef.current?.abort()
    setComposing(false)
  }

  const compose = async () => {
    if (videoCount === 0) return
    setError(null)
    abortRef.current = new AbortController()
    setComposing(true)
    setProgress({ phase: 'loading' })
    try {
      const sortedShots = shots
        .filter((s) => s.videoAssetId)
        .sort((a, b) => a.sequence - b.sequence)
      const inputs: Array<{ blob: Blob; name: string }> = []
      for (const s of sortedShots) {
        if (!s.videoAssetId) continue
        const a = await db.assets.get(s.videoAssetId)
        if (a)
          inputs.push({
            blob: a.blob,
            name: `shot_${String(s.sequence).padStart(2, '0')}.mp4`,
          })
      }
      const merged = await concatVideos(inputs, {
        onProgress: setProgress,
        signal: abortRef.current.signal,
      })

      // 把成品作为新 asset 落库；旧的合成产物一起清理
      if (composedAsset) {
        try {
          await db.assets.delete(composedAsset.id)
        } catch {
          /* noop */
        }
      }
      const id = `composed-${Date.now()}`
      await db.assets.add({
        id,
        projectId: project.id,
        kind: 'video',
        mimeType: 'video/mp4',
        blob: merged,
        createdAt: Date.now(),
      })
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message)
      }
    } finally {
      setComposing(false)
      abortRef.current = null
    }
  }

  const exportSrt = () => {
    const srt = buildSrt(shots.slice().sort((a, b) => a.sequence - b.sequence))
    triggerDownload(
      new Blob([srt], { type: 'application/x-subrip' }),
      makeFilename(project.title, 'srt'),
    )
  }
  const exportVtt = () => {
    const vtt = buildVtt(shots.slice().sort((a, b) => a.sequence - b.sequence))
    triggerDownload(new Blob([vtt], { type: 'text/vtt' }), makeFilename(project.title, 'vtt'))
  }
  const exportJianying = async () => {
    const zip = await buildJianyingPackage(project)
    triggerDownload(zip, makeFilename(project.title, 'zip', 'jianying'))
  }

  const exportComposed = () => {
    if (!composedAsset) return
    triggerDownload(composedAsset.blob, makeFilename(project.title, 'mp4', 'final'))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Film className="h-4 w-4 text-accent" />
          合成 / 字幕 / 剪映导出
        </CardTitle>
        <CardDescription>
          把已生成的分镜视频拼成完整短剧、导出 SRT 字幕，或者打包成可拖进剪映的 ZIP。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {composing ? (
            <Button variant="destructive" onClick={stopCompose} className="gap-2">
              <StopCircle className="h-4 w-4" /> 中止
            </Button>
          ) : (
            <Button
              variant="default"
              onClick={compose}
              disabled={videoCount === 0}
              className="gap-2"
              title={
                videoCount === 0
                  ? '先把分镜的视频生成出来再合成'
                  : `把 ${videoCount} 个分镜视频拼成一条 mp4`
              }
            >
              <Film className="h-4 w-4" />
              {composedAsset ? '重新合成' : `合成成片（${videoCount} 段）`}
            </Button>
          )}
          {composing && progress && (
            <span className="flex items-center gap-2 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {progressLabel(progress)}
            </span>
          )}
          {composedAsset && !composing && (
            <Button variant="secondary" onClick={exportComposed} className="gap-2">
              <Download className="h-4 w-4" /> 下载成片 mp4
            </Button>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" /> 合成失败
            </div>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap break-words">{error}</pre>
            <p className="mt-1 text-muted">
              FFmpeg.wasm 单线程对编码差异较敏感。建议先确保各分镜视频是同一供应商生成的；
              或者改用下方「剪映 ZIP」走桌面剪映拼接。
            </p>
          </div>
        )}

        <div className="border-t border-border pt-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            字幕 / 草稿包
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={exportSrt}
              disabled={shots.length === 0}
              className="gap-1.5"
            >
              <Captions className="h-3.5 w-3.5" /> 导出 SRT
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={exportVtt}
              disabled={shots.length === 0}
              className="gap-1.5"
            >
              <Captions className="h-3.5 w-3.5" /> 导出 VTT
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={exportJianying}
              disabled={shots.length === 0}
              className="gap-1.5"
            >
              <FileArchive className="h-3.5 w-3.5" /> 剪映 ZIP（alpha）
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            剪映 ZIP 当前 alpha：包含各分镜的 mp4 / 图片 + SRT 字幕 + manifest.json，
            建议在剪映里手动新建项目后把素材拖入。直接打开 .draft_content 的支持在 v0.5+ 落地。
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function progressLabel(p: ConcatProgress): string {
  switch (p.phase) {
    case 'loading':
      return '加载 FFmpeg.wasm 中（首次需下载 ~30MB）…'
    case 'transcoding':
      return p.totalClips ? `转码中… ${p.currentClip}/${p.totalClips}` : '转码中…'
    case 'concatenating':
      return '拼接中…'
    case 'done':
      return '完成'
  }
}

function makeFilename(title: string, ext: string, suffix?: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const slug = title.replace(/[^\w一-龥]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
  return `dramai-${slug}${suffix ? `-${suffix}` : ''}-${date}.${ext}`
}
