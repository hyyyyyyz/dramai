import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import { Button, iconProps, cn } from '@dramai/ui/v2'
import { actionOf, type IssueAction } from './issue-actions'
import { sortIssues, type TimelineIssue } from './timeline-model'

/** 读取时间线时发现的问题：阻断（红）/ 警告（黄）/ 提示（蓝），每条带直达处理的地方。颜色之外一定有图标和文字。 */
const ICON = { blocking: OctagonAlert, warning: AlertTriangle, info: Info } as const
const TONE = {
  blocking: 'bg-danger-soft [&_svg]:text-danger',
  warning: 'bg-warn-soft [&_svg]:text-warn',
  info: 'bg-info-soft [&_svg]:text-info',
} as const

export function IssueList({
  issues,
  describe,
  onAction,
  storyboardHref,
  disabledActions,
}: {
  issues: readonly TimelineIssue[]
  /** 本地化文案：标题和说明。 */
  describe: (i: TimelineIssue) => { title: string; body?: string }
  onAction: (a: IssueAction) => void
  storyboardHref: string
  disabledActions?: boolean
}) {
  const { t } = useTranslation()
  if (issues.length === 0)
    return <p className="p-4 text-sm text-muted-foreground">{t('compose.issues.none')}</p>
  return (
    <ul className="flex flex-col gap-2 p-4" aria-label={t('compose.issues.title')}>
      {sortIssues(issues).map((i, n) => {
        const Icon = ICON[i.severity]
        const a = actionOf(i)
        const d = describe(i)
        return (
          <li
            key={`${i.code}-${i.clipId ?? ''}-${n}`}
            data-severity={i.severity}
            className={cn(
              'grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-3 rounded-md px-3 py-3 text-sm',
              TONE[i.severity],
            )}
          >
            <Icon {...iconProps} aria-hidden className="mt-0.5" />
            <div className="min-w-0">
              <h3 className="font-sans text-base font-medium">
                <span className="sr-only">{t(`compose.issues.severity.${i.severity}`)}: </span>
                {d.title}
              </h3>
              {d.body && <p className="text-muted-foreground">{d.body}</p>}
            </div>
            {a &&
              (a.kind === 'storyboard' ? (
                <Link to={storyboardHref}>
                  <Button size="sm" variant="secondary" tabIndex={-1}>
                    {t('compose.issues.action.storyboard')}
                  </Button>
                </Link>
              ) : (
                <Button
                  size="sm"
                  variant={i.severity === 'blocking' ? 'secondary' : 'ghost'}
                  disabled={disabledActions}
                  onClick={() => onAction(a)}
                >
                  {t(`compose.issues.action.${a.kind}`)}
                </Button>
              ))}
          </li>
        )
      })}
    </ul>
  )
}
