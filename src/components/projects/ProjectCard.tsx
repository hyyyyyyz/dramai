import { Link } from 'react-router-dom'
import { ArrowRight, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { deleteProject } from '@/core/storage/projects'
import type { Project, ProjectStatus } from '@/types/domain'

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: '草稿',
  storyboarding: '分镜中',
  generating: '生成中',
  done: '已完成',
}

interface Props {
  project: Project
}

export function ProjectCard({ project }: Props) {
  const handleDelete = async () => {
    if (!window.confirm(`确认删除项目「${project.title}」？相关分镜与素材都会一起删除。`)) {
      return
    }
    await deleteProject(project.id)
  }

  return (
    <article className="group relative flex flex-col gap-3 rounded-xl border border-border bg-background-soft p-5 transition-colors hover:border-accent/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">{project.title}</h3>
          {project.style && <p className="mt-0.5 truncate text-xs text-muted">{project.style}</p>}
        </div>
        <Badge variant="muted">{STATUS_LABEL[project.status]}</Badge>
      </div>

      {project.summary && (
        <p className="line-clamp-3 text-sm leading-relaxed text-muted">{project.summary}</p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-2">
        <span className="text-xs text-muted">
          {new Date(project.updatedAt).toLocaleDateString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          更新
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            aria-label="删除"
            className="text-muted hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Link to={`/projects/${project.id}`}>
            <Button variant="secondary" size="sm" className="gap-1">
              打开 <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </article>
  )
}
