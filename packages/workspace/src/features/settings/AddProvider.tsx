import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import type { CallInput, CallOutput, ProviderConfigDto } from '@dramai/api'
import { Button, Field, Hint, Input, SegmentedControl, Select, iconProps } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall, useKnownModels, useLoginChannels as useLoginChannelConfigs } from '@/data/queries'
import { useApi } from '@/data/use-api'
import { ErrorNotice } from '@/features/common/error-text'
import { ModelSelect } from './ModelSelect'
import { TestResult } from './TestConnection'
import { addressSendable, baseUrlCodeOf, useBaseUrlMessage } from './base-url'
import type { LoginChannel } from './login-channels'
import {
  ADDABLE_PROTOCOLS_BY_KIND,
  protocolLabel,
  type ProtocolId,
  type ProviderKind,
} from './protocols'

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
type ProbeBody = CallInput<'providers.probe'>['body']
type ProbeResult = CallOutput<'providers.probe'>
type Settled = { fp: string; result: ProbeResult } | { fp: string; error: unknown }

/**
 * A sign-in channel pins its own address and interface type (the server only sends a token to the channel's own
 * address). The API lists them (`providers.loginChannels`); the form invents nothing.
 */
function useLoginChannels(kind: ProviderKind) {
  const channels = useLoginChannelConfigs()
  return useMemo(() => {
    if (kind !== 'llm') return []
    return (channels.data?.items ?? [])
      .filter((c) => c.kind === 'llm')
      .map((c) => ({
        channel: c.channel as LoginChannel,
        protocol: c.protocol as ProtocolId,
        baseUrl: c.baseUrl,
        model: c.suggestedModel ?? '',
      }))
  }, [channels.data, kind])
}

/**
 * One of the two things the form can ask the server about the draft before anything is saved (`providers.probe`:
 * list the models, test the connection). It creates nothing. `fp` says what the answer depends on; an answer is shown
 * only while the draft still has that fingerprint, and one that arrives after the draft changed or the form closed is
 * dropped (a request number and the mounted flag decide, not the order in which things happen to finish).
 */
