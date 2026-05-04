import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, Pencil, Trash2, Users, Workflow } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { db } from '@/core/storage/db'
import { deleteProject, updateProject } from '@/core/storage/projects'
import type { Project, ProjectStatus } from '@/types/domain'

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: '草稿',
  storyboarding: '分镜中',
  generating: '生成中',
  done: '已完成',
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  // useLiveQuery 在数据未就绪时返回第三参数（这里是 null），
  // 就绪后才会变成 Project | undefined。这样三态可分：
  //   null      → 加载中
  //   undefined → 加载完成但项目不存在
  //   Project   → 命中
  const project = useLiveQuery<Project | undefined, null>(
    () => (projectId ? db.projects.get(projectId) : Promise.resolve(undefined)),
    [projectId],
    null,
  )

  const [editing, setEditing] = useState(false)

  if (!projectId) return null

  if (project === null) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted">读取项目数据中…</p>
      </section>
    )
  }

  if (project === undefined) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold">项目不见了</h1>
        <p className="text-sm text-muted">这个项目可能已被删除，或者你访问了一个不存在的 ID。</p>
        <Link to="/projects">
          <Button variant="secondary" className="self-start gap-2">
            <ArrowLeft className="h-4 w-4" /> 回到项目列表
          </Button>
        </Link>
      </section>
    )
  }

  const handleDelete = async () => {
    if (!window.confirm(`确认删除项目「${project.title}」？相关分镜与素材都会一起删除。`)) {
      return
    }
    await deleteProject(project.id)
    navigate('/projects')
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-3">
        <Link to="/projects" className="self-start">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted">
            <ArrowLeft className="h-3.5 w-3.5" /> 项目列表
          </Button>
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Badge variant="muted">{STATUS_LABEL[project.status]}</Badge>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{project.title}</h1>
            {project.style && <p className="mt-1 text-sm text-muted">基调 · {project.style}</p>}
            {project.summary && (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/80">
                {project.summary}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              创建：{new Date(project.createdAt).toLocaleString('zh-CN')} · 更新：
              {new Date(project.updatedAt).toLocaleString('zh-CN')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing(true)}
              className="gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" /> 编辑
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              aria-label="删除"
              className="text-muted hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent">
            <Workflow className="h-5 w-5" />
          </div>
          <CardTitle>等待 v0.1 工作流接入</CardTitle>
          <CardDescription>
            v0.1 起这里是项目工作台：素材上传（doc/txt/md/img）、Prompt 输入框、
            分镜列表（流式增量渲染）、单条重生、阶段状态条。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-muted">
          <p>· 需要先在 设置 里配置一个 LLM 服务商</p>
          <p>· 需要在「角色」里登记主要出场角色（v0.2 落地）</p>
          <Link to={`/projects/${project.id}/characters`}>
            <Button variant="ghost" size="sm" className="mt-2 gap-1.5">
              <Users className="h-3.5 w-3.5" /> 角色卡（v0.2）
            </Button>
          </Link>
        </CardContent>
      </Card>

      <ProjectEditModal project={project} open={editing} onClose={() => setEditing(false)} />
    </section>
  )
}

function ProjectEditModal({
  project,
  open,
  onClose,
}: {
  project: Project
  open: boolean
  onClose: () => void
}) {
  const [title, setTitle] = useState(project.title)
  const [summary, setSummary] = useState(project.summary ?? '')
  const [style, setStyle] = useState(project.style ?? '')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    try {
      await updateProject(project.id, {
        title: title.trim(),
        summary: summary.trim() || undefined,
        style: style.trim() || undefined,
      })
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="编辑项目" className="max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Label>
          标题
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Label>
        <Label>
          一句话简介
          <Textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Label>
        <Label>
          风格
          <Input value={style} onChange={(e) => setStyle(e.target.value)} />
        </Label>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={!title.trim() || submitting}>
            {submitting ? '保存中…' : '保存'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
