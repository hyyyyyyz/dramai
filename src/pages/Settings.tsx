import { KeyRound, Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function SettingsPage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-muted">
          所有设置都只保存在你的浏览器里。dramai 不会把任何信息发到我们的服务器
          ——因为根本没有服务器。
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4 text-accent" />
              OpenAI 兼容服务商
            </CardTitle>
            <Badge variant="warn">v0.1 接入中</Badge>
          </div>
          <CardDescription>
            支持任何兼容 OpenAI Chat / Images 协议的 endpoint：OpenAI、OpenRouter、
            302.AI、词元、火山豆包、智谱等。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-muted">
            <li>· LLM Base URL + API Key + Model 名称</li>
            <li>· 文生图、图生视频独立配置</li>
            <li>· 一键测试连接，并展示真实模型列表</li>
            <li>· 多服务商配置可保存切换</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            数据与隐私
          </CardTitle>
          <CardDescription>
            v0.1 起：API Key 默认存 localStorage，项目数据存 IndexedDB； 可一键导出/导入 JSON
            备份；可一键清空全部本地数据。
          </CardDescription>
        </CardHeader>
      </Card>
    </section>
  )
}
