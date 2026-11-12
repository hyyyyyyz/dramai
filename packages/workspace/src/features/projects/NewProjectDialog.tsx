import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { AspectRatio } from '@dramai/api'
import { Button, Field, Input, Label, Hint } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { useCall } from '@/data/queries'
import { qk } from '@/data/keys'
import { ErrorNotice } from '@/features/common/error-text'
import { AspectRatioPicker, NarrationPicker, StylePicker, type NarrationValue } from './pickers'
import { toStyleChoice, type StylePick } from './style-choice'

/** 新建项目：标题、画幅、旁白怎么出声、风格（创建时展开成快照）。 */
export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [aspect, setAspect] = useState<AspectRatio>('9:16')
  const [narration, setNarration] = useState<NarrationValue>('tts')
  const [style, setStyle] = useState<StylePick>({ custom: '' })
  // 校验错误只在用户尝试提交之后才出现：对话框刚打开时不能就是一片红
  const [submitted, setSubmitted] = useState(false)
  const create = useCall('projects.create', { invalidate: [qk.projects] })

  const nameError = submitted && name.trim() === '' ? t('projects.new.nameRequired') : undefined
  const submit = async () => {
    setSubmitted(true)
    if (name.trim() === '') return
    try {
      const project = await create.mutateAsync({
        body: {
          name: name.trim(),
          aspectRatio: aspect,
          narrationDelivery: narration,
          style: toStyleChoice(style),
        },
      })
      onClose()
      void navigate(`/projects/${project.id}`)
    } catch {
      /* 错误显示在对话框里 */
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('projects.new.title')}
      closeLabel={t('common.close')}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>
            {t('projects.new.submit')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label={t('projects.new.name')} error={nameError} required>
          <Input
            value={name}
            data-autofocus
            placeholder={t('projects.new.namePlaceholder')}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <Label>{t('projects.new.aspect')}</Label>
          <AspectRatioPicker value={aspect} onChange={setAspect} label={t('projects.new.aspect')} />
          <Hint>{t('projects.new.aspectHint')}</Hint>
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
        <div className="flex flex-col gap-2">
          <Label>{t('projects.new.style')}</Label>
          <StylePicker value={style} onChange={setStyle} />
        </div>
        {create.isError && <ErrorNotice error={create.error} />}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
