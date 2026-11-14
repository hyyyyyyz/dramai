import { useTranslation } from 'react-i18next'
import type { Project } from '@dramai/api'
import { Button, Field, Hint, Input, Notice, Select, Textarea } from '@dramai/ui/v2'
import { useProviderCapability, useProviders, useSettings } from '@/data/queries'
import { OTHER, type VoiceDraft } from './voice-draft'
import {
  NO_SPEECH_INPUTS,
  defaultVoiceState,
  instructionCount,
  isSiliconflow,
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
  live,
  draft,
  onChange,
}: {
  /** The project as it is now (the speed it holds is shown, and is kept as it is). */
  live: Project
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
  // whether the model has a default voice, as the server says: known, none, or not said (then nothing is concluded)
  const defaultState = defaultVoiceState(cap.data)
  const speed = live.narrationVoice?.speed
  const fit = voiceFit(capability, draft.voice.trim())
  const typed =
    kind === 'open' ? !list.some((v) => v.id === draft.voice) && draft.voice !== '' : false
  const picking = kind === 'closed' || (kind === 'open' && !typed && draft.voice !== OTHER)
  // what the model takes besides the voice, and the limit and way of counting of the style instruction, are the
  // server's to say (`speechInputs`); nothing here knows a protocol or a model name
  const inputs = cap.data.speechInputs ?? NO_SPEECH_INPUTS
  const count = instructionCount(inputs, draft.instructions)
  const formatBad = voiceFormatProblem(provider.baseUrl, provider.model, draft.voice)
  const labelOf = (v: { id: string; label?: string; lang?: string }) =>
    [v.label ?? v.id, v.lang].filter(Boolean).join(' · ')

  const note = capability.voices?.note
  const noVoiceLabel = fallback
    ? t('narrationVoice.useDefault', { voice: fallback })
    : defaultState === 'none'
      ? t('narrationVoice.choose')
      : t('narrationVoice.noChoice')
  // a voice stored in the project that this model's closed list does not have: shown as what it is, never as "default"
  const outside = kind === 'closed' && fit === 'not_in_list' ? draft.voice.trim() : undefined
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
            <option value="">{noVoiceLabel}</option>
            {outside && (
              <option value={outside}>{t('narrationVoice.outsideList', { voice: outside })}</option>
            )}
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
              <option value="">{noVoiceLabel}</option>
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
              : defaultState === 'none'
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
      {draft.voice === '' && !fallback && defaultState === 'none' && (
        <Notice tone="warn">{t('narrationVoice.required', { model: provider.model })}</Notice>
      )}
      {draft.voice === '' && !fallback && defaultState === 'unknown' && (
        <Hint>{t('narrationVoice.defaultUnknown', { model: provider.model })}</Hint>
      )}
      {fit === 'not_in_list' && (
        <Notice tone="warn" data-testid="voice-not-in-list">
          {t('narrationVoice.notInList', { model: provider.model, voice: draft.voice.trim() })}
        </Notice>
      )}
      {fit === 'unlisted' && draft.voice !== OTHER && (
        <Notice tone="info">{t('narrationVoice.unlisted')}</Notice>
      )}
      {kind === 'none' && draft.voice.trim() !== '' && (
        <Notice tone="info" data-testid="voice-unchecked">
          {t('narrationVoice.unchecked', { model: provider.model })}
        </Notice>
      )}

      <Field
        label={t('narrationVoice.instructions')}
        hint={
          inputs.instructions.supported ? (
            <>
              <span className="block">{t('narrationVoice.instructionsHint')}</span>
              {count ? (
                <span className="block" data-testid="instruction-count">
                  {t('narrationVoice.instructionCount', {
                    n: count.n,
                    max: count.max,
                    how: t(
                      `narrationVoice.counting.${count.counting}` as 'narrationVoice.counting.characters',
                    ),
                  })}
                </span>
              ) : inputs.instructions.maxLength !== undefined ? (
                <span className="block">
                  {t('narrationVoice.instructionMax', { max: inputs.instructions.maxLength })}
                </span>
              ) : null}
            </>
          ) : undefined
        }
      >
        <Textarea
          rows={2}
          value={draft.instructions}
          onChange={(e) => onChange({ ...draft, instructions: e.target.value })}
        />
      </Field>
      {count?.over && (
        <Notice tone="warn" data-testid="instruction-over">
          {t('narrationVoice.instructionsOver', { max: count.max, n: count.n })}
        </Notice>
      )}
      {draft.instructions.trim() !== '' && !inputs.instructions.supported && (
        <Notice tone="info">
          {t('narrationVoice.ignoredInstructions', { model: provider.model })}
        </Notice>
      )}
      <Field
        label={t('narrationVoice.language')}
        hint={inputs.language.supported ? t('narrationVoice.languageHint') : undefined}
      >
        <Input
          mono
          maxLength={20}
          placeholder="zh"
          value={draft.language}
          onChange={(e) => onChange({ ...draft, language: e.target.value })}
        />
      </Field>
      {draft.language.trim() !== '' && !inputs.language.supported && (
        <Notice tone="info">
          {t('narrationVoice.ignoredLanguage', { model: provider.model })}
        </Notice>
      )}
      {speed !== undefined && (
        <Hint data-testid="voice-speed">{t('narrationVoice.speedKept', { speed })}</Hint>
      )}
      {live.narrationVoice && (
        <div className="flex flex-col gap-2">
          {draft.clearAll ? (
            <Notice
              tone="warn"
              data-testid="voice-clear-all"
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange({ ...draft, clearAll: false })}
                >
                  {t('narrationVoice.clearAllUndo')}
                </Button>
              }
            >
              {t('narrationVoice.clearAllNote')}
            </Notice>
          ) : (
            <div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange({ ...draft, clearAll: true })}
              >
                {t('narrationVoice.clearAll')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
