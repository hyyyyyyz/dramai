import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AspectRatio, Project } from '@dramai/api'
import { Button, Field, Hint, Input, Label, Notice } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall, useProviderCapability, useProviders, useSettings } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import {
  AspectRatioPicker,
  NarrationPicker,
  type NarrationValue,
} from '@/features/projects/pickers'
import { speechDefaultOf } from '@/features/settings/voice-model'
import { VoiceSettings } from './VoiceSettings'
import { draftOfVoice, voiceOutcome, type VoiceDraft } from './voice-draft'

/** 项目设置：标题、画幅、旁白交付。风格在“素材”页里改。 */
export function ProjectSettingsDialog({
  project,
  onClose,
}: {
  project: Project
  onClose: () => void
}) {
  const { t } = useTranslation()
  // The project as it was when the dialog opened. What the user changed is whatever differs from this, never from the
  // project as it is now: if something was changed elsewhere while the dialog was open, a field the user did not touch
  // must not be written back with the old value.
  const [base] = useState(project)
  const [name, setName] = useState(base.name)
  const [aspect, setAspect] = useState<AspectRatio>(base.aspectRatio)
  const [narration, setNarration] = useState<NarrationValue>(base.narrationDelivery)
  const [voice, setVoice] = useState<VoiceDraft>(() => draftOfVoice(base.narrationVoice))
  const settings = useSettings()
  const providers = useProviders()
  const ttsProvider = providers.data?.items.find((p) => p.id === settings.data?.activeProviders.tts)
  const ttsCap = useProviderCapability(ttsProvider?.id ?? '', Boolean(ttsProvider))
  const update = useCall('projects.update', { invalidate: [qk.projects, qk.project(project.id)] })
  const changedName = name.trim() !== base.name
  const changedAspect = aspect !== base.aspectRatio
  const changedNarration = narration !== base.narrationDelivery
  const dflt = speechDefaultOf(ttsCap.data ?? {})
  const voiceOut =
    narration === 'tts' && ttsProvider && ttsCap.data
      ? voiceOutcome(base, project, voice, {
          providerConfigId: ttsProvider.id,
          defaultVoice: dflt.state === 'known' ? dflt.voice : undefined,
        })
      : ({ kind: 'none' } as const)
  // the title is the only thing that can make the form invalid
  const valid = name.trim() !== ''
  const save = async () => {
    if (!valid) return
    const body = {
      ...(changedName ? { name: name.trim() } : {}),
      ...(changedAspect ? { aspectRatio: aspect } : {}),
      ...(changedNarration ? { narrationDelivery: narration } : {}),
      ...(voiceOut.kind === 'set' ? { narrationVoice: voiceOut.body } : {}),
      ...(voiceOut.kind === 'clear' ? { narrationVoice: null } : {}),
    }
    if (Object.keys(body).length === 0) return onClose()
    try {
      await update.mutateAsync({ params: { projectId: project.id }, body })
      onClose()
    } catch {
      /* 显示在对话框里 */
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('overview.settings.title')}
      closeLabel={t('common.close')}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!valid} loading={update.isPending} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Field
          label={t('projects.new.name')}
          error={valid ? undefined : t('projects.new.nameRequired')}
          required
        >
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2">
          <Label>{t('projects.new.aspect')}</Label>
          <AspectRatioPicker value={aspect} onChange={setAspect} label={t('projects.new.aspect')} />
          <Hint>{t('projects.new.aspectHint')}</Hint>
          {changedAspect && <Notice tone="warn">{t('overview.settings.aspectChangeWarn')}</Notice>}
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t('projects.new.narration')}</Label>
          <NarrationPicker
            value={narration}
            onChange={setNarration}
            label={t('projects.new.narration')}
          />
          <Hint>{t('projects.new.narrationHint')}</Hint>
        </div>
        {narration === 'tts' && (
          <div className="flex flex-col gap-2">
            <Label>{t('narrationVoice.title')}</Label>
            <VoiceSettings live={project} draft={voice} onChange={setVoice} />
            {voiceOut.kind === 'blocked' && (
              <Notice tone="warn" data-testid="voice-not-saved">
                {t('narrationVoice.notSaved')}
              </Notice>
            )}
            {voiceOut.kind === 'set' && voiceOut.pinnedDefault && (
              <Notice tone="info" data-testid="voice-pinned">
                {t('narrationVoice.pinned', { voice: voiceOut.pinnedDefault })}
              </Notice>
            )}
          </div>
        )}
        {update.isError && <ErrorNotice error={update.error} />}
      </div>
    </Modal>
  )
}
