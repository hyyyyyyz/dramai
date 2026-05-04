import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  PROVIDER_KIND_LABEL,
  PROVIDER_PRESETS,
  type ProviderPreset,
} from '@/components/settings/PROVIDER_PRESETS'
import type { ApiFlavor, Provider, ProviderKind } from '@/types/domain'

const API_FLAVOR_LABEL: Record<ApiFlavor, string> = {
  'openai-compatible': 'OpenAI 兼容（默认 · 走 /v1/...）',
  gemini:
    'Gemini 原生（文生图专用 · 走 /v1beta/models/{model}:generateContent · Nano Banana / Imagen）',
  volcengine:
    '火山方舟 / 即梦（image2video · POST /volcengine/api/v3/contents/generations/tasks · Seedance）',
  kling: 'Kling 原生（image2video 专用 · POST /v1/videos/image2video）',
  runway: 'Runway 原生（暂未完整接入，先按 OpenAI 兼容兜底）',
}

export type ProviderDraft = Omit<Provider, 'id' | 'lastVerifiedAt'>

interface Props {
  initial?: Partial<ProviderDraft>
  onCancel: () => void
  onSubmit: (draft: ProviderDraft) => void
  submitLabel?: string
}

export function ProviderForm({ initial, onCancel, onSubmit, submitLabel = '保存' }: Props) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [kind, setKind] = useState<ProviderKind>(initial?.kind ?? 'llm')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? '')
  const [model, setModel] = useState(initial?.model ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [apiFlavor, setApiFlavor] = useState<ApiFlavor>(initial?.apiFlavor ?? 'openai-compatible')

  const applyPreset = (preset: ProviderPreset) => {
    setLabel(preset.label)
    setKind(preset.kind)
    setBaseUrl(preset.baseUrl)
    setModel(preset.suggestedModel)
    if (preset.apiFlavor) setApiFlavor(preset.apiFlavor)
    if (preset.notes && !notes) setNotes(preset.notes)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!label.trim() || !baseUrl.trim()) return
    onSubmit({
      label: label.trim(),
      kind,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
      notes: notes.trim() || undefined,
      apiFlavor: kind === 'image2video' || kind === 'text2image' ? apiFlavor : undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {!initial && (
        <div className="rounded-md border border-dashed border-border bg-background-soft-2/40 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">从预设选一个（可选）</div>
          <div className="flex flex-wrap gap-1.5">
            {PROVIDER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className="rounded-md border border-border bg-background-soft px-2.5 py-1 text-xs text-foreground transition-colors hover:border-accent/50 hover:bg-accent/10"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <Label>
        显示名称
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="例如：OpenRouter LLM"
          required
        />
      </Label>

      <Label>
        服务类型
        <Select value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)}>
          {(Object.keys(PROVIDER_KIND_LABEL) as ProviderKind[]).map((k) => (
            <option key={k} value={k}>
              {PROVIDER_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </Label>

      <Label>
        Base URL
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
          required
        />
      </Label>

      <Label>
        API Key
        <Input
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="只保存在你的浏览器里"
        />
      </Label>

      <Label>
        模型名
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="例如：gpt-4o-mini"
        />
      </Label>

      {(kind === 'image2video' || kind === 'text2image') && (
        <Label>
          API 协议风格
          <Select value={apiFlavor} onChange={(e) => setApiFlavor(e.target.value as ApiFlavor)}>
            {(Object.keys(API_FLAVOR_LABEL) as ApiFlavor[])
              .filter((f) => {
                // 文生图：OpenAI 兼容 / Gemini 原生
                // 图生视频：OpenAI 兼容 / 火山方舟 / Kling / Runway
                if (kind === 'text2image') {
                  return f === 'openai-compatible' || f === 'gemini'
                }
                return f !== 'gemini'
              })
              .map((f) => (
                <option key={f} value={f}>
                  {API_FLAVOR_LABEL[f]}
                </option>
              ))}
          </Select>
        </Label>
      )}

      <Label>
        备注（可选）
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="自己的额外说明，例如计费策略、限速等"
        />
      </Label>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  )
}
