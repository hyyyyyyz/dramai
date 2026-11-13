export default {
  providerAuth: {
    label: 'Sign-in method',
    chip: {
      key_saved: 'API key',
      key_missing: 'No API key yet',
      none: 'No authentication',
      login: 'ChatGPT account sign-in',
    },
    noneNote:
      'This provider needs no authentication (a model running on your own machine, for example). Requests carry no credentials, so there is no key to enter',
    keyMissingNote:
      'This provider uses an API key and none is saved yet. Add one to test and use it',
    loginFixed: 'With account sign-in the base URL and protocol are fixed and can’t be changed',
    verification: {
      tested: 'Tested · {{date}}',
      documented: 'Set up from the official docs, not tested',
      source: 'Source',
      note: 'It hasn’t been tried against the real service, so details may be off. It isn’t chosen automatically: try it, and use it once you’re satisfied',
    },
    preset: { documented: 'not tested' },
    custom: {
      auth: 'Authentication',
      apiKey: 'API key',
      none: 'No authentication',
      noneHint: 'For a model on your own machine or network: requests carry no credentials',
    },
    added: {
      title: 'Added “{{name}}”',
      unverified:
        'It was set up from the official docs and has not been tested, so it was not chosen automatically. Once you’re satisfied with it, choose it yourself',
      use: 'Use this',
    },
  },
  planUsage: {
    using: 'Using ChatGPT plan',
    manage: 'Manage usage',
  },
  providerLogin: {
    continue: 'Continue with ChatGPT',
    title: 'Use your ChatGPT plan',
    intro:
      'Sign in with your ChatGPT account and eligible text requests use your own ChatGPT plan, with no API key. This is between you and OpenAI; dramai charges nothing',
    textOnly:
      'Text only (planning episodes, breaking into shots, writing prompts). Images, video and voice-over still need their own API keys',
    needsPlan: 'Needs a ChatGPT subscription and is limited by that plan’s usage',
    unavailable: {
      remote_access:
        'You are using this from another machine, and the sign-in callback can’t reach it, so signing in isn’t possible here. Do it on the computer that runs dramai',
    },
    signedAs: 'Signed in: {{account}}',
    expiresAt:
      'The access token expires around {{time}} (it refreshes by itself; for reference only)',
    lastAccount: 'Last signed in as {{account}}',
    again: 'Sign in again',
    newAccount: 'Use another account',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    cancel: 'Cancel sign-in',
    pending: {
      title: 'Finish in your browser',
      body: 'The authorization page was opened in a new window. Come back here when you are done and this continues by itself. You can wait until {{time}}',
      reopen: 'No new window? Open the authorization page again',
      starting: 'Starting sign-in…',
      progress: 'Waiting for authorization',
    },
    noPlanUsage: {
      title: 'Signed in, but not usable yet',
      body: 'This sign-in did not grant access to ChatGPT plan usage, so requests can’t be made. Sign in again and approve it',
      action: 'Sign in again and approve',
    },
    needsRelogin: {
      title: 'Your sign-in expired and needs to be done again',
      body: 'The saved credentials can’t be used any more (revoked, or refreshing failed). Sign in again; nothing else changes',
    },
    refreshRejected:
      'The server rejected one token refresh without saying why. Your credentials are still saved and you can keep going; if something fails later, try signing in again',
    errors: {
      denied:
        'You declined the sign-in on the authorization page. You can try again if you want to use it',
      timeout: 'The sign-in timed out (authorization has to finish within 10 minutes). Try again',
      account_mismatch:
        'This sign-in was for a different account than the one saved. To switch accounts, choose “Use another account”',
      cancelled: 'Sign-in cancelled',
      failed: 'Sign-in didn’t finish. Please try again',
      details: 'Technical details',
    },
    models: {
      label: 'Model',
      hint: 'Once signed in, the models you can use are listed; you can also type one',
      loading: 'Loading the model list…',
      failed: 'Couldn’t load the model list. Type the model name yourself',
    },
    loggedOut: {
      confirmed: 'Signed out, and OpenAI’s authorization was revoked too',
      unconfirmed:
        'The local sign-in was cleared, but we couldn’t confirm that OpenAI revoked it. You can disconnect this app in ChatGPT settings',
      nothing: 'Signed out (there was no authorization to revoke)',
    },
    welcome: {
      title: 'You’re using your ChatGPT plan.',
      body: 'Eligible usage in this app uses your ChatGPT plan. Manage usage in your ChatGPT settings.',
      gotIt: 'Got it.',
      note: 'Eligible requests use your ChatGPT plan; you can manage usage in ChatGPT settings',
    },
  },
  providerErrors: {
    openSettings: 'Open provider settings',
    LOGIN_REQUIRED: {
      title: 'Sign in to your OpenAI account again',
      body: 'This provider uses ChatGPT account sign-in, and the sign-in has expired or was never finished. Sign in again in Settings, then retry this task',
    },
    LOGIN_ENDPOINT_NOT_ALLOWED: {
      title: 'The base URL isn’t allowed, so no sign-in token was sent',
      body: 'The base URL for account sign-in is fixed. Delete this provider in Settings and add it again from the preset',
    },
    subscription_sharing_usage_limit_exceeded: {
      title: 'Usage limit reached',
      body: 'Review your plan or this app’s limit in ChatGPT settings.',
      note: 'It may be your plan’s limit or only this app’s limit. dramai doesn’t guess when it resets',
    },
    subscription_sharing_user_not_eligible: {
      title: 'This account can’t share its plan with third-party apps',
      body: 'Retrying won’t help. Sign in with another account, or use an API key instead',
    },
    subscription_sharing_usage_unavailable: {
      title: 'The usage service is temporarily unavailable',
      body: 'Your sign-in is still valid. Retry this task in a little while',
    },
    subscription_sharing_user_unavailable: {
      title: 'The account service is temporarily unavailable',
      body: 'Your sign-in is still valid. Retry this task in a little while',
    },
    subscription_sharing_unsupported_capability: {
      title: 'This request used something account sign-in doesn’t support',
      body: 'This shouldn’t happen. Please report this task together with this message',
    },
    subscription_sharing_route_not_supported: {
      title: 'Account sign-in doesn’t support this endpoint',
      body: 'Account sign-in only supports text requests. Check this provider’s base URL',
    },
    subscription_sharing_invalid_user: {
      title: 'The sign-in identity wasn’t accepted',
      body: 'Sign in again. If it keeps happening, sign out first and then sign in',
    },
    chatpass_v2_scope_not_authorized: {
      title: 'This sign-in didn’t grant access to ChatGPT plan usage',
      body: 'Retrying won’t help. Sign in again and approve it',
    },
    chatpass_v2_invalid_authorization_context: {
      title: 'The sign-in’s authorization context is invalid',
      body: 'Retrying won’t help. Sign in again; if it keeps happening, please report it',
    },
  },
}
