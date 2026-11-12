import type { ReactNode } from 'react'

export function PageHead({
  title,
  sub,
  actions,
}: {
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 max-[800px]:mb-4">
      <div className="min-w-0">
        <h1 className="font-display text-title-lg font-bold">{title}</h1>
        {sub && <p className="mt-1 text-muted-foreground">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** 带标题行的面板（设计稿的 .block）。 */
export function Block({
  title,
  aside,
  children,
  className = '',
  ...rest
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
} & Omit<React.ComponentProps<'section'>, 'title'>) {
  return (
    <section className={`rounded-lg border border-border bg-surface ${className}`} {...rest}>
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <h2 className="font-display text-[15px] font-bold">{title}</h2>
        {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </section>
  )
}