function useDraftProbe(fp: string) {
  const api = useApi()
  const alive = useRef(true)
  const current = useRef(fp)
  const seq = useRef(0)
  // the fingerprint of the request that is out: the same draft is never asked twice at once (a ref, so two clicks
  // in one frame see the same thing)
  const inflight = useRef<string | undefined>(undefined)
  const [pending, setPending] = useState<string>()
  const [settled, setSettled] = useState<Settled>()
  useLayoutEffect(() => {
    current.current = fp
  }, [fp])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = async (body: ProbeBody) => {
    if (inflight.current === fp) return
    const mine = fp
    const id = ++seq.current
    inflight.current = mine
    setPending(mine)
    const fresh = () => alive.current && id === seq.current && mine === current.current
    try {
      const result = await api.call('providers.probe', { body })
      if (fresh()) setSettled({ fp: mine, result })
    } catch (error) {
      if (fresh()) setSettled({ fp: mine, error })
    } finally {
      if (inflight.current === mine) inflight.current = undefined
      if (alive.current) setPending((p) => (p === mine ? undefined : p))
    }
  }
  const answer = settled?.fp === fp ? settled : undefined
  return {
    run,
    loading: pending === fp,
    result: answer && 'result' in answer ? answer.result : undefined,
    error: answer && 'error' in answer ? answer.error : undefined,
  }
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
  const protocols = ADDABLE_PROTOCOLS_BY_KIND[kind]
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
  const probeHintId = useId()

  // sign-in is offered only when a channel exists for the chosen interface type
  const available = channels.filter((c) => c.protocol === protocol)
  const picked =
    mode === 'login' ? (available.find((c) => c.channel === channel) ?? available[0]) : undefined
  const login = mode === 'login' && picked !== undefined
  const shownUrl = login ? picked.baseUrl : baseUrl
  const shownModel = login ? (loginModel ?? picked.model) : model
  const valid =
    label.trim() !== '' && (login || addressSendable(baseUrl)) && shownModel.trim() !== ''

  // what the two optional questions to the server depend on
  const keyed = mode === 'api_key' ? apiKey.trim() : ''
  const listFp = JSON.stringify([kind, protocol, shownUrl.trim(), mode, keyed])
  const testFp = JSON.stringify([listFp, shownModel.trim()])
  const list = useDraftProbe(listFp)
  const test = useDraftProbe(testFp)
  const known = useKnownModels(kind, protocol)

  // an address problem, from adding or from either question, is shown on the address input and nowhere else
  const probeAddressError = [list.error, test.error].find((e) => e && baseUrlCodeOf(e))
  const addressError = baseUrlCodeOf(create.error) ? create.error : probeAddressError
  const addressMessage = useBaseUrlMessage(login ? '' : baseUrl, addressError)

  const missing = [
    ...(addressSendable(baseUrl) ? [] : [t('providers.add.probe.needAddress')]),
    ...(mode === 'api_key' && keyed === '' ? [t('providers.add.probe.needKey')] : []),
  ]
  const canProbe = !login && missing.length === 0

  const fetched = list.result?.outcome === 'models' ? list.result.items : undefined
  // only the model id: it is the value that goes to the interface. Names the model data or the provider gives it
  // (display names carry vendor and product names) are not shown.
  const candidates = (fetched ?? known.data?.items ?? []).map((m) => m.id)

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

  const probeBody = (action: 'models' | 'test'): ProbeBody => ({
    action,
    kind,
    protocol,
    baseUrl: shownUrl.trim(),
    auth: mode === 'none' ? { type: 'none' } : { type: 'api_key', apiKey: keyed },
    ...(action === 'test' && shownModel.trim() ? { model: shownModel.trim() } : {}),
  })

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

  // the answer to "list the models", in words
  const listNote = (() => {
    const r = list.result
    if (!r) return null
    if (r.outcome === 'models')
      return r.items.length === 0 ? (
        <Hint role="status">{t('providers.add.probe.listEmpty')}</Hint>
      ) : (
        <Hint role="status">{t('providers.add.probe.listed', { count: r.items.length })}</Hint>
      )
    if (r.outcome === 'no_model_list')
      return (
        <Hint role="status">
          {t(
            known.data?.items.length
              ? 'providers.add.probe.noListKnown'
              : 'providers.add.probe.noList',
          )}
        </Hint>
      )
    if (r.outcome === 'login_after_save')
      return <Hint role="status">{t('providers.add.probe.loginAfterSave')}</Hint>
    return <TestResult result={r} />
  })()

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('providers.add.title')} · ${t(`providers.add.forKind.${kind}`)}`}
      closeLabel={t('common.close')}
      dismissOnBackdrop={false}
      footer={
        // wide: the three buttons in one row on the right; on a phone "Test connection" is a row of its own above, so
        // the main action is never left alone on a second line
        <div className="flex w-full flex-wrap items-center justify-end gap-2 max-[480px]:flex-col max-[480px]:items-stretch">
          <Button
            variant="secondary"
            disabled={!canProbe}
            loading={test.loading}
            aria-describedby={canProbe ? undefined : probeHintId}
            onClick={() => void test.run(probeBody('test'))}
          >
            {t('providers.test.action')}
          </Button>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" disabled={!valid} loading={create.isPending} onClick={submit}>
              {t('providers.add.create')}
            </Button>
          </div>
        </div>
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

        {/* optional: ask the provider for its models before adding. Nothing is created by it. */}
        <div className="flex flex-col gap-2">
          <div>
            <Button
              variant="secondary"
              disabled={!canProbe}
              loading={list.loading}
              aria-describedby={canProbe ? undefined : probeHintId}
              onClick={() => void list.run(probeBody('models'))}
            >
              {t('providerLogin.models.fetch')}
            </Button>
          </div>
          {login ? (
            <Hint id={probeHintId}>{t('providers.add.probe.loginAfterSave')}</Hint>
          ) : (
            missing.length > 0 && (
              <Hint id={probeHintId}>
                {t('providers.add.probe.missing', {
                  what: missing.join(t('providerDialect.listSeparator')),
                })}
              </Hint>
            )
          )}
          {listNote}
          {list.error !== undefined && !baseUrlCodeOf(list.error) && (
            <ErrorNotice error={list.error} />
          )}
        </div>

        <ModelSelect
          value={shownModel}
          onChange={(v) => (login ? setLoginModel(v) : setModel(v))}
          options={candidates}
          hint={
            candidates.length > 0
              ? t('providers.add.probe.candidatesNote')
              : t('providers.add.modelHint')
          }
        />

        {test.result && test.result.outcome !== 'models' && (
          <TestOutcome result={test.result} loginNote={t('providers.add.probe.loginAfterSave')} />
        )}
        {test.error !== undefined && !baseUrlCodeOf(test.error) && (
          <ErrorNotice error={test.error} />
        )}
        {/* an address problem is shown on the address input instead */}
        {create.isError && !baseUrlCodeOf(create.error) && <ErrorNotice error={create.error} />}
        {/* lets Enter in a text field submit the form */}
        <button type="submit" hidden tabIndex={-1} aria-hidden />
      </form>
    </Modal>
  )
}

/** The answer to "test the connection" for a draft: the same words and look as on a saved provider's card. */
function TestOutcome({ result, loginNote }: { result: ProbeResult; loginNote: string }) {
  if (result.outcome === 'ok' || result.outcome === 'failed' || result.outcome === 'unverifiable')
    return <TestResult result={result} />
  if (result.outcome === 'login_after_save') return <Hint role="status">{loginNote}</Hint>
  // a model list or "no list" is not an answer to a test
  return null
}
