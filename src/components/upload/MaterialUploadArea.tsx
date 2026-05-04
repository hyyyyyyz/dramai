import { useRef, useState, type DragEvent, type ChangeEvent } from 'react'
import { FilePlus2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { parseFile } from '@/core/parsers'
import { saveMaterial } from '@/core/storage/materials'

interface Props {
  projectId: string
  className?: string
}

export function MaterialUploadArea({ projectId, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ingest = async (files: FileList | File[]) => {
    setError(null)
    setBusy(true)
    try {
      const list = Array.from(files)
      for (const file of list) {
        try {
          const parsed = await parseFile(file)
          await saveMaterial(projectId, parsed)
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
          // 单文件失败不阻断其它文件
        }
      }
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) ingest(e.dataTransfer.files)
  }

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) ingest(e.target.files)
  }

  return (
    <div className={className}>
      <div
        onDragEnter={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragOver
            ? 'border-accent/70 bg-accent/10'
            : 'border-border bg-background-soft/40 hover:border-accent/40 hover:bg-background-soft',
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <FilePlus2 className="h-5 w-5" />}
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">把素材文件拖到这里</p>
          <p className="mt-1 text-xs text-muted">
            支持 .doc / .docx / .txt / .md / .png / .jpg / .webp · 单文件 ≤ 20MB
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          选择文件
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".doc,.docx,.txt,.md,.markdown,image/*"
          onChange={handleChange}
          className="hidden"
        />
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}
