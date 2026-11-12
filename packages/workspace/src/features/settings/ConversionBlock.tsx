import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import type { AppSettings } from '@dramai/api'
import { Button, Field, Hint, IconButton, Input, Switch, iconProps } from '@dramai/ui/v2'
import { Block } from '@/features/common/PageHead'
import {
  conversionOf,
  draftOf,
  draftProblem,
  sameConversion,
  type ConversionDraft,
} from './conversion-model'

/** 费用折算：只用于把几种币种的预估合成一个数字，永远是估算，不是账单。默认不折算。 */
export function ConversionBlock({
  conversion,
  saving,
  onSave,
}: {
  conversion: AppSettings['cost']['conversion']
  saving?: boolean
  onSave: (c: AppSettings['cost']['conversion']) => void
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ConversionDraft>(() => draftOf(conversion))
  const problem = draftProblem(draft)
  const next = conversionOf(draft)
  const dirty = draft.enabled ? !sameConversion(next, conversion) : conversion !== undefined

  return (
    <Block title={t('settings.general.cost.title')} aria-label={t('settings.general.cost.title')}>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">{t('settings.general.cost.enable')}</div>
            <Hint>{t('settings.general.cost.hint')}</Hint>
          </div>
          <Switch
            aria-label={t('settings.general.cost.enable')}
            checked={draft.enabled}
            onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          />
        </div>
        {draft.enabled && (
          <>
            <Field
              label={t('settings.general.cost.target')}
              error={problem?.kind === 'target' ? t('settings.general.cost.targetBad') : undefined}
              className="max-w-48"
            >
              <Input
                mono
                value={draft.target}
                onChange={(e) => setDraft({ ...draft, target: e.target.value })}
              />
            </Field>
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">{t('settings.general.cost.rates')}</div>
              {draft.rows.map((r, i) => (
                <div key={i} className="flex flex-wrap items-start gap-2">
                  <Field
                    label={t('settings.general.cost.currency')}
                    error={
                      problem?.row === i &&
                      (problem.kind === 'currency' || problem.kind === 'duplicate')
                        ? t(
                            problem.kind === 'currency'
                              ? 'settings.general.cost.currencyBad'
                              : 'settings.general.cost.currencyDup',
                          )
                        : undefined
                    }
                    className="w-32"
                  >
                    <Input
                      mono
                      value={r.currency}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          rows: draft.rows.map((x, j) =>
                            j === i ? { ...x, currency: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field
                    label={t('settings.general.cost.rate', {
                      target: draft.target.trim().toUpperCase() || '—',
                    })}
                    error={
                      problem?.row === i && problem.kind === 'rate'
                        ? t('settings.general.cost.rateBad')
                        : undefined
                    }
                    className="w-48"
                  >
                    <Input
                      mono
                      inputMode="decimal"
                      value={r.rate}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          rows: draft.rows.map((x, j) =>
                            j === i ? { ...x, rate: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </Field>
                  <IconButton
                    className="mt-6"
                    label={t('settings.general.cost.removeRow', {
                      currency: r.currency || String(i + 1),
                    })}
                    onClick={() =>
                      setDraft({ ...draft, rows: draft.rows.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 {...iconProps} aria-hidden />
                  </IconButton>
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setDraft({ ...draft, rows: [...draft.rows, { currency: '', rate: '' }] })
                  }
                >
                  <Plus {...iconProps} aria-hidden />
                  {t('settings.general.cost.addRow')}
                </Button>
              </div>
              <Hint>{t('settings.general.cost.unset')}</Hint>
            </div>
          </>
        )}
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            disabled={!dirty || Boolean(problem)}
            loading={saving}
            onClick={() => onSave(draft.enabled ? next : undefined)}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Block>
  )
}
