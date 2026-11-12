import { useTranslation } from 'react-i18next'
import type { TimelineView } from '@dramai/api'
import { Button, Pill } from '@dramai/ui/v2'
import { useFormat } from '@/i18n/format'
import { Block } from '@/features/common/PageHead'

/** 修订历史：只追加，不改写；回滚是把旧修订的内容追加成一个新修订。 */
export function RevisionList({
  view,
  onRollback,
  busy,
  cutRevision,
}: {
  view: TimelineView
  onRollback: (revision: number) => void
  busy?: boolean
  /** 现有成片是按哪一版渲染的（没有就不写）。 */
  cutRevision?: number
}) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const list = [...view.revisions].sort((a, b) => b.number - a.number)
  return (
    <Block title={t('compose.revisions.title')} aria-label={t('compose.revisions.title')}>
      <ul className="flex flex-col p-4">
        {list.map((r) => (
          <li
            key={r.number}
            className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-t border-border py-3 first:border-t-0 first:pt-0"
          >
            <span className="font-mono text-muted-foreground tabular-nums">{r.number}</span>
            <div className="min-w-0">
              <div className="truncate">{r.summary}</div>
              <small className="text-xs text-muted-foreground">
                {[
                  t(`compose.revisions.author.${r.author.kind}`),
                  fmt.ago(r.createdAt),
                  r.restoredFrom
                    ? t('compose.revisions.restoredFrom', { n: r.restoredFrom })
                    : undefined,
                  cutRevision === r.number ? t('compose.revisions.cutFrom') : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </div>
            {r.number === view.head ? (
              <Pill tone="accent">{t('compose.revisions.current')}</Pill>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={t('compose.revisions.rollbackLabel', { n: r.number })}
                onClick={() => onRollback(r.number)}
              >
                {t('compose.revisions.rollback')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t border-border p-4 text-xs text-subtle">
        {t('compose.revisions.hint')}
      </p>
    </Block>
  )
}
