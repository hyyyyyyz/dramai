import { Link } from 'react-router-dom'
import {
  ArrowRight,
  FileText,
  Image as ImageIcon,
  ScrollText,
  Sparkles,
  Users,
  Wand2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const FEATURES = [
  {
    icon: FileText,
    title: '把素材丢进来',
    desc: '上传 doc / txt / md，或者贴入参考图，再加一句你想要的短剧风格。',
  },
  {
    icon: ScrollText,
    title: 'LLM 生成结构化分镜',
    desc: '场景描述、旁白、生图提示词、运镜参数，一次生成，可手动微调。',
  },
  {
    icon: Users,
    title: '角色卡，多镜不变形',
    desc: '为关键角色绑定参考图，其它角色随机但与主角不同。',
  },
  {
    icon: ImageIcon,
    title: '分镜图 → 视频片段',
    desc: 'OpenAI Images / Runway / 可灵兼容，一键串起完整 pipeline。',
  },
] as const

const STAGES = ['上传素材', '生成分镜', '角色一致性', '文生图', '图生视频', '剪映导出']

export function HomePage() {
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-16 px-4 py-12 sm:px-6 sm:py-20">
      <div className="flex flex-col items-start gap-6">
        <Badge variant="accent" className="gap-1.5">
          <Sparkles className="h-3 w-3" /> v0.0.1 · 浏览器内 · 零后端
        </Badge>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          把你的 <span className="text-gradient-brand">故事</span>
          <br />
          一句话变成可剪辑的 <span className="text-gradient-brand">AI 短剧</span>。
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted">
          dramai 是一个跑在浏览器里的开源短剧工作台。文本、文档、参考图三样素材 +
          一句话提示词，调用你自己的 OpenAI 兼容服务商，从分镜脚本直到视频片段，
          全程不经任何中间服务器。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/projects">
            <Button size="lg" className="gap-2">
              新建项目
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link to="/settings">
            <Button size="lg" variant="outline">
              先去配置 API
            </Button>
          </Link>
          <a href="https://github.com/hyyyyyyz/dramai" target="_blank" rel="noreferrer noopener">
            <Button size="lg" variant="ghost">
              在 GitHub 上 Star
            </Button>
          </a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <CardHeader>
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent">
                <f.icon className="h-5 w-5" />
              </div>
              <CardTitle>{f.title}</CardTitle>
              <CardDescription>{f.desc}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <Badge variant="muted" className="self-start">
            Pipeline
          </Badge>
          <CardTitle className="text-lg">
            <Wand2 className="mr-2 inline h-4 w-4 text-accent" />
            从素材到成片，六个阶段
          </CardTitle>
          <CardDescription>
            每个阶段都可暂停、回滚、单独重跑。当前 v0.0.1 还是骨架，下面这些会在 v0.1～v0.4
            逐步落地。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-wrap gap-3 text-sm">
            {STAGES.map((stage, idx) => (
              <li
                key={stage}
                className="flex items-center gap-2 rounded-md border border-border bg-background-soft-2 px-3 py-1.5"
              >
                <span className="text-xs text-muted">{String(idx + 1).padStart(2, '0')}</span>
                <span>{stage}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </section>
  )
}
