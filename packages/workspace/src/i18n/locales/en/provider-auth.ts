export default {
  providerAuth: {
    label: 'Sign-in method',
    chip: {
      key_saved: 'API key',
      key_missing: 'No API key yet',
      none: 'No authentication',
      channels: {
        'openai-chatgpt': 'ChatGPT account sign-in',
        openrouter: 'OpenRouter account sign-in',
      },
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
    again: 'Sign in again',
    newAccount: 'Use another account',
    signOut: 'Sign out',
    cancel: 'Cancel sign-in',
    unsafeUrl:
      'The authorization address the server gave isn’t an http or https address, so it wasn’t opened. Try again; if it keeps happening, please report it',
    lastAccount: 'Last signed in as {{account}}',
    unavailable: {
      remote_access:
        'You are using this from another machine, and the sign-in callback can’t reach it, so signing in isn’t possible here. Do it on the computer that runs dramai',
    },
    pending: {
      title: 'Finish in your browser',
      body: 'The authorization page was opened in a new window. Come back here when you are done and this continues by itself. You can wait until {{time}}',
      reopen: 'No new window? Open the authorization page again',
      progress: 'Waiting for authorization',
    },
    needsRelogin: {
      title: 'Your sign-in expired and needs to be done again',
      body: 'The saved credentials can’t be used any more (revoked, or refreshing failed). Sign in again; nothing else changes',
    },
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
      fetch: 'Get model list',
      refetch: 'Reload',
      unsupported: 'This provider has no model list. Type the model name yourself',
      fetchHint:
        'Fetch the models you can use from the provider and pick one; you can also type it',
    },
    channels: {
      'openai-chatgpt': {
        continue: 'Continue with ChatGPT',
        title: 'Use your ChatGPT plan',
        intro:
          'Sign in with your ChatGPT account and eligible text requests use your own ChatGPT plan, with no API key. This is between you and OpenAI; dramai charges nothing',
        textOnly:
          'Text only (planning episodes, breaking into shots, writing prompts). Images, video and voice-over still need their own API keys',
        needsPlan: 'Needs a ChatGPT subscription and is limited by that plan’s usage',
        signedAs: 'Signed in: {{account}}',
        expiresAt:
          'The access token expires around {{time}} (it refreshes by itself; for reference only)',
        noPlanUsage: {
          title: 'Signed in, but not usable yet',
          body: 'This sign-in did not grant access to ChatGPT plan usage, so requests can’t be made. Sign in again and approve it',
          action: 'Sign in again and approve',
        },
        refreshRejected:
          'The server rejected one token refresh without saying why. Your credentials are still saved and you can keep going; if something fails later, try signing in again',
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
        },
      },
      openrouter: {
        continue: 'Sign in with OpenRouter',
        title: 'Sign in with your OpenRouter account',
        intro:
          'After you sign in, OpenRouter gives dramai an API key of your own, and from then on it works exactly like a key you pasted. Usage and cost are billed to your OpenRouter account; dramai charges nothing',
        signedIn: 'Signed in with an OpenRouter account',
        keyNote: 'This key came from signing in: {{mask}}',
        manage: 'Manage this key',
        relogin: 'Sign in again (get a new key)',
        reloginNote:
          'Signing in again gets a new key. The old one stays valid on OpenRouter until you delete it on the management page',
        pendingHint:
          'If you already declined on the authorization page, OpenRouter doesn’t tell us, and this keeps waiting until it times out. Click “Cancel sign-in”',
        loggedOut: {
          unconfirmed:
            'The key was removed from this computer, but OpenRouter has no way to revoke it. To make the key stop working, delete it on its management page',
          nothing: 'Signed out',
          manage: 'Delete this key on OpenRouter',
        },
      },
    },
  },
  providerErrors: {
    openSettings: 'Open provider settings',
    EMPTY_OUTPUT_TRUNCATED: {
      title: 'The output was cut off by the length limit and has no text',
      body: 'The model most likely spent the whole allowance on thinking. In this provider’s advanced settings turn thinking off (extra request body) or raise the output length, then retry',
    },
    STREAM_INTERRUPTED: {
      title: 'The connection dropped part-way through',
      body: 'The end-of-response signal never arrived, so the result is incomplete. Just retry the task',
    },
    overloaded_error: {
      title: 'The provider is overloaded right now',
      body: 'This is temporary congestion on their side, not a problem with your settings. Retry in a little while',
    },
    rate_limit_error: {
      title: 'Too many requests: the provider is rate limiting',
      body: 'Wait a moment and retry; if it keeps happening, check the usage limits on this provider account',
    },
    authentication_error: {
      title: 'The provider didn’t accept this key',
      body: 'Check that the API key is right and still valid, save it again in Settings, then retry',
    },
    invalid_request_error: {
      title: 'The provider says this request isn’t valid',
      body: 'Most likely the model name, the output length or the extra request body is wrong. Check this provider’s settings; the details are in the task’s technical info',
    },
    GEMINI_SAFETY: {
      title: 'Blocked by Gemini’s safety policy',
      body: 'What was generated tripped a safety filter. Change this passage or the prompt and try again; the same content usually gives the same result',
    },
    GEMINI_PROMPT_SAFETY: {
      title: 'The prompt was blocked by Gemini’s safety policy',
      body: 'The input tripped a safety filter, so nothing was generated. Change the text or the prompt and try again',
    },
    GEMINI_RECITATION: {
      title: 'Blocked by Gemini: too close to existing work',
      body: 'Word it differently, or use a shorter quote of the source text, and try again',
    },
    GEMINI_IMAGE_URL_UNSUPPORTED: {
      title: 'Gemini only accepts the image data itself as input',
      body: 'This shouldn’t happen. Please report this task together with this message',
    },
    INVALID_ARGUMENT: {
      title: 'The provider says a parameter of this request is wrong',
      body: 'Check the model name and this provider’s settings; the details are in the task’s technical info',
    },
    RESOURCE_EXHAUSTED: {
      title: 'A usage or rate limit at the provider was reached',
      body: 'Wait a moment and retry, or check the quota in the provider’s console',
    },
    PERMISSION_DENIED: {
      title: 'The provider refused this request',
      body: 'Most likely the key lacks permission, or the model isn’t open to your account yet. Check the key and the model, then try again',
    },
    LOGIN_REQUIRED: {
      title: 'Sign in to this provider again',
      body: 'This provider uses account sign-in, and the sign-in has expired or was never completed. Sign in again in Settings, then retry this task',
      bodyHere:
        'This provider uses account sign-in, and the sign-in has expired or was never completed. Sign in again in the sign-in area of this card, then test again',
    },
    NETWORK: {
      title: 'Could not reach the provider',
      body: 'Check this computer’s network and proxy, and whether the address is right (host, port, https). If the provider is temporarily unreachable, try again in a moment',
    },
    TIMEOUT: {
      title: 'The provider took too long to answer',
      body: 'The network may be slow or the provider busy. Try again in a moment; if it keeps happening, check the address and the network',
    },
    UNREADABLE_RESPONSE: {
      title: 'The provider answered in an unexpected format',
      body: 'The address most likely points at a web page or another service instead of this provider’s API. Check that the address has the right path',
    },
    BASE_URL_INVALID: {
      title: 'The address cannot be used',
      body: 'It is empty or malformed. Enter the full address, for example https://api.example.com/v1',
    },
    HTTP_AUTH: {
      title: 'The provider rejected this key, or the key lacks permission',
      body: 'Check that the API key is correct and still valid and that it may use this model, save it again, then retry',
    },
    HTTP_NOT_FOUND: {
      title: 'The provider cannot find this endpoint or model',
      body: 'The path in the address is probably wrong, or the model name is. Check both against the provider’s documentation',
    },
    HTTP_RATE_LIMIT: {
      title: 'Too many requests, or the quota is used up',
      body: 'Wait a moment and try again. If it keeps happening, check this account’s usage and balance in the provider’s console',
    },
    HTTP_SERVER: {
      title: 'The provider had an error',
      body: 'This is on the provider’s side, not your settings. Try again in a moment',
    },
    VIDEO_FACE_REJECTED: {
      title: 'This model doesn’t accept images with real human faces',
      body: 'The provider rejected an input image, most likely because it contains a real human face. Choose another model, or turn off “Use character sheets as references” and try with images that have no real faces',
    },
    CONTENT_REJECTED: {
      title: 'The provider’s content check blocked it',
      body: 'The input image or prompt didn’t pass the check. Change the prompt or the image and try again; retrying as it is usually gives the same result',
    },
    BALANCE_INSUFFICIENT: {
      title: 'The provider account is in arrears, or its resource package is used up',
      body: 'Top up or buy a resource package in the provider’s console, then retry this task',
    },
    TASK_EXPIRED: {
      title: 'The task has expired at the provider',
      body: 'The provider only keeps a task for a while and the result can’t be fetched any more. Regenerate this shot',
    },
    TASK_CANCELLED: {
      title: 'The task was cancelled at the provider',
      body: 'Just regenerate this shot',
    },
    TASK_UNKNOWN: {
      title: 'The provider doesn’t know this task any more',
      body: 'The task id is no longer valid (it passed the retention period). Regenerate this shot',
    },
    FIRST_FRAME_REQUIRED: {
      title: 'This video model needs the shot image as its first frame, and this shot has none yet',
      body: 'Generate the shot image first, then the video',
    },
    VOICE_MISSING: {
      title: 'The provider says there is no such voice',
      body: 'Choose a voice again in the project settings. If it is your own cloned voice, check that it belongs to this provider’s account and hasn’t expired',
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
