import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@dramai/ui/v2'
import {
  MANAGE_USAGE_URL,
  PROVIDER_ERROR_ACTION,
  isProviderErrorCode,
} from '@/features/settings/provider-model'

/**
 * What a job's error code means when it comes from the ChatGPT sign-in channel, in words and with the next step.
 * Returns nothing for any other code, so the generic failure text stays as it is.
 */
export function ProviderErrorNotice({ code }: { code: string | undefined }) {
  const { t } = useTranslation()
  if (!isProviderErrorCode(code)) return null
  const action = PROVIDER_ERROR_ACTION[code]
  return (
    <div data-testid="provider-error" className="mt-1 flex flex-col gap-1 text-xs leading-normal">
      <div className="font-medium text-foreground">{t(`providerErrors.${code}.title`)}</div>
      <div className="text-muted-foreground">{t(`providerErrors.${code}.body`)}</div>
      {code === 'subscription_sharing_usage_limit_exceeded' && (
        <div className="text-subtle">
          {t('providerErrors.subscription_sharing_usage_limit_exceeded.note')}
        </div>
      )}
      {action === 'manage' && (
        <div>
          <a href={MANAGE_USAGE_URL} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="primary" tabIndex={-1}>
              {t('planUsage.manage')}
            </Button>
          </a>
        </div>
      )}
      {action === 'settings' && (
        <div>
          <Link to="/settings/providers">
            <Button size="sm" variant="secondary" tabIndex={-1}>
              {t('providerErrors.openSettings')}
            </Button>
          </Link>
        </div>
      )}
    </div>
  )
}
