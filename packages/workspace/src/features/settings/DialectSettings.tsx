import { useTranslation } from 'react-i18next'
import { Field, Hint, Select, Textarea } from '@dramai/ui/v2'
import {
  parseExtraBody,
  type DialectDraft,
  type JsonMode,
  type MaxTokensField,
} from './dialect-model'

/** Advanced settings of a text provider: how its API differs from OpenAI's. Collapsed by default. */
export function DialectSettings({
  draft,
  onChange,
}: {
  draft: DialectDraft
  onChange: (d: DialectDraft) => void
}) {
  const { t } = useTranslation()
  const parsed = parseExtraBody(draft.extraBody)
  return (
    <details className="group rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
        {t('providerDialect.title')}
      </summary>
      <div className="flex flex-col gap-4 border-t border-border p-3">
        <Hint>{t('providerDialect.intro')}</Hint>
        <Field
          label={t('providerDialect.extraBody.label')}
          hint={t('providerDialect.extraBody.hint')}
          error={parsed.ok ? undefined : t(`providerDialect.extraBody.${parsed.kind}`)}
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
        <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
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
          <Field
            label={t('providerDialect.jsonMode.label')}
            hint={t('providerDialect.jsonMode.hint')}
          >
            <Select
              value={draft.jsonMode}
              onChange={(e) => onChange({ ...draft, jsonMode: e.target.value as JsonMode | '' })}
            >
              <option value="">{t('providerDialect.jsonMode.auto')}</option>
              <option value="json_object">{t('providerDialect.jsonMode.json_object')}</option>
              <option value="prompt_only">{t('providerDialect.jsonMode.prompt_only')}</option>
            </Select>
          </Field>
        </div>
      </div>
    </details>
  )
}
