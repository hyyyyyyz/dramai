import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { createProject } from '@/core/storage/projects'

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
      title="新建短剧项目"
      description="给项目起个名，之后所有的素材和分镜都会归到这里。"
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
          风格 / 基调（可选）
          <Input
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="例如：温馨童话、宫斗、悬疑、Vlog"
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
