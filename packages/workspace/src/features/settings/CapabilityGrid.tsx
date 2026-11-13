import { useTranslation } from 'react-i18next'
import { Check, CircleHelp, Minus } from 'lucide-react'
import type { CallOutput } from '@dramai/api'
import { cn, iconProps } from '@dramai/ui/v2'
import { useFormat } from '@/i18n/format'

type View = CallOutput<'providers.capability'>
type Capability = View['capability']
type Support = 'supported' | 'unsupported' | 'unverified'

/** 一项能力的值：三态之一，永远带图标和文字（颜色不单独传递含义）。 */
export function CapabilityValue({
  support,
  children,
}: {
  support: Support
  children?: React.ReactNode
}) {
  const { t } = useTranslation()
  const Icon = support === 'supported' ? Check : support === 'unsupported' ? Minus : CircleHelp
  return (
    <span
      data-support={support}
      className={cn(
        'inline-flex items-center gap-1.5',
        support === 'supported' && 'text-foreground',
        support === 'unsupported' && 'text-muted-foreground',
        support === 'unverified' && 'text-subtle',
      )}
    >
      <Icon
        {...iconProps}
        size={14}
        aria-hidden
        className={cn(support === 'supported' && 'text-success')}
      />
      {children ?? t(`capability.state.${support}`)}
    </span>
  )
}

function Cap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  )
}

/** 模型能力：每一项三态——支持 / 不支持 / 未验证。未验证就老实写出来，不假装知道。 */
export function CapabilityGrid({ capability: c }: { capability: Capability }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  // A claim may carry the server's note (for example "the vendor says so; not verified"). It is shown under the value,
  // in the server's words, because it qualifies the value and the three states cannot say that.
  const claimText = (s: Support, value: string | undefined, note?: string) => (
    <>
      {s === 'supported' ? (
        <CapabilityValue support={s}>{value ?? t('capability.state.supported')}</CapabilityValue>
      ) : (
        <CapabilityValue support={s} />
      )}
      {note && <span className="block text-xs text-subtle">{note}</span>}
    </>
  )

  const rows: React.ReactNode[] = []
  const modes = Object.entries(c.modes)
  for (const [mode, s] of modes)
    rows.push(
      <Cap
        key={`mode-${mode}`}
        label={t(`capability.mode.${mode}` as 'capability.mode.t2i', { defaultValue: mode })}
      >
        <CapabilityValue support={s} />
      </Cap>,
    )

  if (c.media !== 'audio') {
    rows.push(
      <Cap key="refImages" label={t('capability.refImages')}>
        {claimText(
          c.refImages.support,
          c.refImages.value !== undefined
            ? t('capability.upTo', { n: c.refImages.value })
            : undefined,
          c.refImages.note,
        )}
      </Cap>,
    )
  }
  if (c.media === 'video') {
    rows.push(
      <Cap key="first" label={t('capability.firstFrame')}>
        <CapabilityValue support={c.firstFrame} />
      </Cap>,
      <Cap key="last" label={t('capability.lastFrame')}>
        <CapabilityValue support={c.lastFrame} />
      </Cap>,
      <Cap key="native" label={t('capability.nativeAudio')}>
        <CapabilityValue support={c.nativeAudio} />
      </Cap>,
    )
    const d = c.durations.value
    const durationText = d?.values?.length
      ? d.values.map((v) => t('capability.seconds', { n: v })).join(' · ')
      : d?.min !== undefined && d?.max !== undefined
        ? t('capability.secondsRange', { min: d.min, max: d.max })
        : undefined
    rows.push(
      <Cap key="dur" label={t('capability.durations')}>
        {claimText(c.durations.support, durationText, c.durations.note)}
      </Cap>,
    )
  }
  if (c.media !== 'audio') {
    rows.push(
      <Cap key="res" label={t('capability.resolutions')}>
        {claimText(
          c.resolutions.support,
          c.resolutions.value
            ?.map((v) => (v === 'none' ? t('capability.resolutionNone') : v))
            .join(' · '),
          c.resolutions.note,
        )}
      </Cap>,
      <Cap key="ar" label={t('capability.aspectRatios')}>
        {claimText(c.aspectRatios.support, c.aspectRatios.value?.join(' · '), c.aspectRatios.note)}
      </Cap>,
    )
  }
  // The lowest total number of pixels the model accepts (only shown when known). A smaller size is scaled up by
  // dramai before the request, so the user understands why an output can be larger than the size they chose.
  if (c.minPixels !== undefined) {
    rows.push(
      <Cap key="minPixels" label={t('capability.minPixels')}>
        <CapabilityValue support="supported">
          {t('capability.pixels', { n: fmt.number(c.minPixels) })}
        </CapabilityValue>
        <span className="block text-xs text-subtle">{t('capability.minPixelsHint')}</span>
      </Cap>,
    )
  }
  return <div className="grid grid-cols-2 gap-2 max-[640px]:grid-cols-1">{rows}</div>
}

/** 价格：批量确认里的预估费用用的就是这张表。查不到单价的写“未定价”，不猜。 */
export function PriceTable({ pricing }: { pricing: View['pricing'] }) {
  const { t } = useTranslation()
  const fmt = useFormat()
  if (pricing.length === 0)
    return <p className="text-sm text-muted-foreground">{t('capability.unpriced')}</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-subtle">
          <th className="pb-2 font-normal">{t('capability.priceMetric')}</th>
          <th className="pb-2 text-right font-normal">{t('capability.priceAmount')}</th>
        </tr>
      </thead>
      <tbody>
        {pricing.map((p, i) => {
          const dims = p.dimensions ? Object.values(p.dimensions).join(' · ') : ''
          const amount = p.range
            ? `${fmt.money(p.range[0], p.currency)} – ${fmt.money(p.range[1], p.currency)}`
            : fmt.money(p.amount, p.currency)
          return (
            <tr key={i} className="border-t border-border">
              <td className="py-2">
                {t(`capability.unit.${p.unit}`)}
                {dims && <span className="ml-2 text-muted-foreground">{dims}</span>}
                {p.note && <span className="block text-xs text-subtle">{p.note}</span>}
              </td>
              <td className="py-2 text-right font-mono tabular-nums">
                {p.range || p.amount ? amount : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
