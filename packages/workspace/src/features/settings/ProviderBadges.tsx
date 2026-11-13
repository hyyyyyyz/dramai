import { useTranslation } from 'react-i18next'
import type { ProviderConfigDto } from '@dramai/api'
import { Chip, Hint } from '@dramai/ui/v2'
import { authState, verificationView } from './provider-model'

/** The sign-in method as a chip. "No API key yet" and "needs no authentication" look and read differently on purpose. */
export function AuthChip({ provider }: { provider: Pick<ProviderConfigDto, 'auth' | 'hasKey'> }) {
  const { t } = useTranslation()
  const state = authState(provider)
  return (
    <Chip className={state === 'key_missing' ? 'border-warn text-warn' : undefined}>
      {t(`providerAuth.chip.${state}`)}
    </Chip>
  )
}

/** Tested (with the date) or set up from the official docs and not tested (with the source). */
export function VerificationChip({
  verification,
  verifiedAt,
}: {
  verification: ProviderConfigDto['verification']
  verifiedAt?: string
}) {
  const { t } = useTranslation()
  const v = verificationView(verification, verifiedAt)
  if (!v) return null
  return v.kind === 'tested' ? (
    <Chip>{t('providerAuth.verification.tested', { date: v.date })}</Chip>
  ) : (
    <Chip className="border-warn text-warn">{t('providerAuth.verification.documented')}</Chip>
  )
}

/** The longer explanation under a documented-only provider, with its source (a link when it is a URL). */
export function VerificationNote({
  verification,
}: {
  verification: ProviderConfigDto['verification']
}) {
  const { t } = useTranslation()
  const v = verificationView(verification)
  if (v?.kind !== 'documented') return null
  return (
    <Hint>
      {t('providerAuth.verification.note')} · {t('providerAuth.verification.source')}:{' '}
      {v.link ? (
        <a
          href={v.source}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent-text underline underline-offset-2"
        >
          {v.source}
        </a>
      ) : (
        v.source
      )}
    </Hint>
  )
}
