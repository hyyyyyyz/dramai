export function AppFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <span>dramai · Apache-2.0 · 浏览器内的 AI 短剧工作台 · 数据本地优先</span>
        <span className="opacity-70">
          构建于 React 19 + Vite 8 · 部署于{' '}
          <code className="rounded bg-background-soft px-1.5 py-0.5 text-[11px]">
            github.io/dramai
          </code>
        </span>
      </div>
    </footer>
  )
}
