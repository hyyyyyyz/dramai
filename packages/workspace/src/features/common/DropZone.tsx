import { useRef, useState, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
import { cn, iconProps } from '@dramai/ui/v2'

/** 拖放或点击选择文件。键盘上就是一个按钮。 */
export function DropZone({
  accept,
  multiple = true,
  onFiles,
  children,
  disabled,
  className,
}: {
  accept: string
  multiple?: boolean
  onFiles: (files: File[]) => void
  children: ReactNode
  disabled?: boolean
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const pick = (list: FileList | null) => {
    const files = list ? Array.from(list) : []
    if (files.length > 0) onFiles(files)
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) pick(e.dataTransfer.files)
      }}
      className={cn(
        'flex items-center justify-center gap-2 rounded-md border border-dashed border-border-strong text-sm text-muted-foreground transition-colors duration-(--duration-fast) ease-standard',
        over && 'border-accent bg-accent-soft text-foreground',
        className,
      )}
    >
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="flex min-h-16 w-full items-center justify-center gap-2 rounded-md px-4 py-4 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Upload {...iconProps} aria-hidden />
        {children}
      </button>
    </div>
  )
}
