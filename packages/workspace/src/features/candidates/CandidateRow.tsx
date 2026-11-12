import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, ChevronDown, MapPin, Shirt, User } from 'lucide-react'
import type { Asset, Candidate } from '@dramai/api'
import { Button, Checkbox, Menu, Notice, Pill, iconProps, iconPropsSm } from '@dramai/ui/v2'
import type { ShotInfo } from '@/features/common/use-shot-index'
import { firstShot, linkable, suggestionOf } from './candidate-model'

const KIND_ICON = { character: User, location: MapPin, prop: Box, costume: Shirt } as const
const BAND_TONE = { high: 'success', medium: 'warn', low: 'neutral' } as const

export interface CandidateRowProps {
  candidate: Candidate
  assets: readonly Asset[]
  assetsById: ReadonlyMap<string, Asset>
  shotInfos: readonly ShotInfo[]
  busy?: boolean
  onAccept: (variants: string[]) => void
  onLink: (assetId: string, variants: string[]) => void
  onIgnore: () => void
}

/** 候选一行：名称、类别、置信度（高 / 中 / 低）、首次出现、证据原文、关联建议，以及三个动作。 */
export function CandidateRow({
  candidate: c,
  assets,
  assetsById,
  shotInfos,
  busy,
  onAccept,
  onLink,
  onIgnore,
}: CandidateRowProps) {
  const { t } = useTranslation()
  const Icon = KIND_ICON[c.kind]
  const suggestion = suggestionOf(c, assetsById)
  const [variants, setVariants] = useState<Set<string>>(
    () => new Set(c.variants.map((v) => v.variantKey)),
  )
  const picked = [...variants]
  const first = firstShot(shotInfos)
  const MAX_WHERE = 6
  const sorted = [...shotInfos].sort(
    (a, b) => a.episodeNumber - b.episodeNumber || a.index - b.index,
  )
  const where = sorted
    .slice(0, MAX_WHERE)
    .map((s) =>
      t('candidates.shotRef', { ep: s.episodeNumber, n: String(s.index).padStart(2, '0') }),
    )
  const kindName = t(`assetKindSingular.${c.kind}`)
  const candidatesToLink = linkable(c, assets)

  const accept = (
    <Button
      size="sm"
      variant={suggestion ? 'secondary' : 'primary'}
      disabled={busy}
      onClick={() => onAccept(picked)}
    >
      {suggestion ? t('candidates.acceptAnother', { kind: kindName }) : t('candidates.accept')}
    </Button>
  )
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-t border-border p-4 first:border-t-0 max-[800px]:grid-cols-1"
      data-testid={`candidate-${c.name}`}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="flex flex-wrap items-center gap-2 font-sans text-base font-medium">
          <Icon {...iconProps} aria-hidden className="text-muted-foreground" />
          {c.name}
          <Pill tone={BAND_TONE[c.confidenceBand]} hollow={c.confidenceBand === 'low'}>
            {t(`candidates.band.${c.confidenceBand}`)}
          </Pill>
        </h3>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            {first
              ? t('candidates.firstSeen', {
                  ep: first.episodeNumber,
                  n: String(first.index).padStart(2, '0'),
                })
              : t('candidates.notInShots')}
          </span>
          <span>
            {where.length > 0
              ? t('candidates.seenIn', { list: where.join(t('candidates.listSep')) }) +
                (shotInfos.length > MAX_WHERE
                  ? t('candidates.seenMore', { count: shotInfos.length })
                  : '')
              : t('candidates.seenNowhere')}
          </span>
        </div>
        {c.aliases.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('candidates.aliases', { list: c.aliases.join(t('candidates.listSep')) })}
          </p>
        )}
        {c.evidence && (
          <blockquote className="border-l-2 border-border-strong pl-3 text-sm text-muted-foreground">
            {c.evidence}
          </blockquote>
        )}

        {suggestion && (
          <Notice tone="info">
            {t('candidates.match', { kind: kindName, name: suggestion.asset.name })}{' '}
            <span className="text-muted-foreground">
              {t(`candidates.basis.${suggestion.basis[0]?.type ?? 'llm'}`)}
            </span>
          </Notice>
        )}

        {c.variants.length > 0 && (
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1 text-xs text-subtle">{t('candidates.variantsLegend')}</legend>
            {c.variants.map((v) => (
              <Checkbox
                key={v.variantKey}
                checked={variants.has(v.variantKey)}
                onChange={(e) =>
                  setVariants((cur) => {
                    const next = new Set(cur)
                    if (e.target.checked) next.add(v.variantKey)
                    else next.delete(v.variantKey)
                    return next
                  })
                }
                label={
                  <span>
                    {v.variantKey}
                    <span className="text-muted-foreground"> · {v.description}</span>
                  </span>
                }
              />
            ))}
            <p className="text-xs text-subtle">{t('candidates.variantsHint')}</p>
          </fieldset>
        )}
        <p className="text-xs text-subtle">
          {c.shotIds.length > 0
            ? t('candidates.acceptHintUsed', { kind: kindName })
            : t('candidates.hintUnused')}
        </p>
      </div>

      <div className="flex flex-wrap items-start justify-end gap-2 max-[800px]:justify-start">
        {suggestion ? (
          <>
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => onLink(suggestion.asset.id, picked)}
            >
              {t('candidates.linkTo', { name: suggestion.asset.name })}
            </Button>
            {accept}
          </>
        ) : (
          <>
            {accept}
            <Menu
              aria-label={t('candidates.linkMenu', { name: c.name })}
              trigger={
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || candidatesToLink.length === 0}
                >
                  {t('candidates.linkExisting')}
                  <ChevronDown {...iconPropsSm} aria-hidden />
                </Button>
              }
              items={candidatesToLink.map((a) => ({
                key: a.id,
                label: a.name,
                onSelect: () => onLink(a.id, picked),
              }))}
            />
          </>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onIgnore}>
          {t('candidates.ignore')}
        </Button>
      </div>
    </li>
  )
}
