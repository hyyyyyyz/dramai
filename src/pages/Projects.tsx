import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ProjectCard } from '@/components/projects/ProjectCard'
import { ProjectCreateDialog } from '@/components/projects/ProjectCreateDialog'
import { db } from '@/core/storage/db'

export function ProjectsPage() {
  const [creating, setCreating] = useState(false)
  const projects = useLiveQuery(() => db.projects.orderBy('updatedAt').reverse().toArray(), [], [])

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">我的项目</h1>
          <p className="mt-1 text-sm text-muted">
            所有数据保存在浏览器 IndexedDB · 共 {projects.length} 个项目
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="h-4 w-4" /> 新建项目
        </Button>
      </div>

      {projects.length === 0 ? (
        <Card className="border-dashed bg-background-soft/50">
          <CardHeader>
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent">
              <Sparkles className="h-5 w-5" />
            </div>
            <CardTitle>还没有项目</CardTitle>
            <CardDescription>
              新建一个项目，把你的脑洞、文案、参考图丢进去，让 LLM 帮你写分镜。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setCreating(true)} className="gap-2">
              <Plus className="h-4 w-4" /> 创建第一个项目
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      <ProjectCreateDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  )
}
