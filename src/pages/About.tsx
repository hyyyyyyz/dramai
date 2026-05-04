import { Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GithubIcon } from '@/components/icons/GithubIcon'

export function AboutPage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">关于 dramai</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          dramai 是一个 100% 跑在浏览器里的开源 AI 短剧工作台。 它把"上传素材 → 生成分镜 → 文生图 →
          图生视频 → 剪映导出"的流程串起来， 所有数据存在你自己的浏览器里，所有 AI
          调用直接打到你自己配置的 OpenAI 兼容服务商。零后端，可以直接 fork 后部署到 GitHub Pages。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>致谢</CardTitle>
          <CardDescription>架构与产品形态借鉴自这两个开源项目：</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            <li>
              <a
                href="https://github.com/xhongc/ai_story"
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-accent hover:underline"
              >
                xhongc/ai_story
              </a>
              <p className="text-sm text-muted">Pipeline 责任链与 AI 客户端抽象层的设计思路。</p>
            </li>
            <li>
              <a
                href="https://github.com/freestylefly/director_ai"
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-accent hover:underline"
              >
                freestylefly/director_ai
              </a>
              <p className="text-sm text-muted">人物一致性"三视图"方案、视频生成完整流程文档。</p>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-accent" />
            参与共建
          </CardTitle>
          <CardDescription>
            所有 issue / PR / 文档贡献都欢迎。Apache-2.0 许可证，商用友好。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a href="https://github.com/hyyyyyyz/dramai" target="_blank" rel="noreferrer noopener">
            <Button variant="outline" className="gap-2">
              <GithubIcon className="h-4 w-4" /> 在 GitHub 上看看
            </Button>
          </a>
        </CardContent>
      </Card>
    </section>
  )
}
