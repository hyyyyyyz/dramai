import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { LoginStatusDto, ProviderConfigDto } from '@dramai/api'
import { Button, Hint, Notice, Progress, Skeleton, iconProps } from '@dramai/ui/v2'
import { Modal } from '@/components/overlay'
import { qk } from '@/data/keys'
import { useCall, useProviderLogin } from '@/data/queries'
import { ErrorNotice } from '@/features/common/error-text'
import { ExternalA } from '@/features/common/ExternalA'
import { useFormat } from '@/i18n/format'
import { CHANNELS, type Revoked } from './login-channels'
import { safeHttpUrl } from '@/lib/safe-url'
import { loginErrorKind, loginView, type LoginErrorKind } from './provider-model'

const wasWelcomed = (flag: string) => {
  try {
    return localStorage.getItem(flag) === '1'
  } catch {
    return false
  }
}
const markWelcomed = (flag: string) => {
  try {
    localStorage.setItem(flag, '1')
  } catch {
    /* storage unavailable: the note may show again, nothing breaks */
  }
}

/**
 * Account sign-in for a provider: start, wait in the browser (cancellable), signed in, failures, sign in again,
 * sign out. The flow is the same for every channel; what differs (wording, what "signed in" shows, what signing out
 * means, brand rules) lives in `CHANNELS`. Statuses never contain tokens. Polling runs only while a sign-in is
 * pending and stops with the component (see useProviderLogin).
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
  const spec =
    CHANNELS[
      status?.channel ??
        (provider.auth.type === 'account_login' ? provider.auth.channel : 'openai-chatgpt')
    ]
  const [url, setUrl] = useState<string>()
  const [loggedOutNote, setLoggedOutNote] = useState<{ revoked: Revoked; manageUrl?: string }>()
  const [unsafeUrl, setUnsafeUrl] = useState(false)
  const [welcome, setWelcome] = useState(false)
  const setStatus = (s: LoginStatusDto) => qc.setQueryData(qk.providerLogin(provider.id), s)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.providers })
  }
  const start = useCall('providers.login.start', {
    onSuccess: (r) => {
      setLoggedOutNote(undefined)
      // the address comes from the server: only http(s) is ever opened
      const safe = safeHttpUrl(r.authorizationUrl)
      setUnsafeUrl(!safe)
      setUrl(safe)
      if (safe) window.open(safe, '_blank', 'noopener,noreferrer')
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
      setLoggedOutNote({ revoked: r.revoked, manageUrl: r.manageUrl })
      setStatus(r.status)
      refresh()
    },
  })

  // A sign-in that was pending has ended. State is adjusted while rendering (no effect needed); when the channel has
  // a one-time welcome note, show it the first time a usable sign-in completes.
  const [prevState, setPrevState] = useState(status?.state)
  if (status?.state !== prevState) {
    setPrevState(status?.state)
    if (prevState === 'pending') {
      setUrl(undefined)
      if (
        status?.state === 'signed_in' &&
        status.planUsage !== false &&
        spec.welcome &&
        !wasWelcomed(spec.welcome.flag)
      )
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
    if (spec.welcome) markWelcomed(spec.welcome.flag)
    setWelcome(false)
  }

  if (!status) {
    // the status could not be read: say so and offer a retry, instead of the whole panel vanishing
    return login.isError ? (
      <div className="flex flex-col gap-2" data-testid="login-panel-error">
        <ErrorNotice error={login.error} />
        <div>
          <Button size="sm" variant="secondary" onClick={() => void login.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      </div>
    ) : (
      <Skeleton className="h-16" aria-busy />
    )
  }
  const view = loginView(status)
  const startPending = start.isPending
  const time = (iso?: string) =>
    iso ? new Date(iso).toLocaleTimeString(fmt.locale, { hour: '2-digit', minute: '2-digit' }) : ''
  const account = status.account?.label
  const startNew = (body: { account?: 'same' | 'new' }) =>
    start.mutate({ params: { providerId: provider.id }, body })

  const continueButtons = (opts: { again?: boolean; label?: string } = {}) => (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        loading={startPending}
        disabled={startPending}
        onClick={() => startNew({})}
      >
        {opts.label ?? spec.continueLabel(t as never)}
      </Button>
      {opts.again && account && (
        <Button
          variant="secondary"
          disabled={startPending}
          onClick={() => startNew({ account: 'new' })}
        >
          {t('providerLogin.newAccount')}
        </Button>
      )}
    </div>
  )

  const errorKind: LoginErrorKind | undefined = status.lastError
    ? loginErrorKind(status.lastError.code)
    : undefined
  const relogin = spec.relogin(t as never, status)
  const loggedOut =
    loggedOutNote && view !== 'signed_in'
      ? spec.loggedOut(t as never, loggedOutNote.revoked, loggedOutNote.manageUrl)
      : undefined

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="login-panel"
      data-view={view}
      data-channel={status.channel}
    >
      {spec.intro(t as never)}

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
          {spec.pending?.hint && <Notice tone="info">{spec.pending.hint(t as never)}</Notice>}
          <Progress aria-label={t('providerLogin.pending.progress')} indeterminate />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={spec.pending?.cancelIsPrimary ? 'primary' : 'secondary'}
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
          {spec.signedIn(t as never, status, view, time)}
          <div className="flex flex-wrap items-center gap-2">
            {view === 'no_plan_usage' &&
              spec.unusableLabel &&
              continueButtons({ label: spec.unusableLabel(t as never) })}
            <Button
              variant="secondary"
              disabled={startPending}
              onClick={() => startNew({ account: 'new' })}
            >
              {relogin.label}
            </Button>
            <Button
              variant="ghost"
              loading={logout.isPending}
              onClick={() => logout.mutate({ params: { providerId: provider.id } })}
            >
              {t('providerLogin.signOut')}
            </Button>
          </div>
          {relogin.note && <Hint>{relogin.note}</Hint>}
        </div>
      )}

      {loggedOut && (
        <Notice tone={loggedOut.tone} role="status">
          <div>{loggedOut.text}</div>
          {loggedOut.link && (
            <div className="mt-1">
              <ExternalA href={loggedOut.link.href}>{loggedOut.link.label}</ExternalA>
            </div>
          )}
        </Notice>
      )}

      {unsafeUrl && <Notice tone="warn">{t('providerLogin.unsafeUrl')}</Notice>}
      {start.isError && <ErrorNotice error={start.error} />}
      {cancel.isError && <ErrorNotice error={cancel.error} />}
      {logout.isError && <ErrorNotice error={logout.error} />}

      {spec.welcome && (
        <Modal
          open={welcome}
          onClose={closeWelcome}
          size="sm"
          title={spec.welcome.title(t as never)}
          closeLabel={t('common.close')}
          footer={
            <Button variant="primary" data-autofocus onClick={closeWelcome}>
              {spec.welcome.gotIt(t as never)}
            </Button>
          }
        >
          <p>{spec.welcome.body(t as never)}</p>
        </Modal>
      )}
    </div>
  )
}
