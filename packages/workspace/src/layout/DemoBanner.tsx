import { useTranslation } from 'react-i18next'
import { FlaskConical } from 'lucide-react'
import { iconProps } from '@dramai/ui/v2'
import { useSystem } from '@/data/queries'

/**
 * 演示模式的持续提示（GET /api/system 的 demo.active）：服务商是本机的模拟服务，不产生费用，内容是占位。
 * 不能关掉：让人随时知道眼前的不是真实作品。文案用自己的翻译（服务端的 notice 只有中文，也偏长）；服务端的原文放在 title 里。
 */
export function DemoBanner() {
  const { t } = useTranslation()
  const system = useSystem()
  const demo = system.data?.demo
  if (!demo?.active) return null
  return (
    <div
      role="status"
      data-testid="demo-banner"
      title={demo.notice}
      className="flex flex-none items-center gap-2 border-b border-border bg-warn-soft px-4 py-2 text-sm text-foreground"
    >
      <FlaskConical {...iconProps} aria-hidden className="shrink-0 text-warn" />
      <span className="min-w-0">
        <b className="font-medium">{t('shell.demoTitle')}</b>
        <span className="ml-2 text-muted-foreground">{t('shell.demoNotice')}</span>
      </span>
    </div>
  )
}
