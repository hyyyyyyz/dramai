import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobListItem } from '@dramai/api'
import { Progress } from '@dramai/ui/v2'
import { useEventSnapshot } from '@/data/use-events'
import { useFormat } from '@/i18n/format'

export interface StreamedTextLabels {
  running: string
  queued: string
  waiting: string
  queuedHint: string
  streamLabel: string
}

/** 流式文本：LLM 正在写的分集规划（原样的 JSON 输出），只显示最后一段。 */
export function StreamedText({ job, labels }: { job: JobListItem; labels: StreamedTextLabels }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const stream = useEventSnapshot().streams[job.id]
  const box = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [stream?.text])
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
      data-testid="job-stream"
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">
          {job.status === 'queued' ? labels.queued : labels.running}
        </span>
        {stream && (
          <span className="font-mono text-xs text-muted-foreground">
            {t('jobs.streamedChars', { count: stream.chars, n: fmt.number(stream.chars) })}
          </span>
        )}
      </div>
      <Progress aria-label={labels.running} indeterminate={job.status === 'running'} value={0} />
      {stream ? (
        <pre
          ref={box}
          tabIndex={0}
          aria-label={labels.streamLabel}
          className="max-h-48 overflow-auto rounded-sm bg-sunken p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground"
        >
          {stream.text.slice(-4000)}
        </pre>
      ) : (
        <p className="text-xs text-subtle">
          {job.status === 'running'
            ? t('materials.plan.waitingText')
            : t('materials.plan.queuedHint')}
        </p>
      )}
    </div>
  )
}
