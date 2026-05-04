import { useLiveQuery } from 'dexie-react-hooks'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { db } from '@/core/storage/db'
import { deleteStoryboard } from '@/core/storage/storyboards'
import type { Storyboard } from '@/types/domain'

interface Props {
  projectId: string
}

const STATUS_LABEL: Record<Storyboard['status'], string> = {
  pending: '待生图',
  'image-ready': '图已生成',
  'video-ready': '视频已生成',
  failed: '失败',
}

export function StoryboardList({ projectId }: Props) {
  const shots = useLiveQuery<Storyboard[], Storyboard[]>(
    () =>
      db.storyboards
        .where('[projectId+sequence]')
        .between([projectId, -Infinity], [projectId, Infinity], true, true)
        .toArray(),
    [projectId],
    [],
  )

  if (shots.length === 0) {
    return <p className="text-sm text-muted">还没有分镜。在上方写下指令，点「生成分镜」即可。</p>
  }

  return (
    <ol className="flex flex-col gap-3">
      {shots.map((s) => (
        <li key={s.id} className="rounded-lg border border-border bg-background-soft p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted">
                #{String(s.sequence).padStart(2, '0')}
              </span>
              <Badge variant="muted">{STATUS_LABEL[s.status]}</Badge>
              {s.durationSec && <span className="text-xs text-muted">{s.durationSec}s</span>}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted hover:text-destructive"
              onClick={() => {
                if (window.confirm(`删除分镜 #${s.sequence}？`)) {
                  deleteStoryboard(s.id)
                }
              }}
              aria-label="删除分镜"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-foreground">{s.sceneText}</p>
          {s.narration && <p className="mt-2 text-sm italic text-muted">旁白：{s.narration}</p>}
          {s.imagePrompt && (
            <p className="mt-2 font-mono text-xs leading-relaxed text-muted">
              <span className="text-accent">img·</span> {s.imagePrompt}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}
