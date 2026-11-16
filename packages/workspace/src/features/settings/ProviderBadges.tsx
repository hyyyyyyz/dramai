import { useTranslation } from 'react-i18next'
import type { ProviderConfigDto } from '@dramai/api'
import { Chip } from '@dramai/ui/v2'
import { authState, loginChannelOf, type ChipState } from './provider-model'

/** The sign-in method as a chip. "No API key yet" and "needs no authentication" look and read differently on purpose. */
export function AuthChip({ provider }: { provider: Pick<ProviderConfigDto, 'auth' | 'hasKey'> }) {
  const { t } = useTranslation()
  const state = authState(provider)
  const channel = loginChannelOf(provider)
  return (
    <Chip className={state === 'key_missing' ? 'border-warn text-warn' : undefined}>
      {channel
        ? t(`providerAuth.chip.channels.${channel}`)
        : t(`providerAuth.chip.${state as ChipState}`)}
    </Chip>
  )
}
