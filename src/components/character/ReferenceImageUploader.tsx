import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Loader2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseImageFile } from '@/core/parsers/image'
import { createAsset, deleteAsset, getObjectURL, releaseObjectURL } from '@/core/storage/assets'
import { db } from '@/core/storage/db'
import type { Asset } from '@/types/domain'

interface Props {
  projectId: string
  /** 当前已绑定的 asset id（编辑模式）。 */
  value?: string
  onChange: (assetId: string | undefined) => void
}

export function ReferenceImageUploader({ projectId, value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const asset = useLiveQuery<Asset | undefined, null>(
    () => (value ? db.assets.get(value) : Promise.resolve(undefined)),
    [value],
    null,
  )
  const previewUrl = useMemo(() => (asset ? getObjectURL(asset) : null), [asset])

  // 卸载时回收 ObjectURL（asset 切换时也回收旧的）
  useEffect(() => {
    if (!asset) return
    return () => releaseObjectURL(asset.id)
  }, [asset])

  const handlePick = async (file: File) => {
    setError(null)
    setBusy(true)
    try {
      const parsed = await parseImageFile(file)
      const newAsset = await createAsset({
        projectId,
        kind: 'image',
        blob: parsed.blob,
        mimeType: parsed.mimeType,
        width: parsed.preview?.width,
        height: parsed.preview?.height,
      })
      onChange(newAsset.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleClear = async () => {
    if (value) {
      try {
        await deleteAsset(value)
      } catch {
        /* noop */
      }
    }
    onChange(undefined)
  }

  return (
    <div className="flex flex-col gap-2">
      {previewUrl ? (
        <div className="group relative h-40 w-40 overflow-hidden rounded-lg border border-border bg-background-soft-2">
          <img
            src={previewUrl}
            alt="参考图"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
            aria-label="移除参考图"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex h-40 w-40 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-background-soft/40 text-xs text-muted transition-colors hover:border-accent/40 hover:bg-background-soft hover:text-foreground"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          点击上传参考图
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handlePick(f)
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {previewUrl && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="self-start text-xs"
        >
          换一张
        </Button>
      )}
    </div>
  )
}
