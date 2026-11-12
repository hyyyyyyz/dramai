import { useTranslation } from 'react-i18next'
import { LockKeyhole, ServerOff, ShieldAlert } from 'lucide-react'
import { Button, EmptyState, iconPropsLg, Wordmark } from '@dramai/ui/v2'
import type { BlockingKind } from '@/data/errors'

const ICON = { unauthorized: LockKeyhole, host: ShieldAlert, unreachable: ServerOff } as const

/** 整屏提示：连不上服务、需要访问令牌、Host 不被允许。这三种情况下别的页面都没有意义。 */
export function BlockingScreen({ kind, onRetry }: { kind: BlockingKind; onRetry: () => void }) {
  const { t } = useTranslation()
  const Icon = ICON[kind]
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <Wordmark className="h-7 w-auto" />
        <EmptyState
          className="w-full bg-surface"
          icon={<Icon {...iconPropsLg} aria-hidden />}
          title={t(`blocking.${kind}.title`)}
          description={t(`blocking.${kind}.body`)}
          action={<Button onClick={onRetry}>{t('common.retry')}</Button>}
        />
      </div>
    </div>
  )
}
