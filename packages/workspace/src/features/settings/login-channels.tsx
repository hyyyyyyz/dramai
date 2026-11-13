import type { ReactNode } from 'react'
import type { TFunction } from 'i18next'
import type { LoginStatusDto } from '@dramai/api'
import { Hint, Notice } from '@dramai/ui/v2'
import { ExternalA } from '@/features/common/ExternalA'
import { MANAGE_USAGE_URL, type LoginView } from './provider-model'

export type LoginChannel = LoginStatusDto['channel']
export type Revoked = 'confirmed' | 'unconfirmed' | 'nothing_to_revoke'

/** Everything the shared sign-in panel needs to know about one channel. Adding a channel means adding one entry. */
export interface ChannelSpec {
  /** Text of the button that starts the sign-in (a brand's wording where the brand prescribes it). */
  continueLabel: (t: TFunction) => string
  /** Title and explanation above the buttons. */
  intro: (t: TFunction) => ReactNode
  /** What a signed-in state looks like for this channel. */
  signedIn: (
    t: TFunction,
    s: LoginStatusDto,
    view: LoginView,
    time: (iso?: string) => string,
  ) => ReactNode
  /** Label of the "sign in again" action next to Sign out, and a note under it. */
  relogin: (t: TFunction, s: LoginStatusDto) => { label: string; note?: string }
  /** Primary button label when signed in but unusable (no plan usage); channels without that state omit it. */
  unusableLabel?: (t: TFunction) => string
  /** What to say after signing out. */
  loggedOut: (
    t: TFunction,
    revoked: Revoked,
    manageUrl: string | undefined,
  ) => { tone: 'info' | 'warn'; text: string; link?: { href: string; label: string } }
  /** Extra text while waiting for the browser, and whether Cancel is the main action there. */
  pending?: { hint?: (t: TFunction) => string; cancelIsPrimary?: boolean }
  /** One-time note after the first successful sign-in (OpenAI's guidelines ask for it; other channels don't). */
  welcome?: {
    flag: string
    title: (t: TFunction) => string
    body: (t: TFunction) => string
    gotIt: (t: TFunction) => string
  }
}

const c = (t: TFunction, ch: LoginChannel, key: string, opts?: Record<string, unknown>) =>
  (t as unknown as (k: string, o?: Record<string, unknown>) => string)(
    `providerLogin.channels.${ch}.${key}`,
    opts,
  )

const OPENAI = 'openai-chatgpt'
const OPENROUTER = 'openrouter'

export const CHANNELS: Record<LoginChannel, ChannelSpec> = {
  // OpenAI: "Continue with ChatGPT" and the plan wording follow OpenAI's guidelines; they apply to this channel only.
  [OPENAI]: {
    continueLabel: (t) => c(t, OPENAI, 'continue'),
    intro: (t) => (
      <div className="flex flex-col gap-1.5">
        <div className="text-sm font-medium">{c(t, OPENAI, 'title')}</div>
        <p className="text-sm text-muted-foreground">{c(t, OPENAI, 'intro')}</p>
        <p className="text-sm text-muted-foreground">{c(t, OPENAI, 'textOnly')}</p>
        <Hint>{c(t, OPENAI, 'needsPlan')}</Hint>
      </div>
    ),
    signedIn: (t, s, view, time) => (
      <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium">
            {c(t, OPENAI, 'signedAs', { account: s.account?.label })}
          </span>
          {view === 'signed_in' && (
            <span className="inline-flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span>{t('planUsage.using')}</span>
              <ExternalA href={MANAGE_USAGE_URL}>{t('planUsage.manage')}</ExternalA>
            </span>
          )}
        </div>
        {s.expiresAt && <Hint>{c(t, OPENAI, 'expiresAt', { time: time(s.expiresAt) })}</Hint>}
        {s.lastError?.code === 'refresh_rejected' && (
          <Notice tone="info">{c(t, OPENAI, 'refreshRejected')}</Notice>
        )}
        {view === 'no_plan_usage' && (
          <Notice tone="warn" title={c(t, OPENAI, 'noPlanUsage.title')}>
            {c(t, OPENAI, 'noPlanUsage.body')}
          </Notice>
        )}
      </>
    ),
    relogin: (t) => ({ label: t('providerLogin.newAccount') }),
    unusableLabel: (t) => c(t, OPENAI, 'noPlanUsage.action'),
    loggedOut: (t, revoked) => ({
      tone: revoked === 'unconfirmed' ? 'warn' : 'info',
      text: c(t, OPENAI, `loggedOut.${revoked === 'nothing_to_revoke' ? 'nothing' : revoked}`),
    }),
    welcome: {
      flag: 'dramai.openai.welcomed',
      title: (t) => c(t, OPENAI, 'welcome.title'),
      body: (t) => c(t, OPENAI, 'welcome.body'),
      gotIt: (t) => c(t, OPENAI, 'welcome.gotIt'),
    },
  },

  // OpenRouter: signing in hands back an API key of the user's own. There is no account, no expiry, no plan, and no way
  // to revoke the key from here, so the only honest thing after signing out is to point at the management page.
  // OpenRouter's documentation sets no button wording or branding, so this is a plain text button.
  [OPENROUTER]: {
    continueLabel: (t) => c(t, OPENROUTER, 'continue'),
    intro: (t) => (
      <div className="flex flex-col gap-1.5">
        <div className="text-sm font-medium">{c(t, OPENROUTER, 'title')}</div>
        <p className="text-sm text-muted-foreground">{c(t, OPENROUTER, 'intro')}</p>
      </div>
    ),
    signedIn: (t, s) => (
      <>
        <div className="font-medium">{c(t, OPENROUTER, 'signedIn')}</div>
        {s.credential?.mask && (
          <Hint>{c(t, OPENROUTER, 'keyNote', { mask: s.credential.mask })}</Hint>
        )}
        {s.manageUrl && (
          <div className="text-sm">
            <ExternalA href={s.manageUrl}>{c(t, OPENROUTER, 'manage')}</ExternalA>
          </div>
        )}
      </>
    ),
    relogin: (t) => ({
      label: c(t, OPENROUTER, 'relogin'),
      note: c(t, OPENROUTER, 'reloginNote'),
    }),
    // the link is the one the logout response carries; nothing to revoke means nothing to point at
    loggedOut: (t, revoked, manageUrl) => ({
      tone: 'warn',
      text: c(
        t,
        OPENROUTER,
        revoked === 'nothing_to_revoke' ? 'loggedOut.nothing' : 'loggedOut.unconfirmed',
      ),
      link:
        manageUrl && revoked !== 'nothing_to_revoke'
          ? { href: manageUrl, label: c(t, OPENROUTER, 'loggedOut.manage') }
          : undefined,
    }),
    pending: { hint: (t) => c(t, OPENROUTER, 'pendingHint'), cancelIsPrimary: true },
  },
}
