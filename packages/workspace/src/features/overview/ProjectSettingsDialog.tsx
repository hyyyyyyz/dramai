import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AspectRatio, Project } from '@dramai/api'
import { Button, Field, Hint, Input, Label, Notice } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import {
  AspectRatioPicker,
  NarrationPicker,
  type NarrationValue,
} from '@/features/projects/pickers'

/** 项目设置：标题、画幅、旁白交付。风格在“素材”页里改。 */
export function ProjectSettingsDialog({
  project,
  onClose,
}: {
  project: Project
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(project.name)
  const [aspect, setAspect] = useState<AspectRatio>(project.aspectRatio)
  const [narration, setNarration] = useState<NarrationValue>(project.narrationDelivery)
  const update = useCall('projects.update', { invalidate: [qk.projects, qk.project(project.id)] })
  const changedAspect = aspect !== project.aspectRatio
  const valid = name.trim() !== ''
  const save = async () => {
    if (!valid) return
    try {
      await update.mutateAsync({
        params: { projectId: project.id },
        body: {
          name: name.trim(),
          ...(changedAspect ? { aspectRatio: aspect } : {}),
          ...(narration !== project.narrationDelivery ? { narrationDelivery: narration } : {}),
        },
      })
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
        {update.isError && <ErrorNotice error={update.error} />}
      </div>
    </Modal>
  )
}
