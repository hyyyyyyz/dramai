import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Field, Textarea } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { BatchConfirmDialog } from '@/features/storyboard/BatchConfirmDialog'
import type { Asset } from '@dramai/api'

/**
 * 用一句话修改现有的设定图（不是重新生成）：先写指令，再过和普通生成一样的确认（准入、预估费用）。
 * 以当前图为唯一参考，新图成为当前版本，旧图留在版本历史；失败时什么都不改。
 */
export function EditSheetFlow({
  projectId,
  aspect,
  asset,
  variantName,
  thumb,
  onClose,
}: {
  projectId: string
  aspect: '9:16' | '16:9' | '1:1'
  asset: Asset
  variantName?: string
  thumb?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [instruction, setInstruction] = useState<string>()
  const name = variantName ? `${asset.name} / ${variantName}` : asset.name

  if (instruction !== undefined) {
    return (
      <BatchConfirmDialog
        projectId={projectId}
        aspect={aspect}
        kind="asset_sheet"
        candidates={[
          {
            shotId: variantName ? `${asset.id}/${variantName}` : asset.id,
            label: name,
            note: instruction,
            thumb,
            target: {
              kind: 'asset_sheet',
              assetId: asset.id,
              variantName,
              editInstruction: instruction,
            },
          },
        ]}
        assets={new Map([[asset.id, asset]])}
        onClose={onClose}
      />
    )
  }
  const ok = text.trim().length > 0
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={t('assets.edit.title', { name })}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!ok} onClick={() => setInstruction(text.trim())}>
            {t('assets.edit.next')}
          </Button>
        </>
      }
    >
      <Field label={t('assets.edit.label')} hint={t('assets.edit.hint')}>
        <Textarea
          data-autofocus
          rows={4}
          maxLength={1000}
          value={text}
          placeholder={t('assets.edit.placeholder')}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
    </Modal>
  )
}
