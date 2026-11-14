import { useTranslation } from 'react-i18next'
import { useFormat } from '@/i18n/format'
import { costHeadline, hasRange, type Totals } from './cost'

export function CostBox({ totals }: { totals: Totals }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const headline = costHeadline(totals, fmt.money)
  const extra = totals.converted ? Object.entries(totals.remaining) : []
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-border bg-background p-4">
      <div>
        <div className="text-xs text-muted-foreground">{t('storyboard.batch.cost')}</div>
        <div
          className="font-display text-title-lg font-bold tabular-nums"
          data-testid="cost-headline"
        >
          {headline ?? t('storyboard.batch.costUnknown')}
        </div>
        {extra.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {t('storyboard.batch.costOther', {
              list: extra.map(([cur, v]) => fmt.money(v.amount, cur)).join(' + '),
            })}
          </div>
        )}
      </div>
      <div className="max-w-xs text-xs text-muted-foreground">
        {totals.unpriced > 0 && <p>{t('storyboard.batch.unpriced', { count: totals.unpriced })}</p>}
        {hasRange(totals) && <p data-testid="cost-range-note">{t('storyboard.batch.costRange')}</p>}
        <p>{t('storyboard.batch.costNote')}</p>
      </div>
    </div>
  )
}
