import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@dramai/ui/v2'
import {
  MANAGE_USAGE_URL,
  PROVIDER_ERROR_ACTION,
  providerErrorOf,
} from '@/features/settings/provider-model'

/**
 * What an error code from a provider means, in words and with the next step. The same codes come from failed jobs and
 * from "Test connection", so both show the same explanation. Returns nothing for a code it has no words for, so the
 * caller's generic failure text stays as it is.
 *
 * `where="settings"` is for use on the providers page itself: the "Open settings" button would point at the page the
 * user is already on, so it is left out, and a sign-in failure says where to sign in again instead.
 */
export function ProviderErrorNotice({
  code,
  where = 'task',
}: {
  code: string | undefined
  where?: 'task' | 'settings'
}) {
  const { t } = useTranslation()
  const known = providerErrorOf(code)
  if (!known) return null
  const action = PROVIDER_ERROR_ACTION[known]
  const here = where === 'settings'
  return (
    <div data-testid="provider-error" className="mt-1 flex flex-col gap-1 text-xs leading-normal">
      <div className="font-medium text-foreground">{t(`providerErrors.${known}.title`)}</div>
      <div className="text-muted-foreground">
        {known === 'LOGIN_REQUIRED' && here
          ? t('providerErrors.LOGIN_REQUIRED.bodyHere')
          : t(`providerErrors.${known}.body`)}
      </div>
      {known === 'subscription_sharing_usage_limit_exceeded' && (
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
      {action === 'settings' && !here && (
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
