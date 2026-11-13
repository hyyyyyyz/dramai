import { useTranslation } from 'react-i18next'
import { Check, CircleHelp, X } from 'lucide-react'
import type { CallOutput } from '@dramai/api'
import { iconProps, cn } from '@dramai/ui/v2'
import { ProviderErrorNotice } from '@/features/jobs/ProviderErrorNotice'

type Result = CallOutput<'providers.test'>

/**
 * “测试连接”的三种结果：
 * - ok：连上了（可能还带模型数；没在列表里找到所选模型要提醒）；
 * - failed：失败，附状态码；有错误码时给出和任务失败时相同的解释与下一步；
 * - unverifiable：这个协议没有标准的列表接口，无法自动验证——这不是失败，要如实说。
 * 服务端给的 error / reason 是原文，只作为可展开的技术细节，主文案走翻译。
 */
export function TestResult({ result }: { result: Result }) {
  const { t } = useTranslation()
  const base = 'flex min-w-0 flex-col gap-1 text-sm'
  if (result.outcome === 'ok') {
    return (
      <div role="status" className={cn(base, 'text-success')}>
        <span className="inline-flex items-center gap-1.5">
          <Check {...iconProps} aria-hidden />
          {t('providers.test.ok')}
          {result.modelCount !== undefined && (
            <span className="text-muted-foreground">
              · {t('providers.test.modelCount', { count: result.modelCount })}
            </span>
          )}
        </span>
        {result.modelListed === false && (
          <span className="text-warn">{t('providers.test.modelNotListed')}</span>
        )}
      </div>
    )
  }
  if (result.outcome === 'failed') {
    return (
      <div role="alert" className={cn(base, 'text-danger')}>
        <span className="inline-flex items-center gap-1.5">
          <X {...iconProps} aria-hidden />
          {t('providers.test.failed')}
          {result.status !== undefined && (
            <span className="font-mono text-xs">HTTP {result.status}</span>
          )}
        </span>
        <ProviderErrorNotice code={result.code} where="settings" />
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('providers.test.details')}</summary>
          <code className="mt-1 block font-mono break-words">{result.error}</code>
        </details>
      </div>
    )
  }
  return (
    <div role="status" className={cn(base, 'text-muted-foreground')}>
      <span className="inline-flex items-center gap-1.5">
        <CircleHelp {...iconProps} aria-hidden />
        {t('providers.test.unverifiable')}
      </span>
      <details className="text-xs">
        <summary className="cursor-pointer">{t('providers.test.details')}</summary>
        <code className="mt-1 block font-mono break-words">{result.reason}</code>
      </details>
    </div>
  )
}
