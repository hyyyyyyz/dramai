import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, FlaskConical, Trash2 } from 'lucide-react'
import type { ProviderConfigDto } from '@dramai/api'
import {
  Button,
  Chip,
  Field,
  IconButton,
  Input,
  Label,
  Notice,
  Pill,
  SecretField,
  Select,
  Skeleton,
  Hint,
  iconProps,
  cn,
} from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { errorInfo } from '@/data/errors'
import { useCall, useProviderCapability, useProviderModels } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { addressSendable, baseUrlCodeOf, useBaseUrlMessage } from './base-url'
import { CapabilityGrid, PriceTable } from './CapabilityGrid'
import { capabilitySummary } from './capability-summary'
import { DialectSettings } from './DialectSettings'
import { dialectChanged, dialectOf, dialectSupport, draftOf, draftValid } from './dialect-model'
import { LoginPanel } from './LoginPanel'
import { AuthChip, VerificationChip, VerificationNote } from './ProviderBadges'
import { authState, canTest, loginChannelOf } from './provider-model'
import { TestResult } from './TestConnection'
import { LISTS_MODELS, PROTOCOLS_BY_KIND, protocolLabel, type ProtocolId } from './protocols'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export interface ProviderCardProps {
  provider: ProviderConfigDto
  active: boolean
  defaultOpen?: boolean
  onActivate: () => void
  activating?: boolean
}

/** 服务商卡：收起是一行摘要，展开是表单加模型能力、价格、已知限制和“测试连接”。API Key 只写不读。 */
export function ProviderCard({
  provider,
  active,
  defaultOpen = false,
  onActivate,
  activating,
}: ProviderCardProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)
  const cap = useProviderCapability(provider.id)
  const summary = cap.data ? capabilitySummary(cap.data.capability, t as never) : []

  return (
    <article
      data-active={active || undefined}
      className={cn('rounded-lg border bg-surface', active ? 'border-accent/60' : 'border-border')}
      aria-label={provider.label}
    >
      <div className="flex items-start gap-3 p-4 max-[640px]:flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{provider.label}</div>
          <div className="truncate text-xs text-muted-foreground">
            {hostOf(provider.baseUrl)} · {provider.model} · {protocolLabel(t, provider.protocol)}
          </div>
          {!open && (
            <div className="mt-2 flex flex-wrap gap-2">
              <AuthChip provider={provider} />
              <VerificationChip
                verification={provider.verification}
                verifiedAt={provider.verifiedAt}
              />
              {cap.isPending && <Skeleton className="h-6 w-24" />}
              {summary.map((s) => (
                <Chip key={s}>{s}</Chip>
              ))}
            </div>
          )}
        </div>
        {active ? (
          <Pill tone="success">{t('providers.active')}</Pill>
        ) : (
          <Button size="sm" variant="secondary" loading={activating} onClick={onActivate}>
            {t('providers.setActive')}
          </Button>
        )}
        <IconButton
          label={
            open
              ? t('providers.collapse', { name: provider.label })
              : t('providers.expand', { name: provider.label })
          }
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronUp {...iconProps} aria-hidden />
          ) : (
            <ChevronDown {...iconProps} aria-hidden />
          )}
        </IconButton>
      </div>
      {open && <ProviderForm provider={provider} />}
    </article>
  )
}

