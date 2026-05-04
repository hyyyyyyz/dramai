import { Users } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function CharactersPage() {
  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">角色卡</h1>
        <p className="mt-1 text-sm text-muted">
          为这个项目里的角色绑定参考图，让多镜头里的形象保持一致。
        </p>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/15 text-accent">
            <Users className="h-5 w-5" />
          </div>
          <CardTitle>v0.2 会落地</CardTitle>
          <CardDescription>
            届时会包含：角色 CRUD、参考图上传（IndexedDB Blob）、随机/锁定开关、 在分镜里 @角色
            的语义匹配。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted">
            技术参考：director_ai 提到的"三视图"思路（正面 / 侧面 / 背面）， dramai 计划用单图 +
            关键词扩展实现等价效果。
          </p>
        </CardContent>
      </Card>
    </section>
  )
}
