import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { ProviderConfigDto } from '@dramai/api'
import { Button, Field, Hint, Input, SegmentedControl, Select, iconProps } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { PROTOCOLS_BY_KIND, protocolLabel, type ProtocolId, type ProviderKind } from './protocols'
import { PresetCatalog } from './PresetCatalog'

/** Add a provider: open the catalog (presets grouped by vendor, with search), or fill in a custom one. */
export function AddProvider({
  kind,
  onAdded,
}: {
  kind: ProviderKind
  onAdded: (p: ProviderConfigDto) => void
}) {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState(false)
  const [custom, setCustom] = useState(false)

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setCatalog(true)}>
        <Plus {...iconProps} aria-hidden />
        {t('providers.add.label')}
      </Button>
      {catalog && (
        <PresetCatalog
          kind={kind}
          onClose={() => setCatalog(false)}
          onCustom={() => {
            setCatalog(false)
            setCustom(true)
          }}
          onAdded={onAdded}
        />
      )}
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
  const [auth, setAuth] = useState<'api_key' | 'none'>('api_key')
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
          // saying it outright keeps "no key yet" and "needs no key" apart
          auth: { type: auth },
          ...(auth === 'api_key' && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
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
          <Input value={label} onChange={(e) => setLabel(e.target.value)} data-autofocus />
        </Field>
        <Field label={t('providers.form.protocol')}>
          <Select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as ProtocolId)}
            disabled={protocols.length < 2}
          >
            {protocols.map((p) => (
              <option key={p} value={p}>
                {protocolLabel(t, p)}
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
        <Field label={t('providerAuth.custom.auth')}>
          <SegmentedControl
            aria-label={t('providerAuth.custom.auth')}
            value={auth}
            onValueChange={setAuth}
            options={[
              { value: 'api_key', label: t('providerAuth.custom.apiKey') },
              { value: 'none', label: t('providerAuth.custom.none') },
            ]}
          />
        </Field>
        {auth === 'api_key' ? (
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
        ) : (
          <Hint>{t('providerAuth.custom.noneHint')}</Hint>
        )}
        {create.isError && <ErrorNotice error={create.error} />}
      </div>
    </Modal>
  )
}
