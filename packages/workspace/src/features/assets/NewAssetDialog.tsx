import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { AssetKind } from '@dramai/api'
import { Button, Field, Input, Modal, Select, Textarea } from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { ASSET_KINDS } from './asset-model'

/** 新建资产：类别、名字、外貌 / 描述。设定图之后在详情页里生成或上传。 */
export function NewAssetDialog({
  projectId,
  kind: initial,
  onClose,
}: {
  projectId: string
  kind: AssetKind
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const create = useCall('assets.create', { invalidate: [qk.assets(projectId), qk.preflight] })
  const [kind, setKind] = useState<AssetKind>(initial)
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const nameError = submitted && name.trim() === '' ? t('assets.new.nameRequired') : undefined
  const submit = async () => {
    setSubmitted(true)
    if (name.trim() === '') return
    try {
      const a = await create.mutateAsync({
        params: { projectId },
        body: {
          kind,
          name: name.trim(),
          ...(text.trim()
            ? kind === 'character'
              ? { appearance: text.trim() }
              : { description: text.trim() }
            : {}),
        },
      })
      onClose()
      void navigate(`/projects/${projectId}/assets/${a.id}`)
    } catch {
      /* 错误显示在对话框里（同名时按错误码提示） */
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('assets.new.title')}
      closeLabel={t('common.close')}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>
            {t('assets.new.submit')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label={t('assets.new.kind')}>
          <Select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`assetKindSingular.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('assets.new.name')} error={nameError} required>
          <Input value={name} autoFocus maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label={kind === 'character' ? t('assets.appearance') : t('assets.description')}
          hint={kind === 'character' ? t('assets.appearanceHint') : undefined}
        >
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {create.isError && <ErrorNotice error={create.error} />}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  )
}
