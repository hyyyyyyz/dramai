import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { ProviderConfigDto } from '@dramai/api'
import { Button, Hint, Notice, Progress, iconProps } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall, useProviderLogin } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { useFormat } from '@/i18n/format'
import {
  MANAGE_USAGE_URL,
  WELCOME_FLAG,
  loginErrorKind,
  loginView,
  type LoginErrorKind,
} from './provider-model'

type Revoked = 'confirmed' | 'unconfirmed' | 'nothing_to_revoke'

const wasWelcomed = () => {
  try {
    return localStorage.getItem(WELCOME_FLAG) === '1'
  } catch {
    return false
  }
}
const markWelcomed = () => {
  try {
    localStorage.setItem(WELCOME_FLAG, '1')
  } catch {
    /* storage unavailable: the note may show again, nothing breaks */
  }
}

/**
 * Account sign-in for a provider (OpenAI "Continue with ChatGPT"): start, wait in the browser (cancellable), signed in,
 * failures, sign in again / another account, sign out. Statuses never contain tokens. Polling runs only while
 * a sign-in is pending and stops with the component (see useProviderLogin).
 */
export function LoginPanel({
  provider,
  pollMs,
}: {
  provider: ProviderConfigDto
  /** Poll interval while a sign-in is pending; tests use a short one. */
  pollMs?: number
}) {
  const { t } = useTranslation()
  const fmt = useFormat()
  const qc = useQueryClient()
  const login = useProviderLogin(provider, pollMs)
  const status = login.data
  const [url, setUrl] = useState<string>()
  const [revoked, setRevoked] = useState<Revoked>()
  const [welcome, setWelcome] = useState(false)

  const setStatus = (s: NonNullable<typeof status>) =>
    qc.setQueryData(qk.providerLogin(provider.id), s)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.providers })
  }
  const start = useCall('providers.login.start', {
    onSuccess: (r) => {
      setUrl(r.authorizationUrl)
      setRevoked(undefined)
      window.open(r.authorizationUrl, '_blank', 'noopener,noreferrer')
      void qc.invalidateQueries({ queryKey: qk.providerLogin(provider.id) })
    },
  })
  const cancel = useCall('providers.login.cancel', {
    onSuccess: (s) => {
      setUrl(undefined)
      setStatus(s)
      refresh()
    },
  })
  const logout = useCall('providers.login.logout', {
    onSuccess: (r) => {
      setUrl(undefined)
      setRevoked(r.revoked)
      setStatus(r.status)
      refresh()
    },
  })

  // A sign-in that was pending has ended. State is adjusted while rendering (no effect needed); the first time a
  // sign-in with plan usage completes, say once what it means (OpenAI's guidelines).
  const [prevState, setPrevState] = useState(status?.state)
  if (status?.state !== prevState) {
    setPrevState(status?.state)
    if (prevState === 'pending') {
      setUrl(undefined)
      if (status?.state === 'signed_in' && status.planUsage !== false && !wasWelcomed())
        setWelcome(true)
    }
  }
  const stateNow = status?.state
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    // the provider list carries the login too: refresh it whenever the state changes
    void qc.invalidateQueries({ queryKey: qk.providers })
  }, [stateNow, qc])
  const closeWelcome = () => {
    markWelcomed()
    setWelcome(false)
  }

  if (!status) return null
  const view = loginView(status)
  const startPending = start.isPending
  const time = (iso?: string) =>
    iso ? new Date(iso).toLocaleTimeString(fmt.locale, { hour: '2-digit', minute: '2-digit' }) : ''
  const account = status.account?.label

  const continueButtons = (opts: { again?: boolean; label?: string } = {}) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        loading={startPending}
        disabled={startPending}
        onClick={() => start.mutate({ params: { providerId: provider.id }, body: {} })}
      >
        {opts.label ?? t('providerLogin.continue')}
      </Button>
      {opts.again && account && (
        <Button
          variant="secondary"
          disabled={startPending}
          onClick={() =>
            start.mutate({ params: { providerId: provider.id }, body: { account: 'new' } })
          }
        >
          {t('providerLogin.newAccount')}
        </Button>
      )}
    </div>
  )

  const errorKind: LoginErrorKind | undefined = status.lastError
    ? loginErrorKind(status.lastError.code)
    : undefined

  return (
    <div className="flex flex-col gap-3" data-testid="login-panel" data-view={view}>
      <div className="flex flex-col gap-1.5">
        <div className="text-sm font-medium">{t('providerLogin.title')}</div>
        <p className="text-sm text-muted-foreground">{t('providerLogin.intro')}</p>
        <p className="text-sm text-muted-foreground">{t('providerLogin.textOnly')}</p>
        <Hint>{t('providerLogin.needsPlan')}</Hint>
      </div>

      {view === 'unavailable' && (
        <Notice tone="info">
          {status.availability.reason
            ? t(`providerLogin.unavailable.${status.availability.reason}`)
            : (status.availability.message ?? '')}
        </Notice>
      )}

      {errorKind &&
        errorKind !== 'refresh_rejected' &&
        view !== 'pending' &&
        view !== 'signed_in' && (
          <Notice tone={errorKind === 'cancelled' ? 'info' : 'warn'} role="alert">
            <div>{t(`providerLogin.errors.${errorKind}`)}</div>
            {errorKind === 'failed' && status.lastError && (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer">{t('providerLogin.errors.details')}</summary>
                <code className="mt-1 block font-mono break-words">
                  {status.lastError.code}: {status.lastError.message}
                </code>
              </details>
            )}
          </Notice>
        )}

      {view === 'signed_out' && continueButtons()}

      {view === 'signed_out_known' && (
        <>
          <Hint>{t('providerLogin.lastAccount', { account })}</Hint>
          {continueButtons({ again: true })}
        </>
      )}

      {view === 'needs_relogin' && (
        <>
          <Notice tone="warn" title={t('providerLogin.needsRelogin.title')}>
            {t('providerLogin.needsRelogin.body')}
          </Notice>
          {continueButtons({ again: true })}
        </>
      )}

      {view === 'pending' && (
        <div className="flex flex-col gap-2" role="status">
          <div className="font-medium">{t('providerLogin.pending.title')}</div>
          <p className="text-sm text-muted-foreground">
            {t('providerLogin.pending.body', { time: time(status.pending?.expiresAt) })}
          </p>
          <Progress aria-label={t('providerLogin.pending.progress')} indeterminate />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              loading={cancel.isPending}
              onClick={() => cancel.mutate({ params: { providerId: provider.id } })}
            >
              {t('providerLogin.cancel')}
            </Button>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-accent-text underline underline-offset-2"
              >
                {t('providerLogin.pending.reopen')}
                <ExternalLink {...iconProps} size={12} aria-hidden />
              </a>
            )}
          </div>
        </div>
      )}

      {(view === 'signed_in' || view === 'no_plan_usage') && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{t('providerLogin.signedAs', { account })}</span>
            {view === 'signed_in' && (
              <span className="inline-flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span>{t('planUsage.using')}</span>
                <a
                  href={MANAGE_USAGE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-accent-text underline underline-offset-2"
                >
                  {t('planUsage.manage')}
                  <ExternalLink {...iconProps} size={12} aria-hidden />
                </a>
              </span>
            )}
          </div>
          {status.expiresAt && (
            <Hint>{t('providerLogin.expiresAt', { time: time(status.expiresAt) })}</Hint>
          )}
          {status.lastError?.code === 'refresh_rejected' && (
            <Notice tone="info">{t('providerLogin.refreshRejected')}</Notice>
          )}
          {view === 'no_plan_usage' && (
            <Notice tone="warn" title={t('providerLogin.noPlanUsage.title')}>
              {t('providerLogin.noPlanUsage.body')}
            </Notice>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {view === 'no_plan_usage' &&
              continueButtons({ label: t('providerLogin.noPlanUsage.action') })}
            <Button
              variant="secondary"
              disabled={startPending}
              onClick={() =>
                start.mutate({ params: { providerId: provider.id }, body: { account: 'new' } })
              }
            >
              {t('providerLogin.newAccount')}
            </Button>
            <Button
              variant="ghost"
              loading={logout.isPending}
              onClick={() => logout.mutate({ params: { providerId: provider.id } })}
            >
              {t('providerLogin.signOut')}
            </Button>
          </div>
        </div>
      )}

      {revoked && view !== 'signed_in' && (
        <Notice tone={revoked === 'unconfirmed' ? 'warn' : 'info'} role="status">
          {t(`providerLogin.loggedOut.${revoked === 'nothing_to_revoke' ? 'nothing' : revoked}`)}
        </Notice>
      )}

      {start.isError && <ErrorNotice error={start.error} />}
      {cancel.isError && <ErrorNotice error={cancel.error} />}
      {logout.isError && <ErrorNotice error={logout.error} />}

      <Modal
        open={welcome}
        onClose={closeWelcome}
        size="sm"
        title={t('providerLogin.welcome.title')}
        closeLabel={t('common.close')}
        footer={
          <Button variant="primary" data-autofocus onClick={closeWelcome}>
            {t('providerLogin.welcome.gotIt')}
          </Button>
        }
      >
        <p>{t('providerLogin.welcome.body')}</p>
      </Modal>
    </div>
  )
}
