import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-4 py-24 sm:px-6">
      <span className="text-6xl font-bold text-gradient-brand">404</span>
      <h1 className="text-2xl font-semibold">这一幕没拍出来</h1>
      <p className="text-muted">你访问的页面不存在，或者它还在 v0.1 之后的剧本里。</p>
      <Link to="/">
        <Button>回到首页</Button>
      </Link>
    </section>
  )
}
