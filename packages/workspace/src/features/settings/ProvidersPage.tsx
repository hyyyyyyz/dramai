import { useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { Button, Notice, Skeleton } from '@dramai/ui/v2'
import { qk } from '@/data/keys'
import { useCall, useProjects, useProviders, useSettings } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { AddProvider } from './AddProvider'
import { ProviderCard } from './ProviderCard'
import { KINDS, type ProviderKind } from './protocols'
import { VerificationNote } from './ProviderBadges'
import { VoiceSwitchNotice } from './VoiceSwitchNotice'

/** 设置 · 服务商：四类服务（大模型、文生图、图生视频、配音），每类可有多个配置，选一个“使用中”。 */
export function ProvidersPage() {
  const { t } = useTranslation()
  const providers = useProviders()
  const settings = useSettings()
  const projects = useProjects()
  const updateSettings = useCall('settings.update', { invalidate: [qk.settings] })
  const [justAdded, setJustAdded] = useState<string>()
  // the speech provider that was just made current, and the one before it: voices chosen for the old one may not fit
  const [voiceSwitch, setVoiceSwitch] = useState<{ next: string; previous?: string }>()

  if (providers.isError || settings.isError)
    return <ErrorNotice error={providers.error ?? settings.error} />
  if (!providers.data || !settings.data)
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
      </div>
    )
  const active = settings.data.activeProviders
  const activate = (kind: ProviderKind, id: string) => {
    const previous = settings.data.activeProviders.tts
    updateSettings.mutate(
      {
        body: {
          ...settings.data,
          activeProviders: { ...settings.data.activeProviders, [kind]: id },
        },
      },
      {
        onSuccess: () => {
          if (kind === 'tts' && id !== previous) setVoiceSwitch({ next: id, previous })
        },
      },
    )
  }
  const ttsProjects = (projects.data?.items ?? []).filter((p) => p.narrationDelivery === 'tts')

  return (
    <div className="flex flex-col gap-8">
      <Notice tone="info" role="note">
        {t('providers.intro')}
      </Notice>
      {updateSettings.isError && <ErrorNotice error={updateSettings.error} />}
      {KINDS.map((kind) => {
        const items = providers.data.items.filter((p) => p.kind === kind)
        const current = items.find((p) => p.id === active[kind])
        return (
          <section
            key={kind}
            aria-label={t(`providers.kinds.${kind}.title`)}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-display text-title-md font-bold">
                  {t(`providers.kinds.${kind}.title`)}
                </h2>
                <p className="text-sm text-muted-foreground">{t(`providers.kinds.${kind}.desc`)}</p>
              </div>
              <span className="text-xs text-subtle">
                {current
                  ? t('providers.current', { name: current.label })
                  : t('providers.notConfigured')}
              </span>
            </div>
            {kind === 'tts' && !current && ttsProjects.length > 0 && (
              <Notice tone="warn">
                {t('providers.ttsMissing', {
                  count: ttsProjects.length,
                  name: ttsProjects[0]!.name,
                })}{' '}
                <Link
                  to={`/projects/${ttsProjects[0]!.id}`}
                  className="text-accent-text hover:underline"
                >
                  {t('providers.ttsMissingGo')}
                </Link>
              </Notice>
            )}
            {kind === 'tts' && voiceSwitch && voiceSwitch.next === active.tts && current && (
              <VoiceSwitchNotice
                nextId={voiceSwitch.next}
                providerName={current.label}
                projects={projects.data?.items ?? []}
                onDismiss={() => setVoiceSwitch(undefined)}
              />
            )}
            {kind === 'llm' && !current && <Notice tone="warn">{t('providers.llmMissing')}</Notice>}
            {items.length === 0 && (
              <div className="rounded-lg border border-dashed border-border-strong p-4 text-sm text-muted-foreground">
                <Info {...{ size: 16, strokeWidth: 1.5 }} aria-hidden className="mr-2 inline" />
                {t(`providers.kinds.${kind}.empty`)}
              </div>
            )}
            {items
              .filter((p) => p.id === justAdded && p.id !== active[kind])
              .map((p) => (
                <Notice
                  key={`added-${p.id}`}
                  tone="info"
                  title={t('providerAuth.added.title', { name: p.label })}
                  actions={
                    <Button size="sm" variant="secondary" onClick={() => activate(kind, p.id)}>
                      {t('providerAuth.added.use')}
                    </Button>
                  }
                >
                  {p.verification?.status === 'documented' && (
                    <>
                      <span>{t('providerAuth.added.unverified')}</span>
                      <div className="mt-1">
                        <VerificationNote verification={p.verification} />
                      </div>
                    </>
                  )}
                </Notice>
              ))}
            {items.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                active={p.id === active[kind]}
                defaultOpen={p.id === justAdded}
                onActivate={() => activate(kind, p.id)}
                activating={
                  updateSettings.isPending &&
                  updateSettings.variables?.body.activeProviders[kind] === p.id
                }
              />
            ))}
            <div>
              <AddProvider kind={kind} onAdded={(p) => setJustAdded(p.id)} />
            </div>
          </section>
        )
      })}
    </div>
  )
}
