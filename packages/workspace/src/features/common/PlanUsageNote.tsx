import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { iconProps } from '@dramai/ui/v2'
import { useUsingChatGptPlan } from './use-using-chatgpt-plan'
import { MANAGE_USAGE_URL } from '@/features/settings/provider-model'

/**
 * "Using ChatGPT plan" with a "Manage usage" link, shown where the user starts something that will use the plan
 * (OpenAI's guidelines: near the composer or model selector). Renders nothing for any other provider.
 */
export function PlanUsageNote({ className }: { className?: string }) {
  const { t } = useTranslation()
  const using = useUsingChatGptPlan()
  if (!using) return null
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground ${className ?? ''}`}
    >
      <span>{t('planUsage.using')}</span>
      <a
        href={MANAGE_USAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-accent-text underline underline-offset-2"
      >
        {t('planUsage.manage')}
        <ExternalLink {...iconProps} size={12} aria-hidden />
      </a>
    </span>
  )
}
