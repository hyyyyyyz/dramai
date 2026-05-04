import { useMemo, useState } from 'react'
import { Archive, Database, KeyRound, Plus, Server, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { ProviderForm, type ProviderDraft } from '@/components/settings/ProviderForm'
import { ProviderCard } from '@/components/settings/ProviderCard'
import { PROVIDER_KIND_LABEL } from '@/components/settings/PROVIDER_PRESETS'
import { BackupRestore } from '@/components/settings/BackupRestore'
import { useSettingsStore } from '@/store/settings'
import { wipeAll } from '@/core/storage/db'
import type { Provider, ProviderKind } from '@/types/domain'

export function SettingsPage() {
  const providers = useSettingsStore((s) => s.providers)
  const addProvider = useSettingsStore((s) => s.addProvider)
  const updateProvider = useSettingsStore((s) => s.updateProvider)
  const resetSettings = useSettingsStore((s) => s.resetAll)

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const grouped = useMemo(() => {
    const byKind: Record<ProviderKind, Provider[]> = {
      llm: [],
      text2image: [],
      image2video: [],
      imageEdit: [],
    }
    for (const p of providers) byKind[p.kind].push(p)
    return byKind
  }, [providers])

  const handleCreate = (draft: ProviderDraft) => {
    addProvider(draft)
    setCreating(false)
  }

  const handleUpdate = (draft: ProviderDraft) => {
    if (!editing) return
    updateProvider(editing.id, draft)
    setEditing(null)
  }

  const handleReset = async () => {
    resetSettings()
    await wipeAll()
    setConfirmReset(false)
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-muted">
          所有数据都只存在你的浏览器里。dramai 不会把任何信息发往中央服务器 ——因为根本没有服务器。
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-4 w-4 text-accent" />
                AI 服务商
              </CardTitle>
              <CardDescription>
                配置任何兼容 OpenAI Chat / Images 协议的 endpoint。每种类型可以
                配多个，分别"激活"其中一个用于工作流。
              </CardDescription>
            </div>
            <Button onClick={() => setCreating(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> 添加
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {(Object.keys(PROVIDER_KIND_LABEL) as ProviderKind[]).map((kind) => {
            const list = grouped[kind]
            if (list.length === 0 && kind !== 'llm') return null
            return (
              <div key={kind}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {PROVIDER_KIND_LABEL[kind]}
                  </span>
                  <Badge variant="muted">{list.length}</Badge>
                </div>
                {list.length === 0 ? (
                  <p className="text-sm text-muted">
                    还没有配置 · 这是核心，请先添加一个 LLM 服务商。
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {list.map((p) => (
                      <ProviderCard key={p.id} provider={p} onEdit={() => setEditing(p)} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-accent" />
            备份与恢复
          </CardTitle>
          <CardDescription>
            把所有项目 / 分镜 / 角色 / 素材 / 资源打包成单个 JSON 文件，方便跨浏览器迁移 或
            versioned snapshot。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BackupRestore />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            数据与隐私
          </CardTitle>
          <CardDescription>
            API Key 存在 localStorage（仅本机）。项目 / 角色 / 分镜 / 资源等存在
            IndexedDB（仅本机）。下面这块一旦清空就找不回来了 —— 建议先用「导出全部」备份。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background-soft-2/60 p-3">
            <Database className="h-4 w-4 text-muted" />
            <span className="text-sm text-muted">
              数据库名：<code className="text-foreground/80">dramai</code> · localStorage 键：
              <code className="text-foreground/80">dramai-settings</code>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => setConfirmReset(true)} className="gap-1.5">
              <ShieldAlert className="h-4 w-4" /> 清空全部本地数据
            </Button>
          </div>
        </CardContent>
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="添加 AI 服务商"
        description="所有字段都只保存在你的浏览器里。"
        className="max-w-lg"
      >
        <ProviderForm
          onCancel={() => setCreating(false)}
          onSubmit={handleCreate}
          submitLabel="添加"
        />
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="编辑服务商"
        className="max-w-lg"
      >
        {editing && (
          <ProviderForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSubmit={handleUpdate}
            submitLabel="保存"
          />
        )}
      </Modal>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="确认清空全部数据？"
        description="包含所有项目、角色、分镜、资源、Provider 配置。这个操作不可恢复。"
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              再想想
            </Button>
            <Button variant="destructive" onClick={handleReset}>
              是的，全部清空
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          建议先在「项目」页面把要保留的项目导出 JSON（v0.1 后续提供）。
        </p>
      </Modal>
    </section>
  )
}
