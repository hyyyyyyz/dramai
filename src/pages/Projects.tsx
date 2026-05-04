import { Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function ProjectsPage() {
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">我的项目</h1>
          <p className="mt-1 text-sm text-muted">
            v0.1 起，这里会列出你浏览器里所有的短剧项目，以及它们的当前阶段。
          </p>
        </div>
        <Button disabled className="gap-2">
          <Plus className="h-4 w-4" /> 新建项目（v0.1）
        </Button>
      </div>

      <Card className="border-dashed bg-background-soft/60">
        <CardHeader>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent">
            <Sparkles className="h-5 w-5" />
          </div>
          <CardTitle>项目数据库还没接好</CardTitle>
          <CardDescription>
            v0.1 会把 IndexedDB（Dexie.js）接入，届时这里会出现项目卡片网格、
            筛选、搜索、最近活动等。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="ml-4 list-disc space-y-1 text-muted">
            <li>项目元信息：标题、摘要、风格、创建时间</li>
            <li>分镜数量、生成阶段、最后编辑时间</li>
            <li>一键导出 / 导入项目 JSON 备份</li>
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
