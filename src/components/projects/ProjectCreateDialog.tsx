import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { createProject } from '@/core/storage/projects'
import { STYLE_PRESET_GROUPS } from '@/core/prompts/style-presets'

interface Props {
  open: boolean
  onClose: () => void
}

export function ProjectCreateDialog({ open, onClose }: Props) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [style, setStyle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reset = () => {
    setTitle('')
    setSummary('')
    setStyle('')
  }

  const handleClose = () => {
    if (submitting) return
    reset()
    onClose()
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    try {
      const project = await createProject({ title, summary, style })
      reset()
      onClose()
      navigate(`/projects/${project.id}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="新建项目"
      description="给项目起个名，之后所有的素材和分镜都会归到这里。短剧、漫剧、写实、动画——风格留给你定，或留空让 LLM 从素材自己推断。"
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Label>
          标题
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：草莓蛋糕"
            autoFocus
            required
            maxLength={80}
          />
        </Label>
        <Label>
          一句话简介（可选）
          <Textarea
            rows={2}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="写给未来的自己，提醒这部短剧讲的是什么"
          />
        </Label>
        <Label>
          风格 / 基调（可选 · 留空时 LLM 会从文字素材自己推断）
          <div className="flex flex-col gap-2">
            {STYLE_PRESET_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </span>
                {group.presets.map((preset) => {
                  const active = style === preset.description
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setStyle(active ? '' : preset.description)}
                      className={
                        active
                          ? 'rounded-md border border-accent/60 bg-accent/15 px-2 py-1 text-xs text-accent'
                          : 'rounded-md border border-border bg-background-soft px-2 py-1 text-xs text-foreground transition-colors hover:border-accent/40 hover:bg-accent/10'
                      }
                      title={preset.description}
                    >
                      {preset.label}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
          <Input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="点上方任意预设，或自己写一段（中英文皆可）"
          />
        </Label>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={handleClose}>
            取消
          </Button>
          <Button type="submit" disabled={!title.trim() || submitting}>
            {submitting ? '创建中…' : '创建并打开'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