function ProviderForm({ provider }: { provider: ProviderConfigDto }) {
  const { t } = useTranslation()
  const invalidate = [qk.providers, qk.settings, qk.providerCapability(provider.id)]
  const update = useCall('providers.update', { invalidate })
  const setKey = useCall('providers.setKey', { invalidate })
  const test = useCall('providers.test', {})
  const remove = useCall('providers.delete', { invalidate: [qk.providers, qk.settings] })
  const cap = useProviderCapability(provider.id)

  const [label, setLabel] = useState(provider.label)
  const [protocol, setProtocol] = useState<ProtocolId>(provider.protocol)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl)
  const [model, setModel] = useState(provider.model)
  const [dialect, setDialect] = useState(() => draftOf(provider.dialect))
  // the advanced options this protocol really reads (none for protocols that read none of them)
  const support = dialectSupport(protocol)
  const dialectDirty = dialectChanged(dialect, provider.dialect, support)
  const dialectOk = draftValid(dialect, support)
  const login = provider.auth.type === 'account_login'
  const state = authState(provider)
  const [replacing, setReplacing] = useState(!provider.hasKey)
  const [key, setKey_] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dirty =
    label !== provider.label ||
    protocol !== provider.protocol ||
    baseUrl !== provider.baseUrl ||
    model !== provider.model ||
    dialectDirty
  // JSON that does not parse can never be saved
  const valid =
    label.trim() !== '' && (login || addressSendable(baseUrl)) && model.trim() !== '' && dialectOk
  const addressMessage = useBaseUrlMessage(baseUrl, update.error)
  const protocols = PROTOCOLS_BY_KIND[provider.kind]
  // why "test connection" is unavailable; shown as visible text, not only as a tooltip
  const channel = loginChannelOf(provider)
  const testBlocked = dirty
    ? t('providers.testSaveFirst')
    : !canTest(provider)
      ? channel
        ? t(`providers.testNeedsLoginChannels.${channel}`)
        : t('providers.testNeedsKey')
      : undefined

  const save = async () => {
    try {
      test.reset()
      await update.mutateAsync({
        params: { providerId: provider.id },
        body: {
          label: label.trim(),
          protocol,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          ...(dialectDirty ? { dialect: dialectOf(dialect, support) ?? {} } : {}),
        },
      })
    } catch {
      /* 显示在下面 */
    }
  }
  const saveKey = async () => {
    if (key.trim() === '') return
    try {
      await setKey.mutateAsync({
        params: { providerId: provider.id },
        body: { apiKey: key.trim() },
      })
      setKey_('')
      setReplacing(false)
      test.reset()
    } catch {
      /* 显示在下面 */
    }
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border p-4">
      <div className="grid grid-cols-2 gap-4 max-[640px]:grid-cols-1">
        <Field label={t('providers.form.name')}>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label={t('providers.form.protocol')}>
          <Select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as ProtocolId)}
            disabled={protocols.length < 2 || login}
          >
            {protocols.map((p) => (
              <option key={p} value={p}>
                {protocolLabel(t, p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          className="col-span-full"
          label="Base URL"
          hint={login ? t('providerAuth.loginFixed') : undefined}
          error={addressMessage}
        >
          <Input
            mono
            value={baseUrl}
            readOnly={login}
            onChange={(e) => {
              setBaseUrl(e.target.value)
              update.reset()
            }}
          />
        </Field>
        <ModelField provider={provider} value={model} onChange={setModel} />

        {state === 'none' && (
          <div className="col-span-full">
            <Notice tone="info">{t('providerAuth.noneNote')}</Notice>
          </div>
        )}
        {login && (
          <div className="col-span-full">
            <LoginPanel provider={provider} />
          </div>
        )}
        {!login && state !== 'none' && (
          <div className="col-span-full flex flex-col gap-2">
            <Label htmlFor={`key-${provider.id}`}>API Key</Label>
            {!replacing ? (
              <SecretField
                status={t('providers.key.saved', { mask: provider.keyMask ?? '••••••••' })}
                action={
                  <Button variant="secondary" onClick={() => setReplacing(true)}>
                    {t('providers.key.replace')}
                  </Button>
                }
              />
            ) : (
              <div className="flex gap-2 max-[640px]:flex-wrap">
                <Input
                  id={`key-${provider.id}`}
                  mono
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('providers.key.placeholder')}
                  value={key}
                  onChange={(e) => setKey_(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveKey()
                  }}
                  className="min-w-0 flex-1"
                />
                <Button
                  variant="primary"
                  disabled={key.trim() === ''}
                  loading={setKey.isPending}
                  onClick={saveKey}
                >
                  {t('providers.key.save')}
                </Button>
                {provider.hasKey && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setReplacing(false)
                      setKey_('')
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                )}
              </div>
            )}
            <Hint>{t('providers.key.hint')}</Hint>
            {setKey.isError && <ErrorNotice error={setKey.error} />}
          </div>
        )}
      </div>

      <DialectSettings draft={dialect} support={support} onChange={setDialect} />
      {!dialectOk && (
        <p className="text-sm text-danger" role="alert">
          {t('providerDialect.fixToSave')}
        </p>
      )}
      <VerificationNote verification={provider.verification} />
      {cap.isPending && <Skeleton className="h-24" />}
      {cap.isError && <ErrorNotice error={cap.error} />}
      {cap.data && (
        <>
          {!cap.data.declared && <Notice tone="info">{t('providers.undeclared')}</Notice>}
          <div>
            <div className="mb-2 text-sm font-medium">{t('providers.capabilities')}</div>
            <CapabilityGrid capability={cap.data.capability} />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">{t('providers.pricing')}</div>
            <PriceTable pricing={cap.data.pricing} />
            <Hint className="mt-2">{t('providers.pricingNote')}</Hint>
          </div>
          {(provider.knownLimitations?.length ?? 0) + cap.data.quirks.length > 0 && (
            <Notice tone="warn" title={t('providers.limitations')}>
              <ul className="list-disc pl-4">
                {[...(provider.knownLimitations ?? []), ...cap.data.quirks].map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Notice>
          )}
          {(cap.data.capability.verifiedAt ?? provider.verifiedAt) && (
            <Hint>
              {t('providers.verifiedAt', {
                date: cap.data.capability.verifiedAt ?? provider.verifiedAt,
              })}
              {cap.data.provenance ? ` · ${cap.data.provenance}` : ''}
            </Hint>
          )}
        </>
      )}
      {(provider.acceptedUnverified?.length ?? 0) > 0 && (
        <Hint>
          {t('providers.acceptedUnverified', { count: provider.acceptedUnverified!.length })}
        </Hint>
      )}

      {update.isError && !baseUrlCodeOf(update.error) && <ErrorNotice error={update.error} />}
      {test.isError && <ErrorNotice error={test.error} />}
      {test.data && <TestResult result={test.data} />}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button
          size="sm"
          variant="secondary"
          loading={test.isPending}
          disabled={Boolean(testBlocked)}
          aria-describedby={testBlocked ? `test-why-${provider.id}` : undefined}
          title={testBlocked}
          onClick={() => test.mutate({ params: { providerId: provider.id } })}
        >
          <FlaskConical {...iconProps} aria-hidden />
          {t('providers.test.action')}
        </Button>
        {testBlocked && (
          <span id={`test-why-${provider.id}`} className="text-xs text-muted-foreground">
            {testBlocked}
          </span>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 {...iconProps} aria-hidden />
          {t('common.delete')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!dirty || !valid}
          loading={update.isPending}
          onClick={save}
        >
          {t('common.save')}
        </Button>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title={t('providers.delete.title')}
        closeLabel={t('common.close')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger-solid"
              loading={remove.isPending}
              onClick={() => remove.mutate({ params: { providerId: provider.id } })}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>{t('providers.delete.body', { name: provider.label })}</p>
          {remove.isError && <ErrorNotice error={remove.error} />}
        </div>
      </Modal>
    </div>
  )
}

/**
 * The model: typed in, or chosen from the provider's own list. Signed in with an account, the list is fetched
 * by itself; for a key or no-auth text provider that can list models (OpenAI-style, Anthropic, Gemini) there is a
 * button, so nothing is requested from the provider until the user asks.
 */
function ModelField({
  provider,
  value,
  onChange,
}: {
  provider: ProviderConfigDto
  value: string
  onChange: (v: string) => void
}) {
  const { t } = useTranslation()
  const isLogin = provider.auth.type === 'account_login'
  const signedIn = isLogin && provider.login?.state === 'signed_in'
  const canList =
    LISTS_MODELS.has(provider.protocol) &&
    (signedIn || (!isLogin && (provider.auth.type === 'none' || provider.hasKey)))
  const [asked, setAsked] = useState(false)
  const models = useProviderModels(provider.id, canList && (signedIn || asked))
  const items = models.data?.items
  const unsupported = models.isError && errorInfo(models.error).code === 'MODEL_LIST_UNSUPPORTED'

  if (canList && items && items.length > 0) {
    const ids = items.map((m) => m.id)
    return (
      <Field className="col-span-full" label={t('providerLogin.models.label')}>
        <div className="flex gap-2">
          <Select
            className="min-w-0 flex-1"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {!ids.includes(value) && <option value={value}>{value}</option>}
            {items.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label === m.id ? m.id : `${m.label} (${m.id})`}
              </option>
            ))}
          </Select>
          {!signedIn && (
            <Button
              variant="ghost"
              loading={models.isFetching}
              onClick={() => void models.refetch()}
            >
              {t('providerLogin.models.refetch')}
            </Button>
          )}
        </div>
      </Field>
    )
  }
  const hint = signedIn
    ? models.isPending
      ? t('providerLogin.models.loading')
      : models.isError
        ? t('providerLogin.models.failed')
        : undefined
    : isLogin
      ? t('providerLogin.models.hint')
      : unsupported
        ? t('providerLogin.models.unsupported')
        : models.isError
          ? t('providerLogin.models.failed')
          : canList
            ? t('providerLogin.models.fetchHint')
            : undefined
  return (
    <Field className="col-span-full" label={t('providerCatalog.fill.model')} hint={hint}>
      <div className="flex gap-2">
        <Input
          mono
          className="min-w-0 flex-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {canList && !signedIn && !unsupported && (
          <Button
            variant="ghost"
            loading={asked && models.isFetching}
            onClick={() => setAsked(true)}
          >
            {t('providerLogin.models.fetch')}
          </Button>
        )}
      </div>
    </Field>
  )
}
