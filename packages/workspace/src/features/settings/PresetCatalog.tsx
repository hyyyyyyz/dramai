import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import type { ProviderConfigDto } from '@dramai/api'
import { Button, Chip, Field, Hint, Input, Notice, iconProps } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall, usePresets } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import {
  groupPresets,
  inputProblems,
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
  const update = useCall('providers.update', { invalidate: [qk.providers] })
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Preset>()
  const [values, setValues] = useState<Record<string, string>>({})
  const [model, setModel] = useState('')
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<unknown>()

  const all = (presets.data?.items ?? []).filter((p) => p.kind === kind)
  const groups = groupPresets(all, query)

  const create = async (p: Preset, extra?: { baseUrl: string; model: string }) => {
    setError(undefined)
    let made: ProviderConfigDto | undefined
    try {
      made = await fromPreset.mutateAsync({ body: { presetId: p.id } })
      if (extra) {
        made = await update.mutateAsync({
          params: { providerId: made.id },
          body: {
            ...(extra.baseUrl !== p.baseUrl ? { baseUrl: extra.baseUrl } : {}),
            ...(extra.model.trim() ? { model: extra.model.trim() } : {}),
          },
        })
      }
      onClose()
      onAdded(made)
    } catch (e) {
      setError(e)
      // the provider exists (only the second step failed): open it so the user can fix the field there
      if (made) onAdded(made)
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
    const problemOf = (field: string) =>
      tried ? problems.find((x) => x.field === field) : undefined
    return (
      <Modal
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
              loading={fromPreset.isPending || update.isPending}
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
              label="Model"
              hint={t('providerCatalog.fill.modelHint')}
              error={problemOf('model') ? t('providerCatalog.fill.model_missing') : undefined}
              required
            >
              <Input mono value={model} onChange={(e) => setModel(e.target.value)} />
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
        {presets.isPending && <p className="text-sm text-muted-foreground">…</p>}
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
