import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Field, Hint, IconButton, Input, Select, Textarea, iconProps } from '@dramai/ui/v2'
import {
  draftValid,
  headerProblems,
  parseExtraBody,
  type DialectDraft,
  type DialectSupport,
  type JsonMode,
  type MaxTokensField,
} from './dialect-model'

/**
 * Advanced settings of a text provider: how its API differs from OpenAI's. Collapsed by default, and only the options
 * the provider's protocol really reads are shown. It opens by itself while something in it is wrong, so the reason
 * the Save button is grey is never hidden inside a closed panel.
 */
export function DialectSettings({
  draft,
  support,
  onChange,
}: {
  draft: DialectDraft
  support: DialectSupport
  onChange: (d: DialectDraft) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const body = parseExtraBody(draft.extraBody)
  const rowProblems = headerProblems(draft.headers)
  const invalid = !draftValid(draft, support)
  const problemOf = (i: number) => rowProblems.find((p) => p.index === i)?.kind

  return (
    <details
      className="group rounded-md border border-border"
      open={open || invalid}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className="cursor-pointer px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring"
        // While something in the panel is wrong it stays open, so the reason cannot be hidden by a click.
        onClick={(e) => invalid && e.preventDefault()}
      >
        {t('providerDialect.title')}
      </summary>
      <div className="flex flex-col gap-4 border-t border-border p-3">
        <Hint>{t('providerDialect.intro')}</Hint>
        {!support.extraBody && <Hint>{t('providerDialect.onlyHeaders')}</Hint>}

        {support.extraBody && (
          <Field
            label={t('providerDialect.extraBody.label')}
            hint={
              <>
                {t('providerDialect.extraBody.hint')}{' '}
                {t(
                  support.protectedBody.length === 1
                    ? 'providerDialect.extraBody.protectedOne'
                    : 'providerDialect.extraBody.protectedMany',
                  { fields: support.protectedBody.join(t('providerDialect.listSeparator')) },
                )}
              </>
            }
            error={body.ok ? undefined : t(`providerDialect.extraBody.${body.kind}`)}
          >
            <Textarea
              mono
              rows={4}
              spellCheck={false}
              placeholder='{"enable_thinking": false}'
              value={draft.extraBody}
              onChange={(e) => onChange({ ...draft, extraBody: e.target.value })}
            />
          </Field>
        )}

        {(support.maxTokensField || support.jsonMode) && (
          <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
            {support.maxTokensField && (
              <Field
                label={t('providerDialect.maxTokensField.label')}
                hint={t('providerDialect.maxTokensField.hint')}
              >
                <Select
                  value={draft.maxTokensField}
                  onChange={(e) =>
                    onChange({ ...draft, maxTokensField: e.target.value as MaxTokensField | '' })
                  }
                >
                  <option value="">{t('providerDialect.maxTokensField.auto')}</option>
                  <option value="max_tokens">max_tokens</option>
                  <option value="max_completion_tokens">max_completion_tokens</option>
                </Select>
              </Field>
            )}
            {support.jsonMode && (
              <Field
                label={t('providerDialect.jsonMode.label')}
                hint={t('providerDialect.jsonMode.hint')}
              >
                <Select
                  value={draft.jsonMode}
                  onChange={(e) =>
                    onChange({ ...draft, jsonMode: e.target.value as JsonMode | '' })
                  }
                >
                  <option value="">{t('providerDialect.jsonMode.auto')}</option>
                  <option value="json_object">{t('providerDialect.jsonMode.json_object')}</option>
                  <option value="prompt_only">{t('providerDialect.jsonMode.prompt_only')}</option>
                </Select>
              </Field>
            )}
          </div>
        )}

        {support.extraHeaders && (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium">{t('providerDialect.headers.label')}</div>
            <Hint>{t('providerDialect.headers.hint')}</Hint>
            {draft.headers.map((h, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <Field
                  label={t('providerDialect.headers.name')}
                  error={
                    problemOf(i) === 'name' ||
                    problemOf(i) === 'protected' ||
                    problemOf(i) === 'duplicate'
                      ? t(
                          `providerDialect.headers.${problemOf(i) === 'name' ? 'invalid' : (problemOf(i) as 'protected')}`,
                        )
                      : undefined
                  }
                  className="min-w-40 flex-1"
                >
                  <Input
                    mono
                    value={h.name}
                    onChange={(e) =>
                      onChange({
                        ...draft,
                        headers: draft.headers.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </Field>
                <Field
                  label={t('providerDialect.headers.value')}
                  error={
                    problemOf(i) === 'value' || problemOf(i) === 'empty'
                      ? t(
                          `providerDialect.headers.${problemOf(i) === 'value' ? 'valueNewline' : 'empty'}`,
                        )
                      : undefined
                  }
                  className="min-w-40 flex-1"
                >
                  <Input
                    mono
                    value={h.value}
                    onChange={(e) =>
                      onChange({
                        ...draft,
                        headers: draft.headers.map((x, j) =>
                          j === i ? { ...x, value: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </Field>
                <IconButton
                  className="mt-6"
                  label={t('providerDialect.headers.remove', { name: h.name || String(i + 1) })}
                  onClick={() =>
                    onChange({ ...draft, headers: draft.headers.filter((_, j) => j !== i) })
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
                  onChange({ ...draft, headers: [...draft.headers, { name: '', value: '' }] })
                }
              >
                <Plus {...iconProps} aria-hidden />
                {t('providerDialect.headers.add')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </details>
  )
}
