import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Loader2, Sparkles, StopCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useActiveProvider } from '@/store/settings'
import { db } from '@/core/storage/db'
import { generateStoryboards, type StoryboardEvent } from '@/core/pipeline/storyboard'
import type { Character, Material, Project } from '@/types/domain'

interface Props {
  project: Project
}

const DEFAULT_PROMPT_PLACEHOLDER =
  '一句话告诉 LLM 你想要怎样的短剧。\n\n例：把上传的故事改写成 6 个分镜，温馨童话风格，每镜 5 秒，主角是小狐狸。'

export function StoryboardGenerator({ project }: Props) {
  const llmProvider = useActiveProvider('llm')
  const materials = useLiveQuery<Material[], Material[]>(
    () => db.materials.where('projectId').equals(project.id).reverse().sortBy('createdAt'),
    [project.id],
    [],
  )
  const characters = useLiveQuery<Character[], Character[]>(
    () => db.characters.where('projectId').equals(project.id).toArray(),
    [project.id],
    [],
  )

  const [userPrompt, setUserPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [event, setEvent] = useState<StoryboardEvent | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const canRun = !!llmProvider && !running && (userPrompt.trim().length > 0 || materials.length > 0)

  const start = async () => {
    if (!llmProvider) return
    abortRef.current = new AbortController()
    setRunning(true)
    setEvent({ phase: 'starting' })
    try {
      for await (const ev of generateStoryboards({
        provider: llmProvider,
        project,
        materials,
        characters,
        userPrompt,
        signal: abortRef.current.signal,
      })) {
        setEvent(ev)
        if (ev.phase === 'done' || ev.phase === 'error') break
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    setRunning(false)
  }

  return (
    <div className="flex flex-col gap-4">
      {!llmProvider && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          还没有激活的 LLM 服务商。先到{' '}
          <Link to="/settings" className="text-accent underline">
            设置
          </Link>{' '}
          配置一个，再回来生成。
        </div>
      )}

      <Label>
        给 LLM 的指令（可选）
        <Textarea
          rows={4}
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          placeholder={DEFAULT_PROMPT_PLACEHOLDER}
          disabled={running}
        />
      </Label>

      <div className="flex flex-wrap items-center gap-3">
        {!running ? (
          <Button onClick={start} disabled={!canRun} className="gap-2">
            <Sparkles className="h-4 w-4" /> 生成分镜
          </Button>
        ) : (
          <Button variant="destructive" onClick={stop} className="gap-2">
            <StopCircle className="h-4 w-4" /> 中止
          </Button>
        )}
        {llmProvider && (
          <span className="text-xs text-muted">
            模型 · <span className="text-foreground/80">{llmProvider.label}</span>
            {llmProvider.model && (
              <>
                {' '}
                · <code className="text-foreground/80">{llmProvider.model}</code>
              </>
            )}
          </span>
        )}
      </div>

      {event && <EventBanner event={event} running={running} />}
    </div>
  )
}

function EventBanner({ event, running }: { event: StoryboardEvent; running: boolean }) {
  if (event.phase === 'error') {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        生成失败：{event.message}
        {event.raw && (
          <details className="mt-1 text-xs text-muted">
            <summary className="cursor-pointer">展开 LLM 原文</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px]">
              {event.raw}
            </pre>
          </details>
        )}
      </div>
    )
  }

  if (event.phase === 'done') {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
        已生成 {event.shotCount} 个分镜。
      </div>
    )
  }

  const label =
    event.phase === 'starting'
      ? '正在准备…'
      : event.phase === 'streaming'
        ? '正在接收 LLM 输出…'
        : event.phase === 'parsing'
          ? '正在解析 JSON…'
          : '正在落库…'

  const accumulated =
    event.phase === 'streaming' || event.phase === 'parsing' ? event.accumulated : ''

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background-soft p-3 text-sm">
      <div className="flex items-center gap-2 text-muted">
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        <span>{label}</span>
      </div>
      {accumulated && (
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted">
          {accumulated.slice(-1500)}
        </pre>
      )}
    </div>
  )
}
