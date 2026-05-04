import { useParams } from 'react-router-dom'
import { Workflow } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-2">
        <Badge variant="muted" className="self-start">
          项目工作台
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight">
          项目 <code className="text-base text-muted">{projectId}</code>
        </h1>
        <p className="text-sm text-muted">
          v0.1 起这里是核心工作台：上传素材、写一句提示词、点击生成，分镜列表会实时 流式刷新。
        </p>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent">
            <Workflow className="h-5 w-5" />
          </div>
          <CardTitle>等待 v0.1 接入</CardTitle>
          <CardDescription>
            将包含：素材上传区（doc/txt/md/img）、Prompt 输入框、风格选择、模型选择、
            分镜列表（流式增量渲染）、单条重生按钮、阶段状态条。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted">
            想关注进度？请看{' '}
            <a
              href="https://github.com/hyyyyyyz/dramai/blob/main/docs/ROADMAP.md"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent hover:underline"
            >
              ROADMAP.md
            </a>
            。
          </p>
        </CardContent>
      </Card>
    </section>
  )
}
