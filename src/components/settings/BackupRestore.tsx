import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import {
  exportBackup,
  importBackup,
  makeBackupFilename,
  triggerDownload,
  type ImportSummary,
} from '@/core/export/json'

export function BackupRestore() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [busy, setBusy] = useState<'idle' | 'exporting' | 'importing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const exportAll = async () => {
    setError(null)
    setBusy('exporting')
    try {
      const blob = await exportBackup({ appVersion: '0.1.0' })
      triggerDownload(blob, makeBackupFilename())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setPendingFile(f)
    if (fileRef.current) fileRef.current.value = ''
  }

  const runImport = async (mode: 'merge' | 'replace') => {
    if (!pendingFile) return
    setError(null)
    setBusy('importing')
    setSummary(null)
    try {
      const result = await importBackup(pendingFile, { mode })
      setSummary(result)
      setPendingFile(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('idle')
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={exportAll}
          disabled={busy !== 'idle'}
          className="gap-1.5"
        >
          <Download className="h-4 w-4" />
          {busy === 'exporting' ? '正在打包…' : '导出全部为 JSON'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== 'idle'}
          className="gap-1.5"
        >
          <Upload className="h-4 w-4" />
          导入备份…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={onFileChange}
          className="hidden"
        />
      </div>
      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {summary && (
        <p className="mt-2 text-xs text-emerald-300">
          导入完成：{summary.projects} 项目 / {summary.characters} 角色 / {summary.materials} 素材 /{' '}
          {summary.storyboards} 分镜 / {summary.assets} 资源
        </p>
      )}

      <Modal
        open={!!pendingFile}
        onClose={() => setPendingFile(null)}
        title="导入备份"
        description={pendingFile ? `文件：${pendingFile.name}` : undefined}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingFile(null)}>
              取消
            </Button>
            <Button variant="secondary" onClick={() => runImport('merge')}>
              合并
            </Button>
            <Button variant="destructive" onClick={() => runImport('replace')}>
              覆盖
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-muted">
          <p>
            <strong className="text-foreground">合并</strong>
            ：保留现有数据，相同 ID 的条目会被备份里的版本覆盖。
          </p>
          <p>
            <strong className="text-foreground">覆盖</strong>
            ：先把当前所有项目 / 分镜 / 资源清空，再恢复备份内容。不可撤销。
          </p>
        </div>
      </Modal>
    </>
  )
}
