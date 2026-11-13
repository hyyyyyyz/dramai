import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import type { ProviderConfigDto } from '@dramai/api'
import { Button, Chip, Field, Hint, Input, Notice, iconProps } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall, usePresets } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { errorInfo } from '@/data/errors'
import {
  groupPresets,
  inputProblems,
  type InputProblem,
  needsInput,
  resolveBaseUrl,
  type Preset,
} from './catalog-model'
import { VerificationChip, VerificationNote } from './ProviderBadges'
import type { ProviderKind } from './protocols'

/**
 * The provider catalog: presets of one kind grouped by vendor, with region and verification status on each, a search
 * box, and a second step for presets that need something from the user (an address with `{placeholders}`, or no
 * suggested model). Creating from a preset keeps its link to the preset (verification, known limitations).
 */
export function PresetCatalog({
  kind,
  onClose,
  onCustom,
  onAdded,
}: {
  kind: ProviderKind
  onClose: () => void
  onCustom: () => void
  onAdded: (p: ProviderConfigDto) => void
}) {
  const { t } = useTranslation()
  const presets = usePresets()
  const fromPreset = useCall('providers.fromPreset', { invalidate: [qk.providers] })
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Preset>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [model, setModel] = useState('')
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<unknown>()

  const all = (presets.data?.items ?? []).filter((p) => p.kind === kind)
  const groups = groupPresets(all, query)

  /**
   * One call creates the provider: the address (when the user filled placeholders in) and the model (when the user
   * typed one) go along with the preset, so a failure leaves nothing behind and a retry cannot create a second one.
   * An account-login preset has a fixed address and never gets one sent.
   */
  const create = async (p: Preset, extra?: { baseUrl: string; model: string }) => {
    setError(undefined)
    const locked = p.auth.type === 'account_login'
    const baseUrl = extra && !locked && extra.baseUrl !== p.baseUrl ? extra.baseUrl : undefined
    const model = extra?.model.trim() ? extra.model.trim() : undefined
    try {
      const made = await fromPreset.mutateAsync({
        body: { presetId: p.id, ...(baseUrl ? { baseUrl } : {}), ...(model ? { model } : {}) },
      })
      onClose()
      onAdded(made)
    } catch (e) {
      setError(e)
    }
  }

  const choose = (p: Preset) => {
    if (needsInput(p)) {
      setPicked(p)
      setValues({})
      setModel('')
      setTried(false)
      setError(undefined)
    } else void create(p)
  }

  if (picked) {
    const problems = inputProblems(picked, values, model)
    const info = error === undefined ? undefined : errorInfo(error)
    const unfilled =
      info?.code === 'BASE_URL_PLACEHOLDER_UNFILLED'
        ? ((info.details as { placeholders?: string[] } | undefined)?.placeholders ?? [])
        : []
    // what is wrong with each field: what we can see ourselves, plus what the server says is still unfilled
    const problemOf = (field: string): InputProblem | undefined =>
      (tried ? problems.find((x) => x.field === field) : undefined) ??
      (unfilled.includes(field) ? { field, kind: 'missing' } : undefined)
    return (
      <Modal
        key="fill"
        open
        onClose={onClose}
        title={t('providerCatalog.fill.title', { name: picked.label })}
        closeLabel={t('common.close')}
        dismissOnBackdrop={false}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPicked(undefined)}>
              {t('providerCatalog.fill.back')}
            </Button>
            <Button
              variant="primary"
              loading={fromPreset.isPending}
              onClick={() => {
                setTried(true)
                if (problems.length > 0) return
                void create(picked, { baseUrl: resolveBaseUrl(picked.baseUrl, values), model })
              }}
            >
              {t('providers.add.create')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {picked.region === 'local' && (
            <Notice tone="info">{t('providerCatalog.localNote')}</Notice>
          )}
          <Hint className="font-mono break-all">{picked.baseUrl}</Hint>
          {(picked.baseUrlPlaceholders ?? []).map((name, i) => (
            <Field
              key={name}
              label={name}
              hint={t('providerCatalog.fill.placeholderHint', { name })}
              error={
                problemOf(name)
                  ? t(`providerCatalog.fill.${problemOf(name)!.kind}`, { name })
                  : undefined
              }
              required
            >
              <Input
                mono
                data-autofocus={i === 0 ? true : undefined}
                value={values[name] ?? ''}
                onChange={(e) => setValues({ ...values, [name]: e.target.value })}
              />
            </Field>
          ))}
          {picked.suggestedModel.trim() === '' && (
            <Field
              label={t('providerCatalog.fill.model')}
              hint={t('providerCatalog.fill.modelHint')}
              error={problemOf('model') ? t('providerCatalog.fill.model_missing') : undefined}
              required
            >
              <Input
                data-autofocus={(picked.baseUrlPlaceholders ?? []).length === 0 ? true : undefined}
                mono
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </Field>
          )}
          <VerificationNote verification={picked.verification} />
          {error !== undefined && <ErrorNotice error={error} />}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      key="list"
      open
      onClose={onClose}
      size="lg"
      title={t('providerCatalog.title')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={onCustom}>
            {t('providers.add.custom')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search
            {...iconProps}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle"
          />
          <Input
            type="search"
            className="pl-9"
            aria-label={t('providerCatalog.search')}
            placeholder={t('providerCatalog.search')}
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {presets.isPending && (
          <p className="text-sm text-muted-foreground">{t('providerCatalog.loading')}</p>
        )}
        {presets.isError && <ErrorNotice error={presets.error} />}
        {groups.length === 0 && !presets.isPending && (
          <p className="text-sm text-muted-foreground">
            {query.trim()
              ? t('providerCatalog.noMatch', { query: query.trim() })
              : t('providerCatalog.empty')}
          </p>
        )}
        {groups.map((g) => (
          <section key={g.vendor.id} aria-label={g.vendor.label} className="flex flex-col gap-1">
            <h3 className="font-display text-title-sm font-bold">{g.vendor.label}</h3>
            <ul className="flex flex-col">
              {g.presets.map((p) => (
                <li key={p.id} className="border-t border-border first:border-t-0">
                  <button
                    type="button"
                    disabled={fromPreset.isPending}
                    onClick={() => choose(p)}
                    className="flex w-full flex-col gap-1 rounded-md px-2 py-3 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.label}</span>
                      {p.region && <Chip>{t(`providerCatalog.region.${p.region}`)}</Chip>}
                      <VerificationChip verification={p.verification} verifiedAt={p.verifiedAt} />
                    </span>
                    {p.region === 'local' && (
                      <span className="text-xs text-muted-foreground">
                        {t('providerCatalog.localShort')}
                      </span>
                    )}
                    {needsInput(p) && (
                      <span className="text-xs text-muted-foreground">
                        {t('providerCatalog.needsInput')}
                      </span>
                    )}
                  </button>
                  {(p.knownLimitations?.length ?? 0) > 0 && (
                    <details className="px-2 pb-3 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        {t('providerCatalog.limits', { count: p.knownLimitations!.length })}
                      </summary>
                      <ul className="mt-1 list-disc pl-4">
                        {p.knownLimitations!.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {error !== undefined && <ErrorNotice error={error} />}
      </div>
    </Modal>
  )
}
