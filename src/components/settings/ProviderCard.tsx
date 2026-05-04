import { useState } from 'react'
import { Check, Loader2, Pencil, RadioTower, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { testProvider } from '@/core/llm/test-connection'
import { PROVIDER_KIND_LABEL } from '@/components/settings/PROVIDER_PRESETS'
import { useSettingsStore } from '@/store/settings'
import type { Provider } from '@/types/domain'

interface Props {
  provider: Provider
  onEdit: () => void
}

export function ProviderCard({ provider, onEdit }: Props) {
  const isActive = useSettingsStore((s) => s.activeProviderIds[provider.kind] === provider.id)
  const setActive = useSettingsStore((s) => s.setActiveProvider)
  const remove = useSettingsStore((s) => s.removeProvider)
  const update = useSettingsStore((s) => s.updateProvider)

  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{
    ok: boolean
    msg: string
  } | null>(null)

  const runTest = async () => {
    setTesting(true)
    setResult(null)
    const r = await testProvider(provider)
    setTesting(false)
    if (r.ok) {
      const summary = r.warning
        ? r.warning
        : r.modelCount && r.modelCount > 0
          ? `连接 OK · 探测到 ${r.modelCount} 个模型`
          : '连接 OK'
      setResult({ ok: true, msg: summary })
      update(provider.id, { lastVerifiedAt: Date.now() })
    } else {
      setResult({ ok: false, msg: r.error ?? '未知错误' })
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4 transition-colors',
        isActive ? 'border-accent/60 bg-accent/5' : 'border-border bg-background-soft',
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{provider.label}</h3>
            <Badge variant="muted">{PROVIDER_KIND_LABEL[provider.kind]}</Badge>
            {isActive && (
              <Badge variant="success" className="gap-1">
                <Check className="h-3 w-3" /> 已激活
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate font-mono text-xs text-muted">{provider.baseUrl}</p>
          {provider.model && (
            <p className="mt-0.5 text-xs text-muted">
              模型 · <span className="text-foreground/80">{provider.model}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!isActive && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => setActive(provider.kind, provider.id)}
              title="设为该类型的当前激活服务商"
            >
              <RadioTower className="h-3.5 w-3.5" /> 激活
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="编辑">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => remove(provider.id)}
            aria-label="删除"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={runTest} disabled={testing}>
          {testing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 测试中
            </>
          ) : (
            '测试连接'
          )}
        </Button>
        {result && (
          <span className={cn('text-xs', result.ok ? 'text-emerald-300' : 'text-destructive')}>
            {result.msg}
          </span>
        )}
        {!result && provider.lastVerifiedAt && (
          <span className="text-xs text-muted">
            上次验证：{new Date(provider.lastVerifiedAt).toLocaleString('zh-CN')}
          </span>
        )}
      </div>

      {provider.notes && (
        <p className="border-t border-border pt-2 text-xs text-muted">{provider.notes}</p>
      )}
    </div>
  )
}
