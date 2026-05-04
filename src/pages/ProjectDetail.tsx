import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, FolderOpen, Pencil, ScrollText, Trash2, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { Textarea } from '@/components/ui/textarea'
import { MaterialList } from '@/components/upload/MaterialList'
import { MaterialUploadArea } from '@/components/upload/MaterialUploadArea'
import { StoryboardGenerator } from '@/components/storyboard/StoryboardGenerator'
import { StoryboardList } from '@/components/storyboard/StoryboardList'
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-accent" />
            素材
          </CardTitle>
          <CardDescription>
            上传 doc / txt / md 文档作为剧情底稿，或者上传参考图。所有文件保存在 浏览器
            IndexedDB，不会上传到任何服务器。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <MaterialUploadArea projectId={project.id} />
          <MaterialList projectId={project.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-accent" />
            分镜生成
          </CardTitle>
          <CardDescription>
            把素材 + 一句话指令喂给当前激活的 LLM，得到结构化分镜（场景描述、旁白、
            生图提示词、出场角色）。重新生成会清空当前分镜。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <StoryboardGenerator project={project} />
          <div className="border-t border-border pt-5">
            <StoryboardList projectId={project.id} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            角色卡（v0.2）
          </CardTitle>
          <CardDescription>
            为关键角色绑定参考图，让多镜头里形象保持一致。当前 v0.1 还未实现编辑界面，
            生成时所有角色按 LLM 自由发挥。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link to={`/projects/${project.id}/characters`}>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <Users className="h-3.5 w-3.5" /> 进入角色页（占位）
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
