import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { ProviderConfigDto } from '@dramai/api'
import { Button, Field, Input, Menu, Modal, Select, iconProps } from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useCall, usePresets } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { PROTOCOLS_BY_KIND, type ProtocolId, type ProviderKind } from './protocols'

/** 添加服务商：从预设挑一个（预设自带地址、型号和已知限制），或者自己填。 */
export function AddProvider({
  kind,
  onAdded,
}: {
  kind: ProviderKind
  onAdded: (p: ProviderConfigDto) => void
}) {
  const { t } = useTranslation()
  const presets = usePresets()
  const fromPreset = useCall('providers.fromPreset', { invalidate: [qk.providers] })
  const [custom, setCustom] = useState(false)
  const list = (presets.data?.items ?? []).filter((p) => p.kind === kind)

  return (
    <>
      <Menu
        placement="bottom-start"
        aria-label={t('providers.add.label')}
        trigger={
          <Button size="sm" variant="ghost" loading={fromPreset.isPending}>
            <Plus {...iconProps} aria-hidden />
            {t('providers.add.label')}
          </Button>
        }
        items={[
          ...list.map((p) => ({
            key: p.id,
            label: p.label,
            onSelect: () => fromPreset.mutate({ body: { presetId: p.id } }, { onSuccess: onAdded }),
          })),
          ...(list.length > 0 ? (['separator'] as const) : []),
          { key: 'custom', label: t('providers.add.custom'), onSelect: () => setCustom(true) },
        ]}
      />
      {fromPreset.isError && <ErrorNotice error={fromPreset.error} className="mt-2" />}
      {custom && (
        <CustomProviderDialog kind={kind} onClose={() => setCustom(false)} onAdded={onAdded} />
      )}
    </>
  )
}

function CustomProviderDialog({
  kind,
  onClose,
  onAdded,
}: {
  kind: ProviderKind
  onClose: () => void
  onAdded: (p: ProviderConfigDto) => void
}) {
  const { t } = useTranslation()
  const create = useCall('providers.create', { invalidate: [qk.providers] })
  const protocols = PROTOCOLS_BY_KIND[kind]
  const [label, setLabel] = useState('')
  const [protocol, setProtocol] = useState<ProtocolId>(protocols[0]!)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const valid = label.trim() && baseUrl.trim() && model.trim()
  const submit = async () => {
    if (!valid) return
    try {
      const p = await create.mutateAsync({
        body: {
          label: label.trim(),
          kind,
          protocol,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      })
      onClose()
      onAdded(p)
    } catch {
      /* 显示在对话框里 */
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t('providers.add.customTitle')}
      closeLabel={t('common.close')}
      dismissOnBackdrop={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!valid} loading={create.isPending} onClick={submit}>
            {t('providers.add.create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('providers.form.name')} required>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </Field>
        <Field label={t('providers.form.protocol')}>
          <Select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as ProtocolId)}
            disabled={protocols.length < 2}
          >
            {protocols.map((p) => (
              <option key={p} value={p}>
                {t(`protocol.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Base URL" required>
          <Input
            mono
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </Field>
        <Field label="Model" required>
          <Input mono value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label="API Key" hint={t('providers.key.hint')}>
          <Input
            mono
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>
        {create.isError && <ErrorNotice error={create.error} />}
      </div>
    </Modal>
  )
}
