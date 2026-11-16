import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { ProviderConfigDto } from '@dramai/api'
import { Button, Field, Hint, Input, SegmentedControl, Select, iconProps } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall, usePresets } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { addressSendable, baseUrlCodeOf, useBaseUrlMessage } from './base-url'
import type { LoginChannel } from './login-channels'
import { PROTOCOLS_BY_KIND, protocolLabel, type ProtocolId, type ProviderKind } from './protocols'

/** Add a provider: one form, opened straight from the button. No catalog, no suggestions. */
export function AddProvider({
  kind,
  onAdded,
}: {
  kind: ProviderKind
  onAdded: (p: ProviderConfigDto) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Plus {...iconProps} aria-hidden />
        {t('providers.add.label')}
      </Button>
      {open && <AddProviderForm kind={kind} onClose={() => setOpen(false)} onAdded={onAdded} />}
    </>
  )
}

type AuthMode = 'api_key' | 'login' | 'none'

/**
 * A sign-in channel pins its own address and interface type (the server only sends a token to the channel's own
 * address). The API gives these through the sign-in entries it lists with the presets; the form reads them from there
 * and invents nothing.
 */
function useLoginChannels(kind: ProviderKind) {
  const presets = usePresets()
  return useMemo(() => {
    if (kind !== 'llm') return []
    return (presets.data?.items ?? []).flatMap((p) =>
      p.kind === 'llm' && p.auth.type === 'account_login'
        ? [
            {
              channel: p.auth.channel as LoginChannel,
              protocol: p.protocol as ProtocolId,
              baseUrl: p.baseUrl,
              model: p.suggestedModel,
            },
          ]
        : [],
    )
  }, [presets.data, kind])
}

function AddProviderForm({
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
  const channels = useLoginChannels(kind)
  const [label, setLabel] = useState('')
  const [protocol, setProtocol] = useState<ProtocolId>(protocols[0]!)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  // while signing in the model is the channel's own suggestion until the user types one; the model typed for API-key
  // use is kept apart, so leaving sign-in gives it back untouched (the address box works the same way)
  const [loginModel, setLoginModel] = useState<string>()
  // one request at a time: a ref, because two submits in the same frame both see the same render
  const sending = useRef(false)
  const [apiKey, setApiKey] = useState('')
  const [mode, setMode] = useState<AuthMode>('api_key')
  const [channel, setChannel] = useState<LoginChannel>()

  // sign-in is offered only when a channel exists for the chosen interface type
  const available = channels.filter((c) => c.protocol === protocol)
  const picked =
    mode === 'login' ? (available.find((c) => c.channel === channel) ?? available[0]) : undefined
  const login = mode === 'login' && picked !== undefined
  const shownUrl = login ? picked.baseUrl : baseUrl
  const shownModel = login ? (loginModel ?? picked.model) : model
  const valid =
    label.trim() !== '' && (login || addressSendable(baseUrl)) && shownModel.trim() !== ''
  const addressMessage = useBaseUrlMessage(login ? '' : baseUrl, create.error)

  const chooseProtocol = (p: ProtocolId) => {
    setProtocol(p)
    // a channel belongs to one interface type: leaving it leaves sign-in
    if (!channels.some((c) => c.protocol === p)) setMode((m) => (m === 'login' ? 'api_key' : m))
    create.reset()
  }
  const chooseMode = (m: AuthMode) => {
    setMode(m)
    create.reset()
    if (m === 'login' && available[0]) setChannel(available[0].channel)
  }
  const chooseChannel = (c: LoginChannel) => {
    setChannel(c)
    create.reset()
  }

  const submit = async () => {
    if (!valid || sending.current) return
    sending.current = true
    try {
      const p = await create.mutateAsync({
        body: {
          label: label.trim(),
          kind,
          protocol,
          baseUrl: shownUrl.trim(),
          model: shownModel.trim(),
          // saying it outright keeps "no key yet" and "needs no key" apart
          auth: login
            ? { type: 'account_login', channel: picked.channel }
            : { type: mode === 'none' ? 'none' : 'api_key' },
          ...(mode === 'api_key' && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      })
      onClose()
      onAdded(p)
    } catch {
      /* shown in the dialog */
    } finally {
      sending.current = false
    }
  }

  const authOptions: { value: AuthMode; label: string }[] = [
    { value: 'api_key', label: t('providerAuth.custom.apiKey') },
    ...(available.length > 0
      ? [{ value: 'login' as const, label: t('providerAuth.custom.login') }]
      : []),
    { value: 'none', label: t('providerAuth.custom.none') },
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('providers.add.title')} · ${t(`providers.add.forKind.${kind}`)}`}
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
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label={t('providers.form.name')} required>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} data-autofocus />
        </Field>
        <Field label={t('providers.form.protocol')}>
          <Select
            value={protocol}
            onChange={(e) => chooseProtocol(e.target.value as ProtocolId)}
            disabled={protocols.length < 2}
          >
            {protocols.map((p) => (
              <option key={p} value={p}>
                {protocolLabel(t, p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={'Base URL'}
          required
          error={addressMessage}
          hint={login ? t('providerAuth.loginFixed') : t('providers.add.addressHint')}
        >
          <Input
            mono
            value={shownUrl}
            readOnly={login}
            onChange={(e) => {
              setBaseUrl(e.target.value)
              create.reset()
            }}
            placeholder={t('providers.add.addressPlaceholder')}
          />
        </Field>
        <Field label={t('providerAuth.custom.auth')}>
          <SegmentedControl
            aria-label={t('providerAuth.custom.auth')}
            value={mode}
            onValueChange={chooseMode}
            options={authOptions}
            // on a phone the three choices go one above the other instead of wrapping inside their buttons
            className="max-[480px]:w-full max-[480px]:flex-col max-[480px]:[&>button]:justify-center"
          />
        </Field>
        {mode === 'login' && (
          <Field label={t('providerAuth.custom.channel')}>
            <Select
              value={picked?.channel ?? ''}
              onChange={(e) => chooseChannel(e.target.value as LoginChannel)}
              disabled={available.length < 2}
            >
              {available.map((c) => (
                <option key={c.channel} value={c.channel}>
                  {t(`providerAuth.chip.channels.${c.channel}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {mode === 'login' && <Hint>{t('providerAuth.custom.loginHint')}</Hint>}
        {mode === 'api_key' && (
          <Field label={'API Key'} hint={t('providers.key.hint')}>
            <Input
              mono
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </Field>
        )}
        {mode === 'none' && <Hint>{t('providerAuth.custom.noneHint')}</Hint>}
        <Field label={t('providers.form.model')} required hint={t('providers.add.modelHint')}>
          <Input
            mono
            value={shownModel}
            onChange={(e) => (login ? setLoginModel(e.target.value) : setModel(e.target.value))}
          />
        </Field>
        {/* an address problem is shown on the address input instead */}
        {create.isError && !baseUrlCodeOf(create.error) && <ErrorNotice error={create.error} />}
        {/* lets Enter in a text field submit the form */}
        <button type="submit" hidden tabIndex={-1} aria-hidden />
      </form>
    </Modal>
  )
}
