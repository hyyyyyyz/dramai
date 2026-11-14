import { useTranslation } from 'react-i18next'
import { Field, Hint, Input, Notice, Select, Textarea } from '@dramai/ui/v2'
import { useProviderCapability, useProviders, useSettings } from '@/data/queries'
import { OTHER, type VoiceDraft } from './voice-draft'
import {
  INSTRUCTION_MAX,
  instructionWeight,
  isSiliconflow,
  speechInputSupport,
  voiceFit,
  voiceFormatProblem,
  voiceListKind,
  voicesOf,
} from '@/features/settings/voice-model'

/**
 * The narration voice of a project that is delivered by speech synthesis: which voice, an optional style instruction
 * and an optional language hint. What can be chosen depends on the model of the active speech provider:
 * a closed list (pick from it), an open list (the common ones, others can be typed) or no list (type it). A model with
 * no default voice needs one before anything can be generated, and the dialog says so now, not at generation time.
 */
export function VoiceSettings({
  draft,
  onChange,
}: {
  draft: VoiceDraft
  onChange: (d: VoiceDraft) => void
}) {
  const { t } = useTranslation()
  const settings = useSettings()
  const providers = useProviders()
  const provider = providers.data?.items.find((p) => p.id === settings.data?.activeProviders.tts)
  const cap = useProviderCapability(provider?.id ?? '', Boolean(provider))

  if (!provider) return <Notice tone="warn">{t('narrationVoice.noProvider')}</Notice>
  if (!cap.data) return null

  const capability = cap.data.capability
  const kind = voiceListKind(capability)
  const list = voicesOf(capability)
  const fallback = capability.defaultVoice
  const fit = voiceFit(capability, draft.voice.trim())
  const typed =
    kind === 'open' ? !list.some((v) => v.id === draft.voice) && draft.voice !== '' : false
  const picking = kind === 'closed' || (kind === 'open' && !typed && draft.voice !== OTHER)
  const support = speechInputSupport(provider.protocol, provider.model)
  const instructionOver =
    support.instructions && instructionWeight(draft.instructions) > INSTRUCTION_MAX
  const formatBad = voiceFormatProblem(provider.baseUrl, provider.model, draft.voice)
  const labelOf = (v: { id: string; label?: string; lang?: string }) =>
    [v.label ?? v.id, v.lang].filter(Boolean).join(' · ')

  const note = capability.voices?.note
  return (
    <div className="flex flex-col gap-3" data-testid="voice-settings">
      <p className="text-sm text-muted-foreground">
        {t('narrationVoice.for', { name: provider.label, model: provider.model })}
      </p>

      {kind === 'closed' && (
        <Field label={t('narrationVoice.label')} hint={t('narrationVoice.closedHint')}>
          <Select
            value={draft.voice}
            onChange={(e) => onChange({ ...draft, voice: e.target.value })}
          >
            <option value="">
              {fallback
                ? t('narrationVoice.useDefault', { voice: fallback })
                : t('narrationVoice.choose')}
            </option>
            {list.map((v) => (
              <option key={v.id} value={v.id}>
                {labelOf(v)}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {kind === 'open' && (
        <>
          <Field label={t('narrationVoice.label')} hint={t('narrationVoice.openHint')}>
            <Select
              value={picking ? draft.voice : OTHER}
              onChange={(e) =>
                onChange({ ...draft, voice: e.target.value === OTHER ? OTHER : e.target.value })
              }
            >
              <option value="">
                {fallback
                  ? t('narrationVoice.useDefault', { voice: fallback })
                  : t('narrationVoice.choose')}
              </option>
              {list.map((v) => (
                <option key={v.id} value={v.id}>
                  {labelOf(v)}
                </option>
              ))}
              <option value={OTHER}>{t('narrationVoice.typeOther')}</option>
            </Select>
          </Field>
          {!picking && (
            <Field
              label={t('narrationVoice.typed')}
              error={formatBad ? t('narrationVoice.formatBad') : undefined}
              hint={
                isSiliconflow(provider.baseUrl)
                  ? t('narrationVoice.siliconflowFormat', { model: provider.model })
                  : undefined
              }
            >
              <Input
                mono
                value={draft.voice === OTHER ? '' : draft.voice}
                onChange={(e) => onChange({ ...draft, voice: e.target.value })}
              />
            </Field>
          )}
        </>
      )}

      {kind === 'none' && (
        <Field
          label={t('narrationVoice.typed')}
          hint={
            isSiliconflow(provider.baseUrl)
              ? t('narrationVoice.siliconflowFormat', { model: provider.model })
              : capability.voices?.support === 'unsupported'
                ? t('narrationVoice.noneHint')
                : t('narrationVoice.unknownHint')
          }
          error={formatBad ? t('narrationVoice.formatBad') : undefined}
        >
          <Input
            mono
            value={draft.voice}
            placeholder={fallback ?? ''}
            onChange={(e) => onChange({ ...draft, voice: e.target.value })}
          />
        </Field>
      )}

      {kind !== 'none' && note && <Hint>{note}</Hint>}
      {kind !== 'none' && !note && <Hint>{t('narrationVoice.documented')}</Hint>}

      {draft.voice === '' && fallback && (
        <Hint>{t('narrationVoice.defaultIs', { voice: fallback })}</Hint>
      )}
      {draft.voice === '' && !fallback && (
        <Notice tone="warn">{t('narrationVoice.required', { model: provider.model })}</Notice>
      )}
      {fit === 'not_in_list' && (
        <Notice tone="danger">{t('narrationVoice.notInList', { model: provider.model })}</Notice>
      )}
      {fit === 'unlisted' && draft.voice !== OTHER && (
        <Notice tone="info">{t('narrationVoice.unlisted')}</Notice>
      )}

      <Field
        label={t('narrationVoice.instructions')}
        hint={support.instructions ? t('narrationVoice.instructionsHint') : undefined}
        error={
          instructionOver
            ? t('narrationVoice.instructionsTooLong', {
                max: INSTRUCTION_MAX,
                n: instructionWeight(draft.instructions),
              })
            : undefined
        }
      >
        <Textarea
          rows={2}
          value={draft.instructions}
          onChange={(e) => onChange({ ...draft, instructions: e.target.value })}
        />
      </Field>
      {draft.instructions.trim() !== '' && !support.instructions && (
        <Notice tone="info">
          {t('narrationVoice.ignoredInstructions', { model: provider.model })}
        </Notice>
      )}
      <Field
        label={t('narrationVoice.language')}
        hint={support.language ? t('narrationVoice.languageHint') : undefined}
      >
        <Input
          mono
          maxLength={20}
          placeholder="zh"
          value={draft.language}
          onChange={(e) => onChange({ ...draft, language: e.target.value })}
        />
      </Field>
      {draft.language.trim() !== '' && !support.language && (
        <Notice tone="info">
          {t('narrationVoice.ignoredLanguage', { model: provider.model })}
        </Notice>
      )}
    </div>
  )
}
